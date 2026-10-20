alter table public.hdc_v2_inspection_requests add column dates_managed boolean not null default false,add column result_record_id text unique;
CREATE OR REPLACE FUNCTION hdc_v2_private.inspection_request_edit(p_request text, p_expected jsonb, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_before jsonb;v_saved jsonb;v_eq jsonb;v_equipment text;v_assignee uuid;v_name text;v_symptom text;v_time text;v_date text;v_due text;v_day date;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor)
 then raise exception using errcode='42501',message='접수 내용 수정은 윤여철 공장장만 가능합니다.';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 or jsonb_typeof(p_patch) is distinct from 'object'
 or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_patch::text)>10000
 then raise exception using errcode='22023',message='수정 항목과 변경 사유를 확인하세요.';end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('equipment_id','assignee_id','symptom','date','dueDate')) or p_patch='{}'::jsonb
 then raise exception using errcode='22023',message='설비·담당자·증상·기록 일자·완료 기한만 수정할 수 있습니다.';end if;
 select * into v_request from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or v_request.completed_at is not null then raise sqlstate 'PT409' using message='대기 중인 점검요청만 수정할 수 있습니다. 목록을 새로고침하세요.';end if;
 select body into v_before from public.hdc_v2_records where id=p_request for update;
 if jsonb_build_object('equipment_id',v_request.equipment_id,'assignee_id',v_request.assignee_id,'symptom',v_request.symptom,'date',v_before->>'date','dueDate',coalesce(v_before->>'dueDate','')) is distinct from p_expected
 then raise sqlstate 'PT409' using message='접수 내용이 이미 변경되었습니다. 새로고침 후 다시 확인하세요.';end if;
 if exists(select 1 from jsonb_each(p_patch) e where jsonb_typeof(e.value) is distinct from 'string')
 then raise exception using errcode='22023',message='수정 값의 형식을 확인하세요.';end if;
 v_equipment:=coalesce(p_patch->>'equipment_id',v_request.equipment_id);
 v_assignee:=coalesce((p_patch->>'assignee_id')::uuid,v_request.assignee_id);
 v_symptom:=btrim(coalesce(p_patch->>'symptom',v_request.symptom));
 if char_length(v_symptom) not between 1 and 2000 then raise exception using errcode='22023',message='발견한 증상을 1~2,000자로 입력하세요.';end if;
 v_eq:=hdc_v2_private.hub_equipment(v_equipment);
 if v_eq is null or exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=v_equipment and status='retired')
 then raise exception using errcode='22023',message='사용 중인 설비를 선택하세요.';end if;
 select display_name into v_name from public.hdc_v2_profiles where id=v_assignee and approved;
 if v_name is null then raise exception using errcode='22023',message='승인된 담당자를 선택하세요.';end if;
 select body into v_before from public.hdc_v2_records where id=p_request for update;
 if v_before is null then raise exception '접수 기록을 찾을 수 없습니다.';end if;
 v_date:=coalesce(p_patch->>'date',v_before->>'date');v_due:=coalesce(p_patch->>'dueDate',v_before->>'dueDate','');
 if v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (v_due<>'' and v_due !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
 raise exception using errcode='22023',message='실제 달력 날짜를 선택하세요.';end if;
 begin
 v_day:=v_date::date;
 if to_char(v_day,'YYYY-MM-DD')<>v_date then raise exception using errcode='22023',message='기록 일자를 확인하세요.';end if;
 if v_due<>'' then v_day:=v_due::date;if to_char(v_day,'YYYY-MM-DD')<>v_due then raise exception using errcode='22023',message='완료 기한을 확인하세요.';end if;end if;
 exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='실제 달력 날짜를 선택하세요.';end;
 if (v_equipment,v_assignee,v_symptom,v_date,v_due) is not distinct from (v_request.equipment_id,v_request.assignee_id,v_request.symptom,v_before->>'date',coalesce(v_before->>'dueDate',''))
 then raise exception using errcode='22023',message='변경한 항목이 없습니다.';end if;
 update public.hdc_v2_inspection_requests set equipment_id=v_equipment,assignee_id=v_assignee,symptom=v_symptom,dates_managed=(dates_managed or (p_patch ? 'date') or (p_patch ? 'dueDate')) where id=p_request;
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),
 body=body||jsonb_build_object('equipmentId',v_equipment,'equipmentName',v_eq->>'name','assignee',v_name,'note',v_symptom,
 'date',v_date,'dueDate',v_due,'title',left('[일일점검요청] '||(v_eq->>'name'),200),'version',version+1,'updatedAt',v_time)
 where id=p_request returning body into v_saved;
 insert into public.hdc_v2_request_edit_events(request_id,actor_id,before_body,after_body,reason)
 values(p_request,v_actor,v_before,v_saved,btrim(p_reason));
 return v_saved;
end;$function$;

create or replace function hdc_v2_private.inspection_hub() returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]'::jsonb) from public.hdc_v2_profiles where approved),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('date',b.body->>'date','dueDate',coalesce(b.body->>'dueDate','')) order by r.created_at desc),'[]'::jsonb) from public.hdc_v2_inspection_requests r join public.hdc_v2_records b on b.id=r.id),
 'lifecycle',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.hdc_v2_equipment_lifecycle l));
end;$fn$;
CREATE OR REPLACE FUNCTION hdc_v2_private.inspection_finish(p_request text, p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_saved jsonb;v_time text;v_record jsonb;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 select * into v_request from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or (v_request.assignee_id<>v_actor and not hdc_v2_private.is_admin()) then raise insufficient_privilege;end if;
 if exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=v_request.equipment_id and status='retired') then raise exception using errcode='22023',message='폐기 설비의 점검요청은 관리자에게 확인하세요.';end if;
 if p_record->>'type' is distinct from 'inspection' or p_record->>'equipmentId' is distinct from v_request.equipment_id or (v_request.inspection_id is not null and v_request.inspection_id is distinct from p_record->>'id') then raise exception using errcode='22023',message='해당 설비의 점검 결과를 등록하세요.';end if;
 if exists(select 1 from jsonb_array_elements(p_record->'items') i where i->>'result'='미점검') or jsonb_array_length(p_record->'items')=0 then raise exception using errcode='22023',message='모든 점검 결과를 입력하세요.';end if;
 v_record:=p_record||jsonb_build_object('assignee',(select display_name from public.hdc_v2_profiles where id=v_request.assignee_id));

 if v_request.dates_managed and not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor)
 and ((p_record->>'date') is distinct from (select body->>'date' from public.hdc_v2_records where id=p_request)
 or coalesce(p_record->>'dueDate','') is distinct from (select coalesce(body->>'dueDate','') from public.hdc_v2_records where id=p_request)) then
 raise exception using errcode='42501',message='공장장이 지정한 날짜가 변경되었습니다. 점검창을 다시 열어 확인하세요.';end if;
 update public.hdc_v2_inspection_requests set result_record_id=p_record->>'id' where id=p_request;
 v_saved:=hdc_v2_private.save_planned_record(v_record,null);
 update public.hdc_v2_inspection_requests set inspection_id=v_saved->>'id',completed_at=now() where id=p_request;
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),body=body||jsonb_build_object('status','완료','version',version+1,'updatedAt',v_time) where id=p_request;
 return v_saved;
end;$function$;

CREATE OR REPLACE FUNCTION hdc_v2_private.save_record(p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_record jsonb;
  v_existing public.hdc_v2_records%rowtype;
  v_found boolean;
  v_id text;
  v_owner uuid;
  v_version integer;
  v_now timestamptz := clock_timestamp();
  v_created timestamptz;
  v_now_text text;
  v_saved jsonb;
  v_child jsonb;
  v_child_id text;
  v_defect_note text;
begin
  if v_actor is null or not hdc_v2_private.is_approved() then
    raise exception using errcode='42501',message='승인된 사용자만 기록을 저장할 수 있습니다.';
  end if;
  v_record := hdc_v2_private.validate_record(p_record);
  v_id := v_record->>'id';
  v_version := (v_record->>'version')::integer;
  -- Serialize both first inserts and updates by logical id, then lock the existing row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id,0));
  select * into v_existing from public.hdc_v2_records where id=v_id for update;
  v_found := found;
  -- Only the dedicated owner may choose dates. A linked inspection can retain owner-assigned dates.
  if not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
    if v_found then
      if (v_record->>'date') is distinct from (v_existing.body->>'date')
        or coalesce(v_record->>'dueDate','') is distinct from coalesce(v_existing.body->>'dueDate','') then
        raise exception using errcode='42501',message='기록 일자와 완료 기한은 윤여철 공장장만 변경할 수 있습니다.';
      end if;
    elsif (v_record->>'date') is distinct from to_char(v_now at time zone 'Asia/Seoul','YYYY-MM-DD')
       or coalesce(v_record->>'dueDate','')<>'' then
      if not exists(select 1 from public.hdc_v2_inspection_requests r join public.hdc_v2_records b on b.id=r.id
        where r.result_record_id=v_id and r.dates_managed and r.completed_at is null
        and v_record->>'type'='inspection' and v_record->>'equipmentId'=r.equipment_id
        and (r.assignee_id=v_actor or hdc_v2_private.is_admin())
        and v_record->>'date'=b.body->>'date' and coalesce(v_record->>'dueDate','')=coalesce(b.body->>'dueDate','')) then
        raise exception using errcode='42501',message='공장장이 지정한 날짜만 사용할 수 있습니다. 날짜를 확인하세요.';
      end if;
    end if;
  end if;
  if v_found and v_existing.owner_id <> v_actor and not hdc_v2_private.is_admin() then
    raise exception using errcode='42501',message='작성자 또는 관리자만 기록을 수정할 수 있습니다.';
  end if;
  if (not v_found and v_version<>0) or (v_found and v_version<>v_existing.version) then
    raise sqlstate 'PT409' using message='VERSION_CONFLICT',
      detail=case when v_found then v_existing.body::text else 'null' end,
      hint='최신 기록을 확인하고 변경 내용을 비교한 뒤 다시 저장하세요.';
  end if;
  if v_found and not (p_record ? 'preventivePlanId') and v_existing.body ? 'preventivePlanId' then v_record:=v_record||jsonb_build_object('preventivePlanId',v_existing.body->'preventivePlanId');end if;
  -- Older clients omit classification; retain metadata for photographs still attached.
  if v_found and not (p_record ? 'photoDetails') and v_existing.body ? 'photoDetails' then
    v_record:=v_record||jsonb_build_object('photoDetails',(select coalesce(jsonb_object_agg(d.key,d.value),'{}'::jsonb) from jsonb_each(v_existing.body->'photoDetails') d where (v_record->'photoIds') ? d.key));
  end if;
  if exists(
    select 1 from jsonb_array_elements_text(v_record->'photoIds') p(id)
    where not exists(select 1 from public.hdc_v2_photos f where f.id=p.id::uuid)
  ) then
    raise exception using errcode='22023',message='사진을 먼저 업로드하고 등록하세요.';
  end if;
  v_owner := case when v_found then v_existing.owner_id else v_actor end;
  v_created := case when v_found then v_existing.created_at else v_now end;
  v_now_text := to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_saved := (v_record - 'createdAt' - 'updatedAt') || jsonb_build_object(
    'version',v_version+1,'createdAt',to_char(v_created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',v_now_text
  );
  if v_found then
    update public.hdc_v2_records set body=v_saved,version=v_version+1,updated_at=v_now
    where id=v_id and version=v_version;
    if not found then raise sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  else
    insert into public.hdc_v2_records(id,owner_id,body,version,created_at,updated_at)
    values(v_id,v_owner,v_saved,1,v_created,v_now);
  end if;

  if v_saved->>'type'='inspection' and exists(
    select 1 from jsonb_array_elements(v_saved->'items') i where i->>'result'='불량'
  ) then
    v_child_id := 'defect-' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_id,'UTF8')),'hex');
    select left('점검 기록 ' || v_id || E'의 불량 항목\n' ||
      string_agg(i.item->>'name' || ': ' || coalesce(nullif(i.item->>'note',''),nullif(i.item->>'value',''),'불량 확인'),E'\n' order by i.n),5000)
    into v_defect_note
    from jsonb_array_elements(v_saved->'items') with ordinality i(item,n) where i.item->>'result'='불량';
    v_child := jsonb_build_object(
      'id',v_child_id,'type','workorder','equipmentId',v_saved->>'equipmentId','equipmentName',v_saved->>'equipmentName',
      'title',left('[이상점검] ' || (v_saved->>'title'),200),'status','접수',
      'priority',case when v_saved->>'priority'='긴급' then '긴급' else '높음' end,
      'assignee',v_saved->>'assignee','date',v_saved->>'date','dueDate',v_saved->>'dueDate',
      'note',v_defect_note,'items','[]'::jsonb,'photoIds',v_saved->'photoIds','photoDetails',coalesce(v_saved->'photoDetails','{}'::jsonb),'version',1,
      'createdAt',v_now_text,'updatedAt',v_now_text
    );
    -- Same transaction as the inspection; an existing follow-up, including a completed one, is never overwritten.
    insert into public.hdc_v2_records(id,owner_id,body,version,created_at,updated_at)
    values(v_child_id,v_owner,v_child,1,v_now,v_now) on conflict(id) do nothing;
  end if;
  return v_saved;
end;
$function$;


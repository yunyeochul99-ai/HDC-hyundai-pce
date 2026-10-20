CREATE OR REPLACE FUNCTION hdc_v2_private.work_archive_action(p_record text, p_action text, p_version integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_row public.hdc_v2_records%rowtype;v_archived boolean;v_time text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
 raise exception using errcode='42501',message='작업계획 삭제·복원은 윤여철 공장장만 가능합니다.';end if;
 if p_action is null or p_action not in ('archive','restore') or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
 raise exception using errcode='22023',message='처리 유형과 사유를 입력하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_record,0));
 perform 1 from public.hdc_v2_inspection_requests where id=p_record for update;
 select * into v_row from public.hdc_v2_records where id=p_record for update;
 if not found or v_row.body->>'type'<>'workorder' then
 raise exception using errcode='22023',message='작업계획 또는 대기 중인 점검요청을 선택하세요.';end if;
 if p_action='archive' and exists(select 1 from public.hdc_v2_inspection_requests where id=p_record and completed_at is not null) then
 raise exception using errcode='22023',message='완료된 점검요청은 삭제할 수 없습니다. 점검 이력을 확인하세요.';end if;
 if v_row.version is distinct from p_version then raise sqlstate 'PT409' using message='작업 내용이 변경되었습니다. 새로고침하고 다시 확인하세요.';end if;
 select archived into v_archived from public.hdc_v2_work_archives where record_id=p_record;
 if coalesce(v_archived,false)=(p_action='archive') then raise sqlstate 'PT409' using message='이미 처리된 작업입니다. 목록을 새로고침하세요.';end if;
 insert into public.hdc_v2_work_archives(record_id,archived,reason,actor_id) values(p_record,p_action='archive',btrim(p_reason),v_actor)
 on conflict(record_id) do update set archived=excluded.archived,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=now();
 insert into public.hdc_v2_work_archive_events(record_id,action,reason,actor_id) values(p_record,p_action,btrim(p_reason),v_actor);
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),body=body||jsonb_build_object('version',version+1,'updatedAt',v_time) where id=p_record;
end;$function$;

CREATE OR REPLACE FUNCTION hdc_v2_private.inspection_hub()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]'::jsonb) from public.hdc_v2_profiles where approved),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('date',b.body->>'date','dueDate',coalesce(b.body->>'dueDate',''),'version',b.version,'archived',coalesce((select a.archived from public.hdc_v2_work_archives a where a.record_id=r.id),false),'archive_reason',(select a.reason from public.hdc_v2_work_archives a where a.record_id=r.id),'archive_at',(select a.updated_at from public.hdc_v2_work_archives a where a.record_id=r.id)) order by r.created_at desc),'[]'::jsonb) from public.hdc_v2_inspection_requests r join public.hdc_v2_records b on b.id=r.id),
 'lifecycle',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.hdc_v2_equipment_lifecycle l));
end;$function$;

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
 if exists(select 1 from public.hdc_v2_work_archives where record_id=p_request and archived) then
 raise exception using errcode='42501',message='삭제 보관된 점검요청입니다. 공장장이 복원한 뒤 처리하세요.';end if;
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
 if exists(select 1 from public.hdc_v2_work_archives where record_id=p_request and archived) then
 raise exception using errcode='42501',message='삭제 보관된 점검요청입니다. 공장장이 복원한 뒤 처리하세요.';end if;
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

CREATE OR REPLACE FUNCTION hdc_v2_private.inspection_reassign(p_request text, p_expected uuid, p_assignee uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_name text;v_saved jsonb;v_time text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
 raise exception using errcode='42501',message='담당자 변경은 윤여철 공장장만 가능합니다.';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then raise exception using errcode='22023',message='변경 사유를 입력하세요.';end if;
 select * into v_request from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or v_request.completed_at is not null then raise sqlstate 'PT409' using message='대기 중인 점검요청만 담당자를 변경할 수 있습니다. 새로고침하세요.';end if;
 if exists(select 1 from public.hdc_v2_work_archives where record_id=p_request and archived) then
 raise exception using errcode='42501',message='삭제 보관된 점검요청입니다. 공장장이 복원한 뒤 처리하세요.';end if;
 if v_request.assignee_id is distinct from p_expected then raise sqlstate 'PT409' using message='담당자가 이미 변경되었습니다. 새로고침 후 확인하세요.';end if;
 select display_name into v_name from public.hdc_v2_profiles where id=p_assignee and approved;
 if v_name is null then raise exception using errcode='22023',message='승인된 담당자를 선택하세요.';end if;
 if p_assignee=v_request.assignee_id then raise exception using errcode='22023',message='다른 담당자를 선택하세요.';end if;
 perform 1 from public.hdc_v2_records where id=p_request for update;
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_inspection_requests set assignee_id=p_assignee where id=p_request;
 update public.hdc_v2_records set version=version+1,updated_at=now(),
 body=body||jsonb_build_object('assignee',v_name,'version',version+1,'updatedAt',v_time)
 where id=p_request returning body into v_saved;
 insert into public.hdc_v2_assignment_events(request_id,previous_assignee,next_assignee,actor_id,reason)
 values(p_request,v_request.assignee_id,p_assignee,v_actor,btrim(p_reason));
 return v_saved;
end;$function$;


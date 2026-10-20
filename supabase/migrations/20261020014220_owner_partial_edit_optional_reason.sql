CREATE OR REPLACE FUNCTION hdc_v2_private.inspection_request_edit(p_request text, p_expected jsonb, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_before jsonb;v_saved jsonb;v_eq jsonb;v_equipment text;v_assignee uuid;v_name text;v_symptom text;v_time text;v_date text;v_due text;v_day date;v_reason text;v_key text;v_value text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor)
 then raise exception using errcode='42501',message='접수 내용 수정은 윤여철 공장장만 가능합니다.';end if;
 if char_length(coalesce(p_reason,''))>1000 or jsonb_typeof(p_patch) is distinct from 'object'
 or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_patch::text)>10000
 then raise exception using errcode='22023',message='수정 항목의 형식을 확인하세요.';end if;
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
 v_symptom:=case when p_patch ? 'symptom' then btrim(p_patch->>'symptom') else v_request.symptom end;
 if p_patch ? 'symptom' and char_length(v_symptom) not between 1 and 2000 then raise exception using errcode='22023',message='발견한 증상을 1~2,000자로 입력하세요.';end if;
 v_eq:=hdc_v2_private.hub_equipment(v_equipment);
 if (p_patch ? 'equipment_id') and (v_eq is null or exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=v_equipment and status='retired'))
 then raise exception using errcode='22023',message='사용 중인 설비를 선택하세요.';end if;
 select display_name into v_name from public.hdc_v2_profiles where id=v_assignee and approved;
 if (p_patch ? 'assignee_id') and v_name is null then raise exception using errcode='22023',message='승인된 담당자를 선택하세요.';end if;
 select body into v_before from public.hdc_v2_records where id=p_request for update;
 if v_before is null then raise exception '접수 기록을 찾을 수 없습니다.';end if;
 v_date:=coalesce(p_patch->>'date',v_before->>'date');v_due:=coalesce(p_patch->>'dueDate',v_before->>'dueDate','');
 foreach v_key in array array['date','dueDate'] loop
  if p_patch ? v_key then
   v_value:=p_patch->>v_key;
   if v_key='dueDate' and v_value='' then continue;end if;
   if v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='실제 달력 날짜를 선택하세요.';end if;
   begin
    v_day:=v_value::date;
    if to_char(v_day,'YYYY-MM-DD')<>v_value then raise exception using errcode='22023',message='실제 달력 날짜를 선택하세요.';end if;
   exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='실제 달력 날짜를 선택하세요.';end;
  end if;
 end loop;
 if (v_equipment,v_assignee,v_symptom,v_date,v_due) is not distinct from (v_request.equipment_id,v_request.assignee_id,v_request.symptom,v_before->>'date',coalesce(v_before->>'dueDate',''))
 then raise exception using errcode='22023',message='변경한 항목이 없습니다.';end if;
 update public.hdc_v2_inspection_requests set equipment_id=v_equipment,assignee_id=v_assignee,symptom=v_symptom,dates_managed=(dates_managed or (p_patch ? 'date') or (p_patch ? 'dueDate')) where id=p_request;
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),
 body=body||jsonb_build_object('version',version+1,'updatedAt',v_time)
 ||case when p_patch ? 'equipment_id' then jsonb_build_object('equipmentId',v_equipment,'equipmentName',v_eq->>'name','title',left('[일일점검요청] '||(v_eq->>'name'),200)) else '{}'::jsonb end
 ||case when p_patch ? 'assignee_id' then jsonb_build_object('assignee',v_name) else '{}'::jsonb end
 ||case when p_patch ? 'symptom' then jsonb_build_object('note',v_symptom) else '{}'::jsonb end
 ||case when p_patch ? 'date' then jsonb_build_object('date',v_date) else '{}'::jsonb end
 ||case when p_patch ? 'dueDate' then jsonb_build_object('dueDate',v_due) else '{}'::jsonb end
 where id=p_request returning body into v_saved;
 v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
 if v_reason is null then
 select '공장장 부분 수정: '||string_agg(case k when 'equipment_id' then '설비' when 'assignee_id' then '담당자' when 'symptom' then '증상' when 'date' then '기록 일자' when 'dueDate' then '완료 기한' end,', ' order by k)
 into v_reason from jsonb_object_keys(p_patch) k;
 end if;
 insert into public.hdc_v2_request_edit_events(request_id,actor_id,before_body,after_body,reason)
 values(p_request,v_actor,v_before,v_saved,v_reason);
 return v_saved;
end;$function$;


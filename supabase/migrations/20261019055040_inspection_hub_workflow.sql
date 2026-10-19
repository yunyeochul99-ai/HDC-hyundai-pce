begin;
create table public.hdc_v2_equipment_lifecycle(equipment_id text primary key,status text not null check(status in ('active','retired')),reason text not null,effective_on date not null,version integer not null default 1,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now());
create table public.hdc_v2_equipment_events(id bigint generated always as identity primary key,equipment_id text not null,action text not null,body jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table public.hdc_v2_inspection_requests(id text primary key references public.hdc_v2_records(id),equipment_id text not null,assignee_id uuid not null references auth.users(id),reporter_id uuid not null references auth.users(id),symptom text not null,inspection_id text unique references public.hdc_v2_records(id),created_at timestamptz not null default now(),completed_at timestamptz);
create index on public.hdc_v2_equipment_lifecycle(updated_by);
create index on public.hdc_v2_equipment_events(actor_id);
create index on public.hdc_v2_equipment_events(equipment_id);
create index on public.hdc_v2_inspection_requests(assignee_id);
create index on public.hdc_v2_inspection_requests(reporter_id);
alter table public.hdc_v2_equipment_lifecycle enable row level security;
alter table public.hdc_v2_equipment_events enable row level security;
alter table public.hdc_v2_inspection_requests enable row level security;
revoke all on public.hdc_v2_equipment_lifecycle,public.hdc_v2_equipment_events,public.hdc_v2_inspection_requests from public,anon,authenticated;
grant select on public.hdc_v2_equipment_lifecycle,public.hdc_v2_equipment_events,public.hdc_v2_inspection_requests to authenticated;
create policy equipment_lifecycle_read on public.hdc_v2_equipment_lifecycle for select to authenticated using((select hdc_v2_private.is_approved()));
create policy equipment_events_read on public.hdc_v2_equipment_events for select to authenticated using((select hdc_v2_private.is_approved()));
create policy inspection_requests_read on public.hdc_v2_inspection_requests for select to authenticated using((select hdc_v2_private.is_approved()));
create function hdc_v2_private.hub_equipment(p_id text) returns jsonb language sql stable security definer set search_path='' as $fn$
 select body from public.hdc_v2_custom_equipment where id=p_id union all select e.value from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'equipment') e where s.key='factory' and e.value->>'id'=p_id limit 1;
$fn$;
revoke all on function hdc_v2_private.hub_equipment(text) from public,anon,authenticated;
create function hdc_v2_private.inspection_hub() returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]'::jsonb) from public.hdc_v2_profiles where approved),'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc),'[]'::jsonb) from public.hdc_v2_inspection_requests r),'lifecycle',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.hdc_v2_equipment_lifecycle l));
end;$fn$;
create function hdc_v2_private.equipment_action(p_equipment text,p_action text,p_body jsonb,p_version integer) returns void language plpgsql security definer set search_path='' as $fn$
declare v_equipment jsonb;v_actor uuid:=auth.uid();v_version integer;v_date date;v_reason text;
begin
 if v_actor is null or not hdc_v2_private.is_admin() then raise insufficient_privilege;end if;
 if p_equipment is null or p_equipment<>upper(btrim(p_equipment)) or char_length(p_equipment) not between 1 and 100 or p_equipment ~ '[[:cntrl:]]' or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>4096 or p_action is null or p_action not in ('purchase','retire','reactivate') then raise exception using errcode='22023',message='설비 정보와 처리 유형을 확인하세요.';end if;
 v_reason:=btrim(coalesce(p_body->>'reason',''));v_date:=(p_body->>'date')::date;
 if char_length(v_reason) not between 1 and 1000 or v_date is null then raise exception using errcode='22023',message='처리 사유와 적용일을 입력하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('equipment:'||p_equipment,0));
 v_equipment:=hdc_v2_private.hub_equipment(p_equipment);
 select version into v_version from public.hdc_v2_equipment_lifecycle where equipment_id=p_equipment for update;
 if p_version is distinct from coalesce(v_version,0) then raise sqlstate 'PT409' using message='설비 상태가 변경되었습니다. 새로고침하세요.';end if;
 if p_action='purchase' then
  if v_equipment is not null then raise sqlstate 'PT409' using message='이미 등록된 설비 코드입니다.';end if;
  if char_length(btrim(coalesce(p_body->>'name',''))) not between 1 and 200 or char_length(coalesce(p_body->>'model',''))>200 or char_length(coalesce(p_body->>'category',''))>100 then raise exception using errcode='22023',message='설비명·모델·분류를 확인하세요.';end if;
  v_equipment:=jsonb_build_object('id',p_equipment,'name',btrim(p_body->>'name'),'model',coalesce(p_body->>'model',''),'category',coalesce(nullif(p_body->>'category',''),'기타'),'grade','미분류','cycle','현장 확인 필요','isCustom',true,'source',jsonb_build_object('id','APP-CUSTOM','sheet','구입 설비 등록'));
  insert into public.hdc_v2_custom_equipment(id,body,created_by) values(p_equipment,v_equipment,v_actor);
 elsif v_equipment is null then raise exception using errcode='22023',message='등록된 설비가 아닙니다.';
 end if;
 insert into public.hdc_v2_equipment_lifecycle(equipment_id,status,reason,effective_on,updated_by) values(p_equipment,case when p_action='retire' then 'retired' else 'active' end,v_reason,v_date,v_actor)
 on conflict(equipment_id) do update set status=excluded.status,reason=excluded.reason,effective_on=excluded.effective_on,updated_by=v_actor,updated_at=now(),version=hdc_v2_equipment_lifecycle.version+1;
 insert into public.hdc_v2_equipment_events(equipment_id,action,body,actor_id) values(p_equipment,p_action,p_body,v_actor);
end;$fn$;
create function hdc_v2_private.inspection_request(p_id text,p_equipment text,p_assignee uuid,p_symptom text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_eq jsonb;v_name text;v_old public.hdc_v2_inspection_requests%rowtype;v_record jsonb;v_saved jsonb;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 if p_id is null or p_id !~ '^REQ-[0-9a-f-]{36}$' or p_symptom is null or char_length(btrim(p_symptom)) not between 1 and 2000 then raise exception using errcode='22023',message='증상을 1~2,000자로 입력하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('inspection-request:'||p_id,0));
 select * into v_old from public.hdc_v2_inspection_requests where id=p_id;
 if found then
  if v_old.reporter_id<>v_actor or v_old.equipment_id is distinct from p_equipment or v_old.assignee_id is distinct from p_assignee or v_old.symptom<>btrim(p_symptom) then raise sqlstate 'PT409' using message='이미 처리된 접수 번호입니다. 목록을 확인하세요.';end if;
  select body into v_saved from public.hdc_v2_records where id=p_id;return v_saved;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('equipment:'||p_equipment,0));
 v_eq:=hdc_v2_private.hub_equipment(p_equipment);
 if v_eq is null or exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=p_equipment and status='retired') then raise exception using errcode='22023',message='사용 중인 설비를 선택하세요.';end if;
 select display_name into v_name from public.hdc_v2_profiles where id=p_assignee and approved;
 if v_name is null then raise exception using errcode='22023',message='승인된 점검 담당자를 지정하세요.';end if;
 v_record:=jsonb_build_object('id',p_id,'type','workorder','equipmentId',p_equipment,'equipmentName',v_eq->>'name','title',left('[일일점검요청] '||(v_eq->>'name'),200),'status','접수','priority','보통','assignee',v_name,'date',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'),'dueDate','','note',btrim(p_symptom),'items','[]'::jsonb,'photoIds','[]'::jsonb,'version',0);
 v_saved:=hdc_v2_private.save_planned_record(v_record,null);
 insert into public.hdc_v2_inspection_requests(id,equipment_id,assignee_id,reporter_id,symptom) values(p_id,p_equipment,p_assignee,v_actor,btrim(p_symptom));
 return v_saved;
end;$fn$;
create function hdc_v2_private.inspection_finish(p_request text,p_record jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_saved jsonb;v_time text;v_record jsonb;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 select * into v_request from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or (v_request.assignee_id<>v_actor and not hdc_v2_private.is_admin()) then raise insufficient_privilege;end if;
 if exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=v_request.equipment_id and status='retired') then raise exception using errcode='22023',message='폐기 설비의 점검요청은 관리자에게 확인하세요.';end if;
 if p_record->>'type' is distinct from 'inspection' or p_record->>'equipmentId' is distinct from v_request.equipment_id or (v_request.inspection_id is not null and v_request.inspection_id is distinct from p_record->>'id') then raise exception using errcode='22023',message='해당 설비의 점검 결과를 등록하세요.';end if;
 if exists(select 1 from jsonb_array_elements(p_record->'items') i where i->>'result'='미점검') or jsonb_array_length(p_record->'items')=0 then raise exception using errcode='22023',message='모든 점검 결과를 입력하세요.';end if;
 v_record:=p_record||jsonb_build_object('assignee',(select display_name from public.hdc_v2_profiles where id=v_request.assignee_id));
 v_saved:=hdc_v2_private.save_planned_record(v_record,null);
 update public.hdc_v2_inspection_requests set inspection_id=v_saved->>'id',completed_at=now() where id=p_request;
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),body=body||jsonb_build_object('status','완료','version',version+1,'updatedAt',v_time) where id=p_request;
 return v_saved;
end;$fn$;
revoke all on function hdc_v2_private.inspection_hub(),hdc_v2_private.equipment_action(text,text,jsonb,integer),hdc_v2_private.inspection_request(text,text,uuid,text),hdc_v2_private.inspection_finish(text,jsonb) from public,anon,authenticated;
grant execute on function hdc_v2_private.inspection_hub(),hdc_v2_private.equipment_action(text,text,jsonb,integer),hdc_v2_private.inspection_request(text,text,uuid,text),hdc_v2_private.inspection_finish(text,jsonb) to authenticated;
create function public.hdc_v2_inspection_hub() returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.inspection_hub();$fn$;
create function public.hdc_v2_equipment_action(p_equipment text,p_action text,p_body jsonb,p_version integer) returns void language sql security invoker set search_path='' as $fn$select hdc_v2_private.equipment_action(p_equipment,p_action,p_body,p_version);$fn$;
create function public.hdc_v2_inspection_request(p_id text,p_equipment text,p_assignee uuid,p_symptom text) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.inspection_request(p_id,p_equipment,p_assignee,p_symptom);$fn$;
create function public.hdc_v2_inspection_finish(p_request text,p_record jsonb) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.inspection_finish(p_request,p_record);$fn$;
revoke all on function public.hdc_v2_inspection_hub(),public.hdc_v2_equipment_action(text,text,jsonb,integer),public.hdc_v2_inspection_request(text,text,uuid,text),public.hdc_v2_inspection_finish(text,jsonb) from public,anon,authenticated;
grant execute on function public.hdc_v2_inspection_hub(),public.hdc_v2_equipment_action(text,text,jsonb,integer),public.hdc_v2_inspection_request(text,text,uuid,text),public.hdc_v2_inspection_finish(text,jsonb) to authenticated;
create or replace function hdc_v2_private.form_action(p_template_id text,p_action text,p_reason text,p_version integer) returns void language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_row public.hdc_v2_form_archives%rowtype;v_state text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 or p_action is null or p_action not in ('request','approve','reject','restore') then raise exception using errcode='22023',message='처리 유형과 사유를 확인하세요.';end if;
 if p_template_id is null or not (exists(select 1 from public.hdc_v2_custom_checklists where id=p_template_id) or (p_template_id ~ '^AUTO-(DAILY|WEEKLY|MONTHLY)-' and hdc_v2_private.hub_equipment(regexp_replace(p_template_id,'^AUTO-(DAILY|WEEKLY|MONTHLY)-','')) is not null) or exists(select 1 from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'checklists') c where s.key='factory' and c.value->>'id'=p_template_id)) then raise exception using errcode='22023',message='등록된 점검 양식이 아닙니다.';end if;
 perform pg_advisory_xact_lock(hashtextextended('form-archive:'||p_template_id,0));
 select * into v_row from public.hdc_v2_form_archives where template_id=p_template_id for update;
 if p_version is distinct from coalesce(v_row.version,0) then raise sqlstate 'PT409' using message='양식 상태가 변경되었습니다. 새로고침 후 다시 처리하세요.';end if;
 if p_action='request' then
  if v_row.state in ('pending','approved') then raise sqlstate 'PT409' using message='이미 삭제 요청 중이거나 삭제된 양식입니다.';end if;
  insert into public.hdc_v2_form_archives(template_id,state,reason,requested_by) values(p_template_id,'pending',btrim(p_reason),v_actor)
  on conflict(template_id) do update set state='pending',reason=excluded.reason,requested_by=v_actor,requested_at=now(),decided_by=null,decided_at=null,decision_note=null,version=hdc_v2_form_archives.version+1;
 else
  if not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then raise exception using errcode='42501',message='지정된 전용 승인자만 삭제 승인·반려·복원할 수 있습니다.';end if;
  if (p_action in ('approve','reject') and v_row.state is distinct from 'pending') or (p_action='restore' and v_row.state is distinct from 'approved') then raise sqlstate 'PT409' using message='현재 양식 상태에서 처리할 수 없습니다.';end if;
  v_state:=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'restored' end;
  update public.hdc_v2_form_archives set state=v_state,decided_by=v_actor,decided_at=now(),decision_note=btrim(p_reason),version=version+1 where template_id=p_template_id;
 end if;
 insert into public.hdc_v2_form_archive_events(template_id,actor_id,action,reason) values(p_template_id,v_actor,p_action,btrim(p_reason));
end;$fn$;
create or replace function hdc_v2_private.save_planned_record(p_record jsonb,p_planning jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid();v_is_admin boolean;v_old jsonb;v_plan jsonb;v_policy jsonb;v_saved jsonb;v_existing jsonb;
 v_key text;v_val numeric;v_day date;v_changed boolean;v_special boolean;v_status text;v_old_approval text;v_previous_approver uuid;v_previous_approved_at timestamptz;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise exception using errcode='42501',message='승인된 사용자만 작업을 저장할 수 있습니다.';end if;
 if jsonb_typeof(p_record) is distinct from 'object' or p_record->>'id' is null then raise exception using errcode='22023',message='기록 형식을 확인하세요.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_record->>'id',0));
 select body into v_existing from public.hdc_v2_records where id=p_record->>'id';
 if v_existing is not null and v_existing->>'type' is distinct from p_record->>'type' then raise exception using errcode='22023',message='저장된 기록의 종류는 변경할 수 없습니다.';end if;
 if exists(select 1 from public.hdc_v2_inspection_requests where id=p_record->>'id') then raise exception using errcode='42501',message='시설팀 점검요청은 점검 결과 등록으로 처리하세요.';end if;
 if coalesce((p_record->>'version')::integer,0)=0 and exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=p_record->>'equipmentId' and status='retired') then raise exception using errcode='22023',message='폐기 설비에는 새 점검·작업을 등록할 수 없습니다.';end if;
 if p_record->>'type'='inspection' then return hdc_v2_private.save_record(p_record);end if;
 v_is_admin:=hdc_v2_private.is_admin();
 select planning,approved_by,approved_at into v_old,v_previous_approver,v_previous_approved_at from public.hdc_v2_work_plans where record_id=p_record->>'id' for update;
 select payload into v_policy from public.hdc_v2_maintenance_policy where key='factory';
 v_plan:=coalesce(p_planning,v_old,'{}'::jsonb);
 if jsonb_typeof(v_plan) is distinct from 'object' or octet_length(v_plan::text)>12000 then raise exception using errcode='22023',message='작업 계획 형식을 확인하세요.';end if;
 if exists(select 1 from jsonb_object_keys(v_plan) k where k not in ('category','plannedDate','window','estimatedMinutes','estimatedCost','actualMinutes','actualCost','qualityImpact','productionImpact','idleEquipment','safetyChecked','functionChecked','qualityChecked','productionHandedOver','approval','approvalNote','emergencyReason')) then raise exception using errcode='22023',message='허용되지 않은 계획 필드입니다.';end if;
 v_plan:=jsonb_build_object('category','고장수리','plannedDate','','window','unplanned','estimatedMinutes',null,'estimatedCost',null,'actualMinutes',null,'actualCost',null,'qualityImpact',false,'productionImpact',false,'idleEquipment',false,'safetyChecked',false,'functionChecked',false,'qualityChecked',false,'productionHandedOver',false,'approval','미검토','approvalNote','','emergencyReason','')||v_plan;
 if jsonb_typeof(v_plan->'category') is distinct from 'string' or v_plan->>'category' not in ('예방보전','상태기반','고장수리','개선보전','유휴설비관리','긴급사후보전') or jsonb_typeof(v_plan->'window') is distinct from 'string' or v_plan->>'window' not in ('morning','weekday','unplanned','sundayEmergency') or jsonb_typeof(v_plan->'approval') is distinct from 'string' or v_plan->>'approval' not in ('미검토','검토요청','승인','반려') then raise exception using errcode='22023',message='작업 구분·시간대·승인 상태를 확인하세요.';end if;
 if jsonb_typeof(v_plan->'emergencyReason') is distinct from 'string' or char_length(v_plan->>'emergencyReason')>2000 then raise exception using errcode='22023',message='일요일 작업 사유는 2000자 이하로 입력하세요.';end if;
 if v_old is not null then v_old:='{"emergencyReason":""}'::jsonb||v_old;end if;
 if jsonb_typeof(v_plan->'plannedDate') is distinct from 'string' or jsonb_typeof(v_plan->'approvalNote') is distinct from 'string' or char_length(v_plan->>'approvalNote')>2000 then raise exception using errcode='22023',message='계획일 또는 검토 메모를 확인하세요.';end if;
 foreach v_key in array array['qualityImpact','productionImpact','idleEquipment','safetyChecked','functionChecked','qualityChecked','productionHandedOver'] loop
  if jsonb_typeof(v_plan->v_key) is distinct from 'boolean' then raise exception using errcode='22023',message='작업 확인 항목은 체크값이어야 합니다.';end if;
 end loop;
 foreach v_key in array array['estimatedMinutes','estimatedCost','actualMinutes','actualCost'] loop
  if v_plan->v_key<>'null'::jsonb then
   if jsonb_typeof(v_plan->v_key) is distinct from 'number' then raise exception using errcode='22023',message='시간과 비용은 숫자로 입력하세요.';end if;
   v_val:=(v_plan->>v_key)::numeric;
   if v_val<0 or v_val>(case when v_key like '%Minutes' then 525600 else 1000000000000000 end) or trunc(v_val)<>v_val then raise exception using errcode='22023',message='시간과 비용은 허용 범위의 0 이상 정수로 입력하세요.';end if;
  end if;
 end loop;
 if v_plan->>'plannedDate'<>'' then
  if v_plan->>'plannedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='계획일 형식을 확인하세요.';end if;
  begin v_day:=(v_plan->>'plannedDate')::date;exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='실제 달력 날짜를 선택하세요.';end;
  if to_char(v_day,'YYYY-MM-DD')<>v_plan->>'plannedDate' then raise exception using errcode='22023',message='계획일을 확인하세요.';end if;
  if extract(isodow from v_day)=7 and not (v_plan->>'category'='긴급사후보전' and v_plan->>'window'='sundayEmergency') then raise exception using errcode='22023',message='일요일은 긴급사후보전과 일요일 특별 작업 시간대를 선택해야 합니다.';end if;
 end if;
 if v_plan->>'window'='sundayEmergency' then
  if v_day is not null and extract(isodow from v_day)<>7 then raise exception using errcode='22023',message='일요일 특별 작업은 일요일 날짜를 선택하세요.';end if;
  if v_plan->>'category'<>'긴급사후보전' or (v_plan->>'emergencyReason') !~ '[^[:space:]]' then raise exception using errcode='22023',message='긴급사후보전 구분과 불가피한 일요일 작업 사유를 입력하세요.';end if;
 end if;
 if v_plan->>'window'='morning' and (v_plan->>'estimatedMinutes')::numeric>90 then raise exception using errcode='22023',message='08:00~09:30은 준비·복구시험·인계를 포함하여 90분 이내여야 합니다.';end if;
 v_changed:=v_old is null or (v_plan-array['actualMinutes','actualCost','safetyChecked','functionChecked','qualityChecked','productionHandedOver','approval','approvalNote']) is distinct from (v_old-array['actualMinutes','actualCost','safetyChecked','functionChecked','qualityChecked','productionHandedOver','approval','approvalNote']) or (p_record->'equipmentId',p_record->'title',p_record->'priority') is distinct from (v_existing->'equipmentId',v_existing->'title',v_existing->'priority') or (coalesce((v_plan->>'actualCost')::numeric,-1)>greatest(coalesce((v_old->>'estimatedCost')::numeric,-1),coalesce((v_old->>'actualCost')::numeric,-1)) and (v_plan->>'actualCost')::numeric>=(v_policy->>'highCostThreshold')::numeric);
 v_old_approval:=coalesce(v_old->>'approval','미검토');
 if not v_is_admin and v_plan->>'approval' in ('승인','반려') then
  if v_plan->>'approval'<>v_old_approval then raise exception using errcode='42501',message='승인·반려는 관리자만 할 수 있습니다.';end if;
  if v_changed then v_plan:=v_plan||'{"approval":"미검토","approvalNote":"계획 변경으로 재검토가 필요합니다."}'::jsonb;
  elsif v_plan->'approvalNote' is distinct from v_old->'approvalNote' then raise exception using errcode='42501',message='관리자의 승인 의견은 변경할 수 없습니다.';end if;
 end if;
 if v_changed and not v_is_admin and v_old_approval='승인' then v_plan:=v_plan||'{"approval":"미검토"}'::jsonb;end if;
 v_special:=(v_plan->>'window'='sundayEmergency') or coalesce((v_plan->>'estimatedMinutes')::numeric>90,false) or (v_policy->>'highCostThreshold' is not null and greatest(coalesce((v_plan->>'estimatedCost')::numeric,-1),coalesce((v_plan->>'actualCost')::numeric,-1))>=(v_policy->>'highCostThreshold')::numeric);
 v_status:=p_record->>'status';
 if v_status in ('배정','진행','완료') then
  if v_day is null or v_plan->>'window'='unplanned' or v_plan->>'estimatedMinutes' is null or (v_plan->>'estimatedMinutes')::numeric<=0 or v_plan->>'estimatedCost' is null then raise exception using errcode='22023',message='배정·실행 전에 근무일 계획일·시간대·예상 소요시간·예상비용을 입력하세요.';end if;
  if (v_special and v_plan->>'approval'<>'승인') or v_plan->>'approval'='반려' then raise exception using errcode='42501',message='장기·고액·일요일 긴급 작업은 관리자 승인 후 배정·실행하세요.';end if;
 end if;
 if v_status in ('진행','완료') and not (v_plan->>'safetyChecked')::boolean then raise exception using errcode='22023',message='작업 전 안전 확인을 완료하세요.';end if;
 if v_status='완료' and (not (v_plan->>'functionChecked')::boolean or not (v_plan->>'qualityChecked')::boolean or not (v_plan->>'productionHandedOver')::boolean or v_plan->>'actualMinutes' is null or v_plan->>'actualCost' is null) then raise exception using errcode='22023',message='완료 전에 기능·품질·생산 인계 확인과 실제 시간·비용을 입력하세요.';end if;
 if v_status='완료' and jsonb_typeof(p_record->'items')='array' and exists(select 1 from jsonb_array_elements(p_record->'items') i where i->>'result' in ('불량','미점검')) then raise exception using errcode='22023',message='작업 체크리스트의 불량·미점검 항목을 조치하고 결과를 확인한 뒤 완료하세요.';end if;
 v_saved:=hdc_v2_private.save_record(p_record);
 insert into public.hdc_v2_work_plans(record_id,planning,approved_by,approved_at,updated_by) values(v_saved->>'id',v_plan,
  case when v_plan->>'approval'='승인' then case when v_is_admin then v_actor else v_previous_approver end end,
  case when v_plan->>'approval'='승인' then case when v_is_admin then clock_timestamp() else v_previous_approved_at end end,v_actor)
 on conflict(record_id) do update set planning=excluded.planning,approved_by=excluded.approved_by,approved_at=excluded.approved_at,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return v_saved||jsonb_build_object('planning',v_plan);
end;$fn$;
notify pgrst,'reload schema';
commit;

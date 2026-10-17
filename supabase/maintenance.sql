-- Apply after schema.sql/storage.sql. Preserves all existing records and photos.
begin;
create table if not exists public.hdc_v2_maintenance_policy(
 key text primary key check(key='factory'),payload jsonb not null,
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
create table if not exists public.hdc_v2_work_plans(
 record_id text primary key references public.hdc_v2_records(id),planning jsonb not null,
 approved_by uuid references auth.users(id),approved_at timestamptz,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
alter table public.hdc_v2_maintenance_policy enable row level security;
alter table public.hdc_v2_work_plans enable row level security;
revoke all on public.hdc_v2_maintenance_policy,public.hdc_v2_work_plans from public,anon,authenticated;
grant select on public.hdc_v2_maintenance_policy,public.hdc_v2_work_plans to authenticated;
drop policy if exists maintenance_policy_read on public.hdc_v2_maintenance_policy;
create policy maintenance_policy_read on public.hdc_v2_maintenance_policy for select to authenticated using((select hdc_v2_private.is_approved()));
drop policy if exists work_plans_read on public.hdc_v2_work_plans;
create policy work_plans_read on public.hdc_v2_work_plans for select to authenticated using((select hdc_v2_private.is_approved()));
insert into public.hdc_v2_maintenance_policy(key,payload) values('factory',jsonb_build_object(
 'highCostThreshold',1000000,'manufacturingCost',null,'costPeriod',to_char(now() at time zone 'Asia/Seoul','YYYY-MM'),'policyVersion',1
)) on conflict(key) do nothing;

create or replace function hdc_v2_private.save_maintenance_policy(p_policy jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_old jsonb;v_new jsonb;v_key text;v_value numeric;
begin
 if auth.uid() is null or not hdc_v2_private.is_admin() then raise exception using errcode='42501',message='관리자만 보전 정책을 변경할 수 있습니다.';end if;
 if jsonb_typeof(p_policy) is distinct from 'object' or octet_length(p_policy::text)>4096 then raise exception using errcode='22023',message='정책 형식을 확인하세요.';end if;
 if exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('highCostThreshold','manufacturingCost','costPeriod','policyVersion')) then raise exception using errcode='22023',message='허용되지 않은 정책 필드입니다.';end if;
 foreach v_key in array array['highCostThreshold','manufacturingCost'] loop
  if p_policy->v_key is not null and p_policy->v_key<>'null'::jsonb then
   if jsonb_typeof(p_policy->v_key)<>'number' then raise exception using errcode='22023',message='금액은 숫자로 입력하세요.';end if;
   v_value:=(p_policy->>v_key)::numeric;
   if v_value<=0 or v_value>1000000000000000 or trunc(v_value)<>v_value then raise exception using errcode='22023',message='정책 금액은 1원 이상의 정수로 입력하세요.';end if;
  end if;
 end loop;
 if jsonb_typeof(p_policy->'costPeriod') is distinct from 'string' or p_policy->>'costPeriod' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception using errcode='22023',message='제조원가 집계 월을 선택하세요.';end if;
 select payload into v_old from public.hdc_v2_maintenance_policy where key='factory' for update;
 if p_policy->'policyVersion' is distinct from v_old->'policyVersion' then raise sqlstate 'PT409' using message='VERSION_CONFLICT',detail=v_old::text;end if;
 v_new:=jsonb_build_object('highCostThreshold',p_policy->'highCostThreshold','manufacturingCost',p_policy->'manufacturingCost','costPeriod',p_policy->>'costPeriod','policyVersion',(v_old->>'policyVersion')::int+1);
 update public.hdc_v2_maintenance_policy set payload=v_new,updated_by=auth.uid(),updated_at=clock_timestamp() where key='factory';
 return v_new;
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
 if p_record->>'type'='inspection' then return hdc_v2_private.save_record(p_record);end if;
 v_is_admin:=hdc_v2_private.is_admin();
 select planning,approved_by,approved_at into v_old,v_previous_approver,v_previous_approved_at from public.hdc_v2_work_plans where record_id=p_record->>'id' for update;
 select payload into v_policy from public.hdc_v2_maintenance_policy where key='factory';
 v_plan:=coalesce(p_planning,v_old,'{}'::jsonb);
 if jsonb_typeof(v_plan) is distinct from 'object' or octet_length(v_plan::text)>12000 then raise exception using errcode='22023',message='작업 계획 형식을 확인하세요.';end if;
 if exists(select 1 from jsonb_object_keys(v_plan) k where k not in ('category','plannedDate','window','estimatedMinutes','estimatedCost','actualMinutes','actualCost','qualityImpact','productionImpact','idleEquipment','safetyChecked','functionChecked','qualityChecked','productionHandedOver','approval','approvalNote')) then raise exception using errcode='22023',message='허용되지 않은 계획 필드입니다.';end if;
 v_plan:=jsonb_build_object('category','고장수리','plannedDate','','window','unplanned','estimatedMinutes',null,'estimatedCost',null,'actualMinutes',null,'actualCost',null,'qualityImpact',false,'productionImpact',false,'idleEquipment',false,'safetyChecked',false,'functionChecked',false,'qualityChecked',false,'productionHandedOver',false,'approval','미검토','approvalNote','')||v_plan;
 if jsonb_typeof(v_plan->'category') is distinct from 'string' or v_plan->>'category' not in ('예방보전','상태기반','고장수리','개선보전','유휴설비관리') or jsonb_typeof(v_plan->'window') is distinct from 'string' or v_plan->>'window' not in ('morning','weekday','unplanned') or jsonb_typeof(v_plan->'approval') is distinct from 'string' or v_plan->>'approval' not in ('미검토','검토요청','승인','반려') then raise exception using errcode='22023',message='작업 구분·시간대·승인 상태를 확인하세요.';end if;
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
  if extract(isodow from v_day) in (6,7) then raise exception using errcode='22023',message='주말 계획 작업은 금지됩니다. 평일로 조정하세요.';end if;
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
 v_special:=coalesce((v_plan->>'estimatedMinutes')::numeric>90,false) or (v_policy->>'highCostThreshold' is not null and greatest(coalesce((v_plan->>'estimatedCost')::numeric,-1),coalesce((v_plan->>'actualCost')::numeric,-1))>=(v_policy->>'highCostThreshold')::numeric);
 v_status:=p_record->>'status';
 if v_status in ('배정','진행','완료') then
  if v_day is null or v_plan->>'window'='unplanned' or v_plan->>'estimatedMinutes' is null or (v_plan->>'estimatedMinutes')::numeric<=0 or v_plan->>'estimatedCost' is null then raise exception using errcode='22023',message='배정·실행 전에 평일 계획일·시간대·예상 소요시간·예상비용을 입력하세요.';end if;
  if (v_special and v_plan->>'approval'<>'승인') or v_plan->>'approval'='반려' then raise exception using errcode='42501',message='장기·고액 작업은 관리자 승인 후 배정·실행하세요.';end if;
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
revoke all on function hdc_v2_private.save_record(jsonb) from public,anon,authenticated;
revoke all on function hdc_v2_private.save_planned_record(jsonb,jsonb),hdc_v2_private.save_maintenance_policy(jsonb) from public,anon,authenticated;
grant execute on function hdc_v2_private.save_planned_record(jsonb,jsonb),hdc_v2_private.save_maintenance_policy(jsonb) to authenticated;
create or replace function public.hdc_v2_save_planned_record(p_record jsonb,p_planning jsonb default null) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.save_planned_record(p_record,p_planning);$fn$;
create or replace function public.hdc_v2_save_record(p_record jsonb) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.save_planned_record(p_record,null);$fn$;
create or replace function public.hdc_v2_save_maintenance_policy(p_policy jsonb) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.save_maintenance_policy(p_policy);$fn$;
revoke all on function public.hdc_v2_save_planned_record(jsonb,jsonb),public.hdc_v2_save_record(jsonb),public.hdc_v2_save_maintenance_policy(jsonb) from public,anon,authenticated;
grant execute on function public.hdc_v2_save_planned_record(jsonb,jsonb),public.hdc_v2_save_record(jsonb),public.hdc_v2_save_maintenance_policy(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

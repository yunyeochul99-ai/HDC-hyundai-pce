begin;
create function hdc_v2_private.preventive_equipment_matches(p_template text,p_actual text) returns boolean language sql stable set search_path='' as $fn$select hdc_v2_private.hub_equipment(p_actual) is not null and (p_template=p_actual or hdc_v2_private.hub_equipment(p_template) is null);$fn$;
revoke all on function hdc_v2_private.preventive_equipment_matches(text,text) from public,anon,authenticated;
create or replace function hdc_v2_private.preventive_save(p_id text,p_body jsonb,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_owner boolean;v_source jsonb;v_existing public.hdc_v2_preventive_plans%rowtype;v_eq jsonb;v_body jsonb;v_item jsonb;v_key text;v_limit integer;v_items jsonb:='[]'::jsonb;v_saved public.hdc_v2_preventive_plans%rowtype;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 v_owner:=exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor);
 select w.value into v_source from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'workorders') w where s.key='factory' and w.value->>'id'=p_id;
 if p_id is null or char_length(p_id)>100 or (v_source is null and p_id !~ '^USR-PM-[0-9a-f-]{36}$') or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>131072 then raise exception using errcode='22023',message='계획 형식을 확인하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('preventive:'||p_id,0));
 select * into v_existing from public.hdc_v2_preventive_plans where id=p_id for update;
 if (v_existing.id is not null or v_source is not null) and not v_owner then raise exception using errcode='42501',message='본인 전용 승인자만 계획을 편집할 수 있습니다.';end if;
 if p_version is distinct from coalesce(v_existing.version,0) then raise sqlstate 'PT409' using message='계획이 변경되었습니다. 새로고침 후 다시 편집하세요.';end if;
 if v_existing.state='archived' then raise exception using errcode='22023',message='삭제된 계획은 먼저 복원하세요.';end if;
 if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('equipment','title','cycle','method','priority','criteria','materials','estimatedCost','evidence','dataNote','checklist')) then raise exception using errcode='22023',message='허용되지 않은 계획 필드입니다.';end if;
 foreach v_key in array array['equipment','title','cycle','method','priority','criteria','materials','estimatedCost','evidence','dataNote'] loop
  v_limit:=case v_key when 'equipment' then 100 when 'title' then 200 when 'criteria' then 2000 when 'materials' then 1000 when 'evidence' then 2000 when 'dataNote' then 1000 else 100 end;
  if jsonb_typeof(p_body->v_key) is distinct from 'string' or char_length(p_body->>v_key)>v_limit or (v_key in ('equipment','title','cycle','method','priority') and btrim(p_body->>v_key)='') then raise exception using errcode='22023',message='계획의 필수 입력과 길이를 확인하세요: '||v_key;end if;
 end loop;
 v_eq:=hdc_v2_private.hub_equipment(p_body->>'equipment');
 if v_eq is null and v_source->>'equipment'=p_body->>'equipment' then v_eq:=jsonb_build_object('id',v_source->>'equipment','name',v_source->>'equipmentName','grade',coalesce(v_source->>'grade','미분류'));end if;
 if v_eq is null or exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=p_body->>'equipment' and status='retired') then raise exception using errcode='22023',message='사용 중인 설비를 선택하세요.';end if;
 if jsonb_typeof(p_body->'checklist') is distinct from 'array' or jsonb_array_length(p_body->'checklist')>100 then raise exception using errcode='22023',message='점검 항목은 100개 이하의 배열이어야 합니다.';end if;
 for v_item in select value from jsonb_array_elements(p_body->'checklist') loop
  if jsonb_typeof(v_item) is distinct from 'object' then raise invalid_parameter_value;end if;
  if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('name','criteria')) or jsonb_typeof(v_item->'name') is distinct from 'string' or char_length(btrim(v_item->>'name')) not between 1 and 200 or jsonb_typeof(v_item->'criteria') is distinct from 'string' or char_length(btrim(v_item->>'criteria')) not between 1 and 1000 then raise exception using errcode='22023',message='점검 항목명과 판정 기준을 확인하세요.';end if;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('name',btrim(v_item->>'name'),'criteria',btrim(v_item->>'criteria')));
 end loop;
 v_body:=p_body||jsonb_build_object('id',p_id,'equipmentName',v_eq->>'name','grade',coalesce(v_eq->>'grade','미분류'),'checklist',v_items,'source',coalesce(v_source->'source',jsonb_build_object('id','APP-PM','sheet','앱 추가 예방정비 계획')));
 insert into public.hdc_v2_preventive_plans(id,body,state,version,created_by,updated_by) values(p_id,v_body,'pending',1,v_actor,v_actor)
 on conflict(id) do update set body=excluded.body,state='pending',version=hdc_v2_preventive_plans.version+1,updated_by=v_actor,updated_at=now(),decision_note='' returning * into v_saved;
 insert into public.hdc_v2_preventive_events(plan_id,action,actor_id,body,state,note) values(p_id,'save',v_actor,v_body,'pending','계획 저장 · 승인 대기');
 return to_jsonb(v_saved);
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
 if p_record->>'version'='0' and p_record ? 'preventivePlanId' then
  perform pg_advisory_xact_lock(hashtextextended('preventive:'||(p_record->>'preventivePlanId'),0));
  if exists(select 1 from public.hdc_v2_preventive_plans where id=p_record->>'preventivePlanId') then
   if not exists(select 1 from public.hdc_v2_preventive_plans where id=p_record->>'preventivePlanId' and state='approved' and hdc_v2_private.preventive_equipment_matches(body->>'equipment',p_record->>'equipmentId')) then raise exception using errcode='42501',message='승인된 해당 설비의 예방정비 계획만 작업으로 접수할 수 있습니다.';end if;
  elsif not exists(select 1 from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'workorders') w where s.key='factory' and w.value->>'id'=p_record->>'preventivePlanId' and hdc_v2_private.preventive_equipment_matches(w.value->>'equipment',p_record->>'equipmentId')) then raise exception using errcode='22023',message='예방정비 계획과 설비 연결을 확인하세요.';end if;
 end if;
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

-- Versioned overlays preserve source plans and existing operational work orders.
begin;
create table public.hdc_v2_preventive_plans(id text primary key,body jsonb not null,state text not null check(state in ('pending','approved','rejected','archived')),version integer not null check(version>0),created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),decision_note text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.hdc_v2_preventive_events(id bigint generated always as identity primary key,plan_id text not null references public.hdc_v2_preventive_plans(id),action text not null,actor_id uuid not null references auth.users(id),body jsonb not null,state text not null,note text not null,created_at timestamptz not null default now());
create index on public.hdc_v2_preventive_plans(created_by);
create index on public.hdc_v2_preventive_plans(updated_by);
create index on public.hdc_v2_preventive_events(plan_id);
create index on public.hdc_v2_preventive_events(actor_id);
alter table public.hdc_v2_preventive_plans enable row level security;
alter table public.hdc_v2_preventive_events enable row level security;
revoke all on public.hdc_v2_preventive_plans,public.hdc_v2_preventive_events from public,anon,authenticated;
grant select on public.hdc_v2_preventive_plans,public.hdc_v2_preventive_events to authenticated;
create policy preventive_plans_read on public.hdc_v2_preventive_plans for select to authenticated using((select hdc_v2_private.is_approved()));
create policy preventive_events_read on public.hdc_v2_preventive_events for select to authenticated using((select hdc_v2_private.is_approved()));
create function hdc_v2_private.preventive_catalog() returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 return jsonb_build_object('isOwner',exists(select 1 from public.hdc_v2_form_owner where owner_id=auth.uid()),'ownerName',(select p.display_name from public.hdc_v2_form_owner o join public.hdc_v2_profiles p on p.id=o.owner_id),'entries',(select coalesce(jsonb_agg(to_jsonb(p) order by updated_at desc),'[]'::jsonb) from public.hdc_v2_preventive_plans p));
end;$fn$;
create function hdc_v2_private.preventive_save(p_id text,p_body jsonb,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
create function hdc_v2_private.preventive_action(p_id text,p_action text,p_note text,p_version integer) returns void language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_existing public.hdc_v2_preventive_plans%rowtype;v_source jsonb;v_state text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then raise exception using errcode='42501',message='지정된 본인 계정만 승인·반려·삭제·복원할 수 있습니다.';end if;
 if p_action is null or p_action not in ('approve','reject','archive','restore') or p_note is null or char_length(btrim(p_note)) not between 1 and 1000 then raise exception using errcode='22023',message='처리 유형과 사유를 입력하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('preventive:'||p_id,0));
 select * into v_existing from public.hdc_v2_preventive_plans where id=p_id for update;
 if p_version is distinct from coalesce(v_existing.version,0) then raise sqlstate 'PT409' using message='계획 상태가 변경되었습니다. 새로고침하세요.';end if;
 if v_existing.id is null then
  select w.value into v_source from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'workorders') w where s.key='factory' and w.value->>'id'=p_id;
  if v_source is null or p_action not in ('archive','approve') then raise exception using errcode='22023',message='등록된 계획의 상태를 확인하세요.';end if;
  insert into public.hdc_v2_preventive_plans(id,body,state,version,created_by,updated_by) values(p_id,v_source,case p_action when 'archive' then 'archived' else 'approved' end,1,v_actor,v_actor) returning * into v_existing;
 else
  if (p_action in ('approve','reject') and v_existing.state<>'pending') or (p_action='restore' and v_existing.state<>'archived') or (p_action='archive' and v_existing.state='archived') then raise exception using errcode='22023',message='현재 상태에서 처리할 수 없습니다.';end if;
  if p_action='approve' and exists(select 1 from public.hdc_v2_equipment_lifecycle where equipment_id=v_existing.body->>'equipment' and status='retired') then raise exception using errcode='22023',message='폐기 설비의 계획은 승인할 수 없습니다.';end if;
  v_state:=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'archive' then 'archived' else 'pending' end;
  update public.hdc_v2_preventive_plans set state=v_state,version=version+1,updated_by=v_actor,updated_at=now(),decision_note=btrim(p_note) where id=p_id returning * into v_existing;
 end if;
 update public.hdc_v2_preventive_plans set decision_note=btrim(p_note) where id=p_id;
 insert into public.hdc_v2_preventive_events(plan_id,action,actor_id,body,state,note) values(p_id,p_action,v_actor,v_existing.body,v_existing.state,btrim(p_note));
end;$fn$;
revoke all on function hdc_v2_private.preventive_catalog(),hdc_v2_private.preventive_save(text,jsonb,integer),hdc_v2_private.preventive_action(text,text,text,integer) from public,anon,authenticated;
grant execute on function hdc_v2_private.preventive_catalog(),hdc_v2_private.preventive_save(text,jsonb,integer),hdc_v2_private.preventive_action(text,text,text,integer) to authenticated;
create function public.hdc_v2_preventive_catalog() returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.preventive_catalog();$fn$;
create function public.hdc_v2_preventive_save(p_id text,p_body jsonb,p_version integer) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.preventive_save(p_id,p_body,p_version);$fn$;
create function public.hdc_v2_preventive_action(p_id text,p_action text,p_note text,p_version integer) returns void language sql security invoker set search_path='' as $fn$select hdc_v2_private.preventive_action(p_id,p_action,p_note,p_version);$fn$;
revoke all on function public.hdc_v2_preventive_catalog(),public.hdc_v2_preventive_save(text,jsonb,integer),public.hdc_v2_preventive_action(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.hdc_v2_preventive_catalog(),public.hdc_v2_preventive_save(text,jsonb,integer),public.hdc_v2_preventive_action(text,text,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;

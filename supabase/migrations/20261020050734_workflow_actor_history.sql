begin;
create table hdc_v2_private.workflow_events(
 id bigint generated always as identity primary key,
 entity_id text not null,stage text not null check(stage in ('request','accept','inspection','plan','approve','start','complete','reopen')),
 actor_id uuid not null,actor_name text not null,occurred_at timestamptz not null default clock_timestamp(),
 evidence text not null default '실제 처리',recovered boolean not null default false
);
create index workflow_events_entity on hdc_v2_private.workflow_events(entity_id,occurred_at);
create index workflow_events_actor_time on hdc_v2_private.workflow_events(actor_id,occurred_at);
alter table hdc_v2_private.workflow_events enable row level security;
revoke all on hdc_v2_private.workflow_events from public,anon,authenticated;

-- Recover only identities supported by authoritative stored columns; do not infer old receivers/completers.
insert into hdc_v2_private.workflow_events(entity_id,stage,actor_id,actor_name,occurred_at,evidence,recovered)
 select r.id,'request',r.reporter_id,coalesce(p.display_name,'이름 미등록'),r.created_at,'기존 요청자 원본',true
 from public.hdc_v2_inspection_requests r left join public.hdc_v2_profiles p on p.id=r.reporter_id;
insert into hdc_v2_private.workflow_events(entity_id,stage,actor_id,actor_name,occurred_at,evidence,recovered)
 select r.id,case when r.body->>'type'='inspection' then 'inspection' else 'plan' end,r.owner_id,coalesce(p.display_name,'이름 미등록'),r.created_at,'기존 기록 최초 등록자',true
 from public.hdc_v2_records r left join public.hdc_v2_profiles p on p.id=r.owner_id
 where not exists(select 1 from public.hdc_v2_inspection_requests q where q.id=r.id);
insert into hdc_v2_private.workflow_events(entity_id,stage,actor_id,actor_name,occurred_at,evidence,recovered)
 select w.record_id,'approve',w.approved_by,coalesce(p.display_name,'이름 미등록'),w.approved_at,'기존 승인 정보 (최종 저장 시각)',true
 from public.hdc_v2_work_plans w left join public.hdc_v2_profiles p on p.id=w.approved_by
 where w.planning->>'approval'='승인' and w.approved_by is not null and w.approved_at is not null;

create function hdc_v2_private.capture_workflow() returns trigger language plpgsql security definer set search_path='' as $fn$
declare j jsonb:=to_jsonb(new);o jsonb;v_stage text;v_id text;v_actor uuid:=auth.uid();v_name text;
begin
 if v_actor is null then return new;end if;
 if tg_op='UPDATE' then o:=to_jsonb(old);end if;
 select coalesce(display_name,'이름 미등록') into v_name from public.hdc_v2_profiles where id=v_actor;
 if tg_table_name='hdc_v2_inspection_requests' then
  v_id:=j->>'id';
  if tg_op='INSERT' then v_stage:='request';
  end if;
 elsif tg_table_name='hdc_v2_work_plans' then
  v_id:=j->>'record_id';
  if j->'planning'->>'approval'='승인' and (tg_op='INSERT' or o->'planning'->>'approval' is distinct from '승인') then v_stage:='approve';end if;
 else
  v_id:=j->>'id';
  if v_id like 'REQ-%' then return new;end if;
  if tg_op='INSERT' then
   v_stage:=case when j->'body'->>'type'='inspection' then 'inspection' else 'plan' end;
  elsif j->'body'->>'type'='workorder' then
   if j->'body'->>'status'='완료' and o->'body'->>'status' is distinct from '완료' then v_stage:='complete';
   elsif j->'body'->>'status'='진행' and o->'body'->>'status' is distinct from '진행' then v_stage:='start';
   elsif o->'body'->>'status'='완료' and j->'body'->>'status' is distinct from '완료' then v_stage:='reopen';end if;
  end if;
 end if;
 if v_stage is not null then
  insert into hdc_v2_private.workflow_events(entity_id,stage,actor_id,actor_name) values(v_id,v_stage,v_actor,coalesce(v_name,'이름 미등록'));
 end if;
 -- A work order can be created directly in a running/completed state.
 if tg_table_name='hdc_v2_records' and tg_op='INSERT' and j->'body'->>'type'='workorder' and j->'body'->>'status' in ('진행','완료') then
  insert into hdc_v2_private.workflow_events(entity_id,stage,actor_id,actor_name) values(v_id,case when j->'body'->>'status'='완료' then 'complete' else 'start' end,v_actor,coalesce(v_name,'이름 미등록'));
 end if;
 return new;
end;$fn$;
revoke all on function hdc_v2_private.capture_workflow() from public,anon,authenticated;
create trigger workflow_requests after insert or update on public.hdc_v2_inspection_requests for each row execute function hdc_v2_private.capture_workflow();
create trigger workflow_records after insert or update on public.hdc_v2_records for each row execute function hdc_v2_private.capture_workflow();
create trigger workflow_approvals after insert or update on public.hdc_v2_work_plans for each row execute function hdc_v2_private.capture_workflow();

create function hdc_v2_private.workflow() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(e) order by occurred_at,id) from hdc_v2_private.workflow_events e),'[]'::jsonb);
end;$fn$;
create function hdc_v2_private.inspection_accept(p_request text) returns void language plpgsql security definer set search_path='' as $fn$
declare r public.hdc_v2_inspection_requests%rowtype;v_actor uuid:=auth.uid();v_name text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inspection-request:'||p_request,0));
 select * into r from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or r.completed_at is not null or exists(select 1 from public.hdc_v2_work_archives where record_id=p_request and archived) then raise exception using errcode='22023',message='이미 처리되었거나 삭제된 점검요청입니다.';end if;
 if r.assignee_id<>v_actor and not hdc_v2_private.is_admin() and not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then raise insufficient_privilege;end if;
 if exists(select 1 from hdc_v2_private.workflow_events where entity_id=p_request and stage='accept') then return;end if;
 select coalesce(display_name,'이름 미등록') into v_name from public.hdc_v2_profiles where id=v_actor;
 insert into hdc_v2_private.workflow_events(entity_id,stage,actor_id,actor_name) values(p_request,'accept',v_actor,coalesce(v_name,'이름 미등록'));
end;$fn$;
create function public.hdc_v2_workflow() returns jsonb language sql stable security invoker set search_path='' as $fn$select hdc_v2_private.workflow();$fn$;
create function public.hdc_v2_inspection_accept(p_request text) returns void language sql security invoker set search_path='' as $fn$select hdc_v2_private.inspection_accept(p_request);$fn$;
revoke all on function hdc_v2_private.workflow(),hdc_v2_private.inspection_accept(text),public.hdc_v2_workflow(),public.hdc_v2_inspection_accept(text) from public,anon,authenticated;
grant execute on function hdc_v2_private.workflow(),hdc_v2_private.inspection_accept(text),public.hdc_v2_workflow(),public.hdc_v2_inspection_accept(text) to authenticated;
commit;

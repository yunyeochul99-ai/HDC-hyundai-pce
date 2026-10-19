-- Only the installation's designated owner may approve template archival.
begin;
create table public.hdc_v2_form_owner(singleton boolean primary key default true check(singleton),owner_id uuid not null references auth.users(id));
do $fn$ begin
 if (select count(*) from public.hdc_v2_profiles where approved and is_admin)<>1 then raise exception 'A single approved administrator must be designated before installing form approval.';end if;
 insert into public.hdc_v2_form_owner(owner_id) select id from public.hdc_v2_profiles where approved and is_admin;
end;$fn$;
create table public.hdc_v2_form_archives(
 template_id text primary key check(char_length(template_id) between 1 and 160),
 state text not null check(state in ('pending','approved','rejected','restored')),
 reason text not null check(char_length(reason) between 1 and 1000),
 requested_by uuid not null references auth.users(id),requested_at timestamptz not null default now(),
 decided_by uuid references auth.users(id),decided_at timestamptz,decision_note text,
 version integer not null default 1 check(version>0)
);
create table public.hdc_v2_form_archive_events(
 id bigint generated always as identity primary key,template_id text not null references public.hdc_v2_form_archives(template_id),
 actor_id uuid not null references auth.users(id),action text not null,reason text not null,created_at timestamptz not null default now()
);
create index on public.hdc_v2_form_archives(requested_by);
create index on public.hdc_v2_form_archives(decided_by);
create index on public.hdc_v2_form_archive_events(actor_id);
create index on public.hdc_v2_form_archive_events(template_id);
create index on public.hdc_v2_form_owner(owner_id);
alter table public.hdc_v2_form_owner enable row level security;
alter table public.hdc_v2_form_archives enable row level security;
alter table public.hdc_v2_form_archive_events enable row level security;
revoke all on public.hdc_v2_form_owner,public.hdc_v2_form_archives,public.hdc_v2_form_archive_events from public,anon,authenticated;
grant select on public.hdc_v2_form_archives,public.hdc_v2_form_archive_events to authenticated;
create policy form_archives_read on public.hdc_v2_form_archives for select to authenticated using((select hdc_v2_private.is_approved()));
create policy form_events_read on public.hdc_v2_form_archive_events for select to authenticated using((select hdc_v2_private.is_approved()));
create function hdc_v2_private.form_approvals() returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 return jsonb_build_object('isOwner',exists(select 1 from public.hdc_v2_form_owner where owner_id=auth.uid()),'ownerName',(select p.display_name from public.hdc_v2_form_owner o join public.hdc_v2_profiles p on p.id=o.owner_id),'forms',(select coalesce(jsonb_agg(to_jsonb(f) order by f.requested_at desc),'[]'::jsonb) from public.hdc_v2_form_archives f));
end;$fn$;
create function hdc_v2_private.form_action(p_template_id text,p_action text,p_reason text,p_version integer) returns void language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_row public.hdc_v2_form_archives%rowtype;v_state text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 or p_action is null or p_action not in ('request','approve','reject','restore') then raise exception using errcode='22023',message='처리 유형과 사유를 확인하세요.';end if;
 if p_template_id is null or not (exists(select 1 from public.hdc_v2_custom_checklists where id=p_template_id) or exists(select 1 from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'checklists') c where s.key='factory' and c.value->>'id'=p_template_id)) then raise exception using errcode='22023',message='등록된 점검 양식이 아닙니다.';end if;
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
revoke all on function hdc_v2_private.form_approvals(),hdc_v2_private.form_action(text,text,text,integer) from public,anon,authenticated;
grant execute on function hdc_v2_private.form_approvals(),hdc_v2_private.form_action(text,text,text,integer) to authenticated;
create function public.hdc_v2_form_approvals() returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.form_approvals();$fn$;
create function public.hdc_v2_form_action(p_template_id text,p_action text,p_reason text,p_version integer) returns void language sql security invoker set search_path='' as $fn$select hdc_v2_private.form_action(p_template_id,p_action,p_reason,p_version);$fn$;
revoke all on function public.hdc_v2_form_approvals(),public.hdc_v2_form_action(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.hdc_v2_form_approvals(),public.hdc_v2_form_action(text,text,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;

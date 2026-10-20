create table public.hdc_v2_assignment_events(
 id bigint generated always as identity primary key,
 request_id text not null references public.hdc_v2_inspection_requests(id),
 previous_assignee uuid not null references auth.users(id),
 next_assignee uuid not null references auth.users(id),
 actor_id uuid not null references auth.users(id),
 reason text not null check(char_length(reason) between 1 and 1000),
 created_at timestamptz not null default now()
);
alter table public.hdc_v2_assignment_events enable row level security;
revoke all on public.hdc_v2_assignment_events from public,anon,authenticated;
grant select on public.hdc_v2_assignment_events to authenticated;
create policy assignment_events_owner on public.hdc_v2_assignment_events for select to authenticated using(
 (select hdc_v2_private.is_approved()) and exists(select 1 from public.hdc_v2_form_owner where owner_id=(select auth.uid()))
);
create function hdc_v2_private.inspection_reassign(p_request text,p_expected uuid,p_assignee uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_name text;v_saved jsonb;v_time text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
 raise exception using errcode='42501',message='담당자 변경은 윤여철 공장장만 가능합니다.';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then raise exception using errcode='22023',message='변경 사유를 입력하세요.';end if;
 select * into v_request from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or v_request.completed_at is not null then raise sqlstate 'PT409' using message='대기 중인 점검요청만 담당자를 변경할 수 있습니다. 새로고침하세요.';end if;
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
end;$fn$;
revoke all on function hdc_v2_private.inspection_reassign(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function hdc_v2_private.inspection_reassign(text,uuid,uuid,text) to authenticated;
create function public.hdc_v2_inspection_reassign(p_request text,p_expected uuid,p_assignee uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $fn$
select hdc_v2_private.inspection_reassign(p_request,p_expected,p_assignee,p_reason);$fn$;
revoke all on function public.hdc_v2_inspection_reassign(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hdc_v2_inspection_reassign(text,uuid,uuid,text) to authenticated;


create table public.hdc_v2_request_edit_events(
 id bigint generated always as identity primary key,
 request_id text not null references public.hdc_v2_inspection_requests(id),
 actor_id uuid not null references auth.users(id),
 before_body jsonb not null,after_body jsonb not null,
 reason text not null check(char_length(reason) between 1 and 1000),
 created_at timestamptz not null default now()
);
alter table public.hdc_v2_request_edit_events enable row level security;
revoke all on public.hdc_v2_request_edit_events from public,anon,authenticated;
grant select on public.hdc_v2_request_edit_events to authenticated;
create policy request_edit_events_owner on public.hdc_v2_request_edit_events for select to authenticated
using ((select hdc_v2_private.is_approved()) and actor_id=(select auth.uid()));
create function hdc_v2_private.inspection_request_edit(p_request text,p_expected jsonb,p_patch jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_request public.hdc_v2_inspection_requests%rowtype;v_before jsonb;v_saved jsonb;v_eq jsonb;v_equipment text;v_assignee uuid;v_name text;v_symptom text;v_time text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor)
 then raise exception using errcode='42501',message='접수 내용 수정은 윤여철 공장장만 가능합니다.';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 or jsonb_typeof(p_patch) is distinct from 'object'
 or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_patch::text)>10000
 then raise exception using errcode='22023',message='수정 항목과 변경 사유를 확인하세요.';end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('equipment_id','assignee_id','symptom')) or p_patch='{}'::jsonb
 then raise exception using errcode='22023',message='설비·담당자·발견한 증상만 수정할 수 있습니다.';end if;
 select * into v_request from public.hdc_v2_inspection_requests where id=p_request for update;
 if not found or v_request.completed_at is not null then raise sqlstate 'PT409' using message='대기 중인 점검요청만 수정할 수 있습니다. 목록을 새로고침하세요.';end if;
 if jsonb_build_object('equipment_id',v_request.equipment_id,'assignee_id',v_request.assignee_id,'symptom',v_request.symptom) is distinct from p_expected
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
 if (v_equipment,v_assignee,v_symptom) is not distinct from (v_request.equipment_id,v_request.assignee_id,v_request.symptom)
 then raise exception using errcode='22023',message='변경한 항목이 없습니다.';end if;
 update public.hdc_v2_inspection_requests set equipment_id=v_equipment,assignee_id=v_assignee,symptom=v_symptom where id=p_request;
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),
 body=body||jsonb_build_object('equipmentId',v_equipment,'equipmentName',v_eq->>'name','assignee',v_name,'note',v_symptom,
 'title',left('[일일점검요청] '||(v_eq->>'name'),200),'version',version+1,'updatedAt',v_time)
 where id=p_request returning body into v_saved;
 insert into public.hdc_v2_request_edit_events(request_id,actor_id,before_body,after_body,reason)
 values(p_request,v_actor,v_before,v_saved,btrim(p_reason));
 return v_saved;
end;$fn$;
revoke all on function hdc_v2_private.inspection_request_edit(text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function hdc_v2_private.inspection_request_edit(text,jsonb,jsonb,text) to authenticated;
create function public.hdc_v2_inspection_request_edit(p_request text,p_expected jsonb,p_patch jsonb,p_reason text)
returns jsonb language sql security invoker set search_path='' as $fn$
 select hdc_v2_private.inspection_request_edit(p_request,p_expected,p_patch,p_reason);$fn$;
revoke all on function public.hdc_v2_inspection_request_edit(text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.hdc_v2_inspection_request_edit(text,jsonb,jsonb,text) to authenticated;


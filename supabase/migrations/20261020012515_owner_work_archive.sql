create table public.hdc_v2_work_archives(
 record_id text primary key references public.hdc_v2_records(id),archived boolean not null default true,
 reason text not null check(char_length(reason) between 1 and 1000),actor_id uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
create table public.hdc_v2_work_archive_events(
 id bigint generated always as identity primary key,record_id text not null references public.hdc_v2_records(id),
 action text not null check(action in ('archive','restore')),reason text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create index on public.hdc_v2_work_archives(actor_id);
create index on public.hdc_v2_work_archive_events(record_id);
create index on public.hdc_v2_work_archive_events(actor_id);
alter table public.hdc_v2_work_archives enable row level security;
alter table public.hdc_v2_work_archive_events enable row level security;
revoke all on public.hdc_v2_work_archives,public.hdc_v2_work_archive_events from public,anon,authenticated;
grant select on public.hdc_v2_work_archives,public.hdc_v2_work_archive_events to authenticated;
create policy work_archive_read on public.hdc_v2_work_archives for select to authenticated using((select hdc_v2_private.is_approved()));
create policy work_archive_events_owner on public.hdc_v2_work_archive_events for select to authenticated using((select hdc_v2_private.is_approved()) and actor_id=(select auth.uid()));
create function hdc_v2_private.work_archive_action(p_record text,p_action text,p_version integer,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_row public.hdc_v2_records%rowtype;v_archived boolean;v_time text;
begin
 if v_actor is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
 raise exception using errcode='42501',message='작업계획 삭제·복원은 윤여철 공장장만 가능합니다.';end if;
 if p_action is null or p_action not in ('archive','restore') or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
 raise exception using errcode='22023',message='처리 유형과 사유를 입력하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_record,0));
 select * into v_row from public.hdc_v2_records where id=p_record for update;
 if not found or v_row.body->>'type'<>'workorder' or exists(select 1 from public.hdc_v2_inspection_requests where id=p_record) then
 raise exception using errcode='22023',message='수리 작업계획만 삭제·복원할 수 있습니다.';end if;
 if v_row.version is distinct from p_version then raise sqlstate 'PT409' using message='작업 내용이 변경되었습니다. 새로고침하고 다시 확인하세요.';end if;
 select archived into v_archived from public.hdc_v2_work_archives where record_id=p_record;
 if coalesce(v_archived,false)=(p_action='archive') then raise sqlstate 'PT409' using message='이미 처리된 작업입니다. 목록을 새로고침하세요.';end if;
 insert into public.hdc_v2_work_archives(record_id,archived,reason,actor_id) values(p_record,p_action='archive',btrim(p_reason),v_actor)
 on conflict(record_id) do update set archived=excluded.archived,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=now();
 insert into public.hdc_v2_work_archive_events(record_id,action,reason,actor_id) values(p_record,p_action,btrim(p_reason),v_actor);
 v_time:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 update public.hdc_v2_records set version=version+1,updated_at=now(),body=body||jsonb_build_object('version',version+1,'updatedAt',v_time) where id=p_record;
end;$fn$;
revoke all on function hdc_v2_private.work_archive_action(text,text,integer,text) from public,anon,authenticated;
grant execute on function hdc_v2_private.work_archive_action(text,text,integer,text) to authenticated;
create function public.hdc_v2_work_archive_action(p_record text,p_action text,p_version integer,p_reason text)
returns void language sql security invoker set search_path='' as $fn$
select hdc_v2_private.work_archive_action(p_record,p_action,p_version,p_reason);$fn$;
revoke all on function public.hdc_v2_work_archive_action(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.hdc_v2_work_archive_action(text,text,integer,text) to authenticated;
CREATE OR REPLACE FUNCTION hdc_v2_private.save_record(p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_record jsonb;
  v_existing public.hdc_v2_records%rowtype;
  v_found boolean;
  v_id text;
  v_owner uuid;
  v_version integer;
  v_now timestamptz := clock_timestamp();
  v_created timestamptz;
  v_now_text text;
  v_saved jsonb;
  v_child jsonb;
  v_child_id text;
  v_defect_note text;
begin
  if v_actor is null or not hdc_v2_private.is_approved() then
    raise exception using errcode='42501',message='승인된 사용자만 기록을 저장할 수 있습니다.';
  end if;
  v_record := hdc_v2_private.validate_record(p_record);
  v_id := v_record->>'id';
  v_version := (v_record->>'version')::integer;
  -- Serialize both first inserts and updates by logical id, then lock the existing row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id,0));
  select * into v_existing from public.hdc_v2_records where id=v_id for update;
  v_found := found;
  if exists(select 1 from public.hdc_v2_work_archives where record_id=v_id and archived) then
    raise exception using errcode='42501',message='삭제 보관된 작업입니다. 공장장이 복원한 뒤 수정하세요.';
  end if;

  -- Only the dedicated owner may choose dates. A linked inspection can retain owner-assigned dates.
  if not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
    if v_found then
      if (v_record->>'date') is distinct from (v_existing.body->>'date')
        or coalesce(v_record->>'dueDate','') is distinct from coalesce(v_existing.body->>'dueDate','') then
        raise exception using errcode='42501',message='기록 일자와 완료 기한은 윤여철 공장장만 변경할 수 있습니다.';
      end if;
    elsif (v_record->>'date') is distinct from to_char(v_now at time zone 'Asia/Seoul','YYYY-MM-DD')
       or coalesce(v_record->>'dueDate','')<>'' then
      if not exists(select 1 from public.hdc_v2_inspection_requests r join public.hdc_v2_records b on b.id=r.id
        where r.result_record_id=v_id and r.dates_managed and r.completed_at is null
        and v_record->>'type'='inspection' and v_record->>'equipmentId'=r.equipment_id
        and (r.assignee_id=v_actor or hdc_v2_private.is_admin())
        and v_record->>'date'=b.body->>'date' and coalesce(v_record->>'dueDate','')=coalesce(b.body->>'dueDate','')) then
        raise exception using errcode='42501',message='공장장이 지정한 날짜만 사용할 수 있습니다. 날짜를 확인하세요.';
      end if;
    end if;
  end if;
  if v_found and v_existing.owner_id <> v_actor and not hdc_v2_private.is_admin() then
    raise exception using errcode='42501',message='작성자 또는 관리자만 기록을 수정할 수 있습니다.';
  end if;
  if (not v_found and v_version<>0) or (v_found and v_version<>v_existing.version) then
    raise sqlstate 'PT409' using message='VERSION_CONFLICT',
      detail=case when v_found then v_existing.body::text else 'null' end,
      hint='최신 기록을 확인하고 변경 내용을 비교한 뒤 다시 저장하세요.';
  end if;
  if v_found and not (p_record ? 'preventivePlanId') and v_existing.body ? 'preventivePlanId' then v_record:=v_record||jsonb_build_object('preventivePlanId',v_existing.body->'preventivePlanId');end if;
  -- Older clients omit classification; retain metadata for photographs still attached.
  if v_found and not (p_record ? 'photoDetails') and v_existing.body ? 'photoDetails' then
    v_record:=v_record||jsonb_build_object('photoDetails',(select coalesce(jsonb_object_agg(d.key,d.value),'{}'::jsonb) from jsonb_each(v_existing.body->'photoDetails') d where (v_record->'photoIds') ? d.key));
  end if;
  if exists(
    select 1 from jsonb_array_elements_text(v_record->'photoIds') p(id)
    where not exists(select 1 from public.hdc_v2_photos f where f.id=p.id::uuid)
  ) then
    raise exception using errcode='22023',message='사진을 먼저 업로드하고 등록하세요.';
  end if;
  v_owner := case when v_found then v_existing.owner_id else v_actor end;
  v_created := case when v_found then v_existing.created_at else v_now end;
  v_now_text := to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_saved := (v_record - 'createdAt' - 'updatedAt') || jsonb_build_object(
    'version',v_version+1,'createdAt',to_char(v_created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',v_now_text
  );
  if v_found then
    update public.hdc_v2_records set body=v_saved,version=v_version+1,updated_at=v_now
    where id=v_id and version=v_version;
    if not found then raise sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  else
    insert into public.hdc_v2_records(id,owner_id,body,version,created_at,updated_at)
    values(v_id,v_owner,v_saved,1,v_created,v_now);
  end if;

  if v_saved->>'type'='inspection' and exists(
    select 1 from jsonb_array_elements(v_saved->'items') i where i->>'result'='불량'
  ) then
    v_child_id := 'defect-' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_id,'UTF8')),'hex');
    select left('점검 기록 ' || v_id || E'의 불량 항목\n' ||
      string_agg(i.item->>'name' || ': ' || coalesce(nullif(i.item->>'note',''),nullif(i.item->>'value',''),'불량 확인'),E'\n' order by i.n),5000)
    into v_defect_note
    from jsonb_array_elements(v_saved->'items') with ordinality i(item,n) where i.item->>'result'='불량';
    v_child := jsonb_build_object(
      'id',v_child_id,'type','workorder','equipmentId',v_saved->>'equipmentId','equipmentName',v_saved->>'equipmentName',
      'title',left('[이상점검] ' || (v_saved->>'title'),200),'status','접수',
      'priority',case when v_saved->>'priority'='긴급' then '긴급' else '높음' end,
      'assignee',v_saved->>'assignee','date',v_saved->>'date','dueDate',v_saved->>'dueDate',
      'note',v_defect_note,'items','[]'::jsonb,'photoIds',v_saved->'photoIds','photoDetails',coalesce(v_saved->'photoDetails','{}'::jsonb),'version',1,
      'createdAt',v_now_text,'updatedAt',v_now_text
    );
    -- Same transaction as the inspection; an existing follow-up, including a completed one, is never overwritten.
    insert into public.hdc_v2_records(id,owner_id,body,version,created_at,updated_at)
    values(v_child_id,v_owner,v_child,1,v_now,v_now) on conflict(id) do nothing;
  end if;
  return v_saved;
end;
$function$;


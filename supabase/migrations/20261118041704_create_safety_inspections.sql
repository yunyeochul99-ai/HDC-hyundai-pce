-- Safety inspection records: approved-account read, author/owner writes, optimistic locking.
create table public.hdc_v2_safety_inspections(
 id uuid primary key,cadence text not null check(cadence in ('일별','주별','월별')),inspection_date date not null,
 area text not null default '',inspector text not null default '',shift text not null default '',
 status text not null check(status in ('작성중','완료')),follow_up text not null default '',
 items jsonb not null check(jsonb_typeof(items)='array'),version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index hdc_v2_safety_inspections_date_idx on public.hdc_v2_safety_inspections(inspection_date desc,updated_at desc);
alter table public.hdc_v2_safety_inspections enable row level security;
revoke all on public.hdc_v2_safety_inspections from public,anon,authenticated;
grant select on public.hdc_v2_safety_inspections to authenticated;
create policy safety_inspections_approved_read on public.hdc_v2_safety_inspections for select to authenticated using((select hdc_v2_private.is_approved()));
create or replace function hdc_v2_private.safety_inspection_save(p_record jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;v_old public.hdc_v2_safety_inspections%rowtype;v_item jsonb;v_count integer;v_is_owner boolean;v_now timestamptz:=now();v_status text;v_cadence text;v_date date;v_area text;v_inspector text;v_shift text;v_follow text;v_items jsonb;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 if p_record is null or pg_column_size(p_record)>131072 then raise exception using errcode='22023',message='점검표가 비어 있거나 허용 크기를 초과했습니다.';end if;
 begin v_id:=(p_record->>'id')::uuid;v_date:=(p_record->>'inspection_date')::date;exception when others then raise exception using errcode='22023',message='점검표 식별자 또는 점검일 형식이 올바르지 않습니다.';end;
 v_cadence:=p_record->>'cadence';v_status:=p_record->>'status';v_area:=coalesce(p_record->>'area','');v_inspector:=coalesce(p_record->>'inspector','');v_shift:=coalesce(p_record->>'shift','');v_follow:=coalesce(p_record->>'follow_up','');v_items:=p_record->'items';
 if v_cadence not in ('일별','주별','월별') or v_status not in ('작성중','완료') then raise exception using errcode='22023',message='점검 주기 또는 기록 상태가 올바르지 않습니다.';end if;
 if length(v_area)>120 or length(v_inspector)>100 or length(v_shift)>80 or length(v_follow)>2000 or jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)>80 then raise exception using errcode='22023',message='점검표 입력 길이 또는 항목 수가 허용 범위를 넘었습니다.';end if;
 v_count:=jsonb_array_length(v_items);if v_count=0 then raise exception using errcode='22023',message='점검 항목을 한 개 이상 등록하세요.';end if;
 for v_item in select value from jsonb_array_elements(v_items) loop
  if jsonb_typeof(v_item)<>'object' or not(v_item ?& array['id','name','standard','result','note']) or length(coalesce(v_item->>'id',''))>80 or length(coalesce(v_item->>'name','')) not between 1 and 160 or length(coalesce(v_item->>'standard',''))>300 or length(coalesce(v_item->>'note',''))>500 or coalesce(v_item->>'result','') not in ('미점검','양호','불량','해당없음') then raise exception using errcode='22023',message='점검 항목의 이름·기준·결과를 확인하세요.';end if;
 end loop;
 if v_status='완료' then
  if btrim(v_area)='' or btrim(v_inspector)='' or exists(select 1 from jsonb_array_elements(v_items) x where x->>'result'='미점검') then raise exception using errcode='22023',message='완료 저장 전에 점검 구역·점검자와 각 항목 결과를 입력하세요.';end if;
  if exists(select 1 from jsonb_array_elements(v_items) x where x->>'result'='불량' and btrim(coalesce(x->>'note',''))='') or (exists(select 1 from jsonb_array_elements(v_items) x where x->>'result'='불량') and btrim(v_follow)='') then raise exception using errcode='22023',message='불량 내용·임시조치와 후속 조치를 입력하세요.';end if;
 end if;
 select exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) into v_is_owner;select * into v_old from public.hdc_v2_safety_inspections where id=v_id for update;
 if not found then
  if coalesce(p_expected_version,0)<>0 then raise exception using errcode='40001',message='기록 버전이 변경되었습니다. 새로고침 후 다시 시도하세요.';end if;
  insert into public.hdc_v2_safety_inspections(id,cadence,inspection_date,area,inspector,shift,status,follow_up,items,version,created_by,updated_by,created_at,updated_at) values(v_id,v_cadence,v_date,v_area,v_inspector,v_shift,v_status,v_follow,v_items,1,v_actor,v_actor,v_now,v_now) returning * into v_old;
 else
  if v_old.created_by<>v_actor and not v_is_owner then raise insufficient_privilege;end if;
  if p_expected_version is distinct from v_old.version then raise exception using errcode='40001',message='다른 사용자가 기록을 수정했습니다. 새로고침 후 내용을 확인하세요.';end if;
  update public.hdc_v2_safety_inspections set cadence=v_cadence,inspection_date=v_date,area=v_area,inspector=v_inspector,shift=v_shift,status=v_status,follow_up=v_follow,items=v_items,version=v_old.version+1,updated_by=v_actor,updated_at=v_now where id=v_id returning * into v_old;
 end if;return to_jsonb(v_old);
end $$;
revoke all on function hdc_v2_private.safety_inspection_save(jsonb,integer) from public,anon,authenticated;grant execute on function hdc_v2_private.safety_inspection_save(jsonb,integer) to authenticated;
create or replace function public.hdc_v2_safety_inspection_save(p_record jsonb,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select hdc_v2_private.safety_inspection_save(p_record,p_expected_version) $$;
revoke all on function public.hdc_v2_safety_inspection_save(jsonb,integer) from public,anon,authenticated;grant execute on function public.hdc_v2_safety_inspection_save(jsonb,integer) to authenticated;

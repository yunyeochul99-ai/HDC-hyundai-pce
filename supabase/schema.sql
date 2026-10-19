-- HDC PCE V2: non-destructive application schema, approval and atomic record RPC.
-- Run as the Supabase SQL Editor postgres role. Run storage.sql next.
-- Existing public.profiles/check_records/maintenance_work_orders and old buckets are untouched.
-- The project is one factory: approved members read shared records; creator/admin can edit.
-- Browser clients use only a publishable key + the signed-in user's JWT. No service_role key.
begin;

create schema if not exists hdc_v2_private;
revoke all on schema hdc_v2_private from public, anon;
grant usage on schema hdc_v2_private to authenticated;

create table if not exists public.hdc_v2_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.hdc_v2_records (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  owner_id uuid not null references auth.users(id),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hdc_v2_record_id_matches check (body->>'id' = id),
  constraint hdc_v2_record_version_matches check ((body->>'version')::integer = version)
);
create index if not exists hdc_v2_records_owner_updated on public.hdc_v2_records(owner_id, updated_at desc);
create index if not exists hdc_v2_records_updated on public.hdc_v2_records(updated_at desc, id);

create table if not exists public.hdc_v2_photos (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size integer not null check (size > 0 and size <= 5242880),
  created_at timestamptz not null default now(),
  constraint hdc_v2_photo_owner_path check (object_path = owner_id::text || '/' || id::text)
);
create index if not exists hdc_v2_photos_owner on public.hdc_v2_photos(owner_id);

create table if not exists public.hdc_v2_seed (
  key text primary key default 'factory' check (key = 'factory'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Copy legacy approval flags once, without granting a new user the first-admin role.
-- to_jsonb permits compatible old profiles tables with name or display_name columns.
do $migration$
begin
  if to_regclass('public.profiles') is not null then
    execute $copy$
      insert into public.hdc_v2_profiles(id, display_name, approved, is_admin)
      select u.id,
        left(coalesce(to_jsonb(p)->>'name',to_jsonb(p)->>'display_name',''),100),
        coalesce(to_jsonb(p)->>'approved','false') = 'true',
        coalesce(to_jsonb(p)->>'is_admin','false') = 'true'
      from public.profiles p
      join auth.users u on u.id::text = to_jsonb(p)->>'id'
      on conflict (id) do nothing
    $copy$;
  end if;
end;
$migration$;

insert into public.hdc_v2_profiles(id,display_name)
select u.id, left(coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name',''),100)
from auth.users u on conflict (id) do nothing;

create or replace function hdc_v2_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  insert into public.hdc_v2_profiles(id,display_name)
  values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'full_name',''),100))
  on conflict(id) do nothing;
  return new;
end;
$fn$;
revoke all on function hdc_v2_private.handle_new_user() from public,anon,authenticated;
drop trigger if exists hdc_v2_on_auth_user_created on auth.users;
create trigger hdc_v2_on_auth_user_created after insert on auth.users
for each row execute function hdc_v2_private.handle_new_user();

create or replace function hdc_v2_private.is_approved()
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select coalesce((select p.approved from public.hdc_v2_profiles p where p.id = auth.uid()),false);
$fn$;
create or replace function hdc_v2_private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select coalesce((select p.approved and p.is_admin from public.hdc_v2_profiles p where p.id = auth.uid()),false);
$fn$;
revoke all on function hdc_v2_private.is_approved() from public,anon,authenticated;
revoke all on function hdc_v2_private.is_admin() from public,anon,authenticated;
grant execute on function hdc_v2_private.is_approved(),hdc_v2_private.is_admin() to authenticated;

create or replace function public.hdc_v2_is_approved()
returns boolean language sql stable security invoker set search_path = ''
as $fn$ select hdc_v2_private.is_approved(); $fn$;
create or replace function public.hdc_v2_is_admin()
returns boolean language sql stable security invoker set search_path = ''
as $fn$ select hdc_v2_private.is_admin(); $fn$;
revoke all on function public.hdc_v2_is_approved(),public.hdc_v2_is_admin() from public,anon,authenticated;
grant execute on function public.hdc_v2_is_approved(),public.hdc_v2_is_admin() to authenticated;

alter table public.hdc_v2_profiles enable row level security;
alter table public.hdc_v2_records enable row level security;
alter table public.hdc_v2_photos enable row level security;
alter table public.hdc_v2_seed enable row level security;
revoke all on public.hdc_v2_profiles,public.hdc_v2_records,public.hdc_v2_photos,public.hdc_v2_seed from anon,authenticated;
grant select on public.hdc_v2_profiles,public.hdc_v2_records,public.hdc_v2_photos,public.hdc_v2_seed to authenticated;
-- Deliberately no direct INSERT/UPDATE/DELETE grants: RPCs enforce validation and CAS.
drop policy if exists hdc_v2_profile_read on public.hdc_v2_profiles;
create policy hdc_v2_profile_read on public.hdc_v2_profiles for select to authenticated
using(id = (select auth.uid()) or (select hdc_v2_private.is_admin()));
drop policy if exists hdc_v2_record_read on public.hdc_v2_records;
create policy hdc_v2_record_read on public.hdc_v2_records for select to authenticated
using((select hdc_v2_private.is_approved()));
drop policy if exists hdc_v2_photo_read on public.hdc_v2_photos;
create policy hdc_v2_photo_read on public.hdc_v2_photos for select to authenticated
using((select hdc_v2_private.is_approved()));
drop policy if exists hdc_v2_seed_read on public.hdc_v2_seed;
create policy hdc_v2_seed_read on public.hdc_v2_seed for select to authenticated
using((select hdc_v2_private.is_approved()));

create or replace function hdc_v2_private.validate_record(p_record jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $fn$
declare
  v_record jsonb := p_record;
  v_key text;
  v_value text;
  v_max integer;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_photos jsonb;
  v_detail record;
  v_details jsonb := '{}'::jsonb;
  v_checked_date date;
  v_defect boolean := false;
begin
  if jsonb_typeof(v_record) is distinct from 'object' or octet_length(v_record::text) > 262144 then
    raise exception using errcode='22023',message='기록은 256KB 이하 JSON 객체여야 합니다.';
  end if;
  if exists(select 1 from jsonb_object_keys(v_record) k where k not in
    ('id','type','equipmentId','equipmentName','title','status','priority','assignee','date','dueDate','note','items','photoIds','photoDetails','version','createdAt','updatedAt')) then
    raise exception using errcode='22023',message='허용되지 않은 기록 필드가 있습니다.';
  end if;
  foreach v_key in array array['id','type','equipmentId','equipmentName','title','status','priority','assignee','date']
  loop
    if jsonb_typeof(v_record->v_key) is distinct from 'string' then
      raise exception using errcode='22023',message='필수 문자열을 확인하세요: ' || v_key;
    end if;
    v_value := v_record->>v_key;
    v_max := case v_key when 'equipmentName' then 200 when 'title' then 200 when 'id' then 100
      when 'equipmentId' then 100 when 'assignee' then 100 else 30 end;
    if char_length(btrim(v_value)) = 0 or char_length(v_value) > v_max then
      raise exception using errcode='22023',message='필수 입력값과 길이를 확인하세요: ' || v_key;
    end if;
    if v_key in ('equipmentId','equipmentName','title','assignee') then
      v_record := jsonb_set(v_record,array[v_key],to_jsonb(btrim(v_value)));
    end if;
  end loop;
  if v_record->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
     or v_record->>'type' not in ('inspection','workorder')
     or v_record->>'status' not in ('접수','배정','진행','보류','완료')
     or v_record->>'priority' not in ('긴급','높음','보통') then
    raise exception using errcode='22023',message='기록 종류, 상태, 우선순위 또는 식별자가 올바르지 않습니다.';
  end if;
  foreach v_key in array array['dueDate','note']
  loop
    if not v_record ? v_key then v_record := v_record || jsonb_build_object(v_key,''); end if;
    if jsonb_typeof(v_record->v_key) is distinct from 'string' then
      raise exception using errcode='22023',message='문자열 형식이 아닙니다: ' || v_key;
    end if;
  end loop;
  if char_length(v_record->>'note') > 5000 then
    raise exception using errcode='22023',message='메모는 5,000자 이하여야 합니다.';
  end if;
  foreach v_key in array array['date','dueDate']
  loop
    v_value := v_record->>v_key;
    if v_key='dueDate' and v_value='' then continue; end if;
    if v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023',message='날짜 형식을 확인하세요: ' || v_key;
    end if;
    begin v_checked_date := v_value::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='22023',message='실제 달력 날짜를 입력하세요: ' || v_key;
    end;
    if to_char(v_checked_date,'YYYY-MM-DD') <> v_value then
      raise exception using errcode='22023',message='실제 달력 날짜를 입력하세요: ' || v_key;
    end if;
  end loop;
  if jsonb_typeof(v_record->'version') is distinct from 'number'
    or v_record->>'version' !~ '^(0|[1-9][0-9]*)$'
    or (v_record->>'version')::numeric > 2147483646 then
    raise exception using errcode='22023',message='수정 버전이 올바르지 않습니다.';
  end if;
  foreach v_key in array array['createdAt','updatedAt']
  loop
    if v_record ? v_key and (jsonb_typeof(v_record->v_key) is distinct from 'string' or char_length(v_record->>v_key)>64) then
      raise exception using errcode='22023',message='시각 형식을 확인하세요.';
    end if;
  end loop;
  if not v_record ? 'items' then v_record := v_record || '{"items":[]}'::jsonb; end if;
  if jsonb_typeof(v_record->'items') is distinct from 'array' then
    raise exception using errcode='22023',message='점검 항목은 배열이어야 합니다.';
  end if;
  if jsonb_array_length(v_record->'items') > 100 then
    raise exception using errcode='22023',message='점검 항목은 최대 100개입니다.';
  end if;
  for v_item in select value from jsonb_array_elements(v_record->'items')
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode='22023',message='점검 항목 형식이 올바르지 않습니다.';
    end if;
    if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('name','standard','result','value','note')) then
      raise exception using errcode='22023',message='허용되지 않은 점검 필드가 있습니다.';
    end if;
    if jsonb_typeof(v_item->'name') is distinct from 'string' or char_length(btrim(v_item->>'name'))=0 or char_length(v_item->>'name')>200
      or jsonb_typeof(v_item->'result') is distinct from 'string' or v_item->>'result' not in ('양호','불량','해당없음','미점검') then
      raise exception using errcode='22023',message='점검 항목명과 결과를 확인하세요.';
    end if;
    if not v_item ? 'standard' then v_item := v_item || '{"standard":""}'::jsonb; end if;
    foreach v_key in array array['standard','value','note']
    loop
      if v_item ? v_key then
        v_max := case v_key when 'value' then 100 else 1000 end;
        if jsonb_typeof(v_item->v_key) is distinct from 'string' or char_length(v_item->>v_key)>v_max then
          raise exception using errcode='22023',message='점검 기준, 실측값 또는 메모의 길이를 확인하세요.';
        end if;
      end if;
    end loop;
    if v_record->>'type'='inspection' and v_item->>'result'='미점검' then
      raise exception using errcode='22023',message='모든 점검 항목의 결과를 입력하세요.';
    end if;
    if v_item->>'result'='불량' then v_defect := true; end if;
    v_item := jsonb_set(v_item,'{name}',to_jsonb(btrim(v_item->>'name')));
    v_items := v_items || jsonb_build_array(v_item);
  end loop;
  if v_record->>'type'='inspection' and jsonb_array_length(v_items)=0 then
    raise exception using errcode='22023',message='점검 양식을 선택하고 점검 항목을 입력하세요.';
  end if;
  v_record := jsonb_set(v_record,'{items}',v_items);
  if v_record->>'type'='inspection' then
    v_record := jsonb_set(v_record,'{status}',to_jsonb(case when v_defect then '접수'::text else '완료'::text end));
  end if;
  v_photos := coalesce(v_record->'photoIds','[]'::jsonb);
  if jsonb_typeof(v_photos) is distinct from 'array' then
    raise exception using errcode='22023',message='사진 식별자는 배열이어야 합니다.';
  end if;
  if jsonb_array_length(v_photos)>5
    or exists(select 1 from jsonb_array_elements(v_photos) p where jsonb_typeof(p) is distinct from 'string'
      or (p#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (select count(*) from jsonb_array_elements_text(v_photos)) <> (select count(distinct value) from jsonb_array_elements_text(v_photos)) then
    raise exception using errcode='22023',message='사진은 중복 없이 올바른 식별자 최대 5개여야 합니다.';
  end if;
  if v_record ? 'photoDetails' then
    if jsonb_typeof(v_record->'photoDetails') is distinct from 'object' then raise exception using errcode='22023',message='사진 분류는 객체여야 합니다.';end if;
    for v_detail in select key,value from jsonb_each(v_record->'photoDetails') loop
      if not (v_photos ? v_detail.key) or jsonb_typeof(v_detail.value) is distinct from 'object' then raise exception using errcode='22023',message='첨부된 사진의 분류만 저장할 수 있습니다.';end if;
      if exists(select 1 from jsonb_object_keys(v_detail.value) k where k not in ('stage','part','caption')) or jsonb_typeof(v_detail.value->'stage') is distinct from 'string' or v_detail.value->>'stage' not in ('before','after','unclassified') or jsonb_typeof(v_detail.value->'part') is distinct from 'string' or char_length(v_detail.value->>'part')>100 or jsonb_typeof(v_detail.value->'caption') is distinct from 'string' or char_length(v_detail.value->>'caption')>500 then raise exception using errcode='22023',message='사진 구분·부위(100자)·설명(500자)을 확인하세요.';end if;
      v_details:=v_details||jsonb_build_object(v_detail.key,jsonb_build_object('stage',v_detail.value->>'stage','part',btrim(v_detail.value->>'part'),'caption',btrim(v_detail.value->>'caption')));
    end loop;
    v_record:=v_record||jsonb_build_object('photoDetails',v_details);
  end if;
  return jsonb_set(v_record,'{photoIds}',v_photos);
end;
$fn$;
revoke all on function hdc_v2_private.validate_record(jsonb) from public,anon,authenticated;

create or replace function hdc_v2_private.save_record(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
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
  if v_found and v_existing.owner_id <> v_actor and not hdc_v2_private.is_admin() then
    raise exception using errcode='42501',message='작성자 또는 관리자만 기록을 수정할 수 있습니다.';
  end if;
  if (not v_found and v_version<>0) or (v_found and v_version<>v_existing.version) then
    raise sqlstate 'PT409' using message='VERSION_CONFLICT',
      detail=case when v_found then v_existing.body::text else 'null' end,
      hint='최신 기록을 확인하고 변경 내용을 비교한 뒤 다시 저장하세요.';
  end if;
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
$fn$;
revoke all on function hdc_v2_private.save_record(jsonb) from public,anon,authenticated;
grant execute on function hdc_v2_private.save_record(jsonb) to authenticated;
create or replace function public.hdc_v2_save_record(p_record jsonb)
returns jsonb language sql security invoker set search_path = ''
as $fn$ select hdc_v2_private.save_record(p_record); $fn$;
revoke all on function public.hdc_v2_save_record(jsonb) from public,anon,authenticated;
grant execute on function public.hdc_v2_save_record(jsonb) to authenticated;

create or replace function hdc_v2_private.import_seed(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not hdc_v2_private.is_admin() then
    raise exception using errcode='42501',message='승인된 관리자만 기준자료를 가져올 수 있습니다.';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>10485760
    or jsonb_typeof(p_payload->'equipment') is distinct from 'array'
    or jsonb_typeof(p_payload->'ledger') is distinct from 'array'
    or jsonb_typeof(p_payload->'workorders') is distinct from 'array'
    or jsonb_typeof(p_payload->'checklists') is distinct from 'array'
    or jsonb_typeof(p_payload->'costSummary') is distinct from 'object' then
    raise exception using errcode='22023',message='기준자료 JSON 형식 또는 10MB 크기 제한을 확인하세요.';
  end if;
  if jsonb_array_length(p_payload->'equipment')=0 or jsonb_array_length(p_payload->'workorders')=0 then
    raise exception using errcode='22023',message='설비와 예방정비 계획이 포함된 기준자료를 선택하세요.';
  end if;
  insert into public.hdc_v2_seed(key,payload,updated_by,updated_at)
  values('factory',p_payload,auth.uid(),v_now)
  on conflict(key) do update set payload=excluded.payload,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return jsonb_build_object('key','factory','updatedAt',v_now);
end;
$fn$;
revoke all on function hdc_v2_private.import_seed(jsonb) from public,anon,authenticated;
grant execute on function hdc_v2_private.import_seed(jsonb) to authenticated;
create or replace function public.hdc_v2_import_seed(p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $fn$ select hdc_v2_private.import_seed(p_payload); $fn$;
revoke all on function public.hdc_v2_import_seed(jsonb) from public,anon,authenticated;
grant execute on function public.hdc_v2_import_seed(jsonb) to authenticated;

create or replace function hdc_v2_private.list_profiles()
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not hdc_v2_private.is_admin() then raise exception using errcode='42501',message='관리자만 가입 승인 목록을 조회할 수 있습니다.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.hdc_v2_profiles p),'[]'::jsonb);
end;
$fn$;
create or replace function hdc_v2_private.set_approval(p_user_id uuid,p_approved boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_profile public.hdc_v2_profiles%rowtype;
begin
  if not hdc_v2_private.is_admin() then raise exception using errcode='42501',message='관리자만 가입을 승인할 수 있습니다.'; end if;
  if p_approved is null then raise exception using errcode='22023',message='승인 상태를 지정하세요.'; end if;
  update public.hdc_v2_profiles set approved=p_approved where id=p_user_id and not is_admin returning * into v_profile;
  if not found then raise exception using errcode='22023',message='일반 사용자만 앱에서 승인할 수 있습니다. 관리자 계정은 SQL Editor에서 관리하세요.'; end if;
  return to_jsonb(v_profile);
end;
$fn$;
revoke all on function hdc_v2_private.list_profiles(),hdc_v2_private.set_approval(uuid,boolean) from public,anon,authenticated;
grant execute on function hdc_v2_private.list_profiles(),hdc_v2_private.set_approval(uuid,boolean) to authenticated;
create or replace function public.hdc_v2_list_profiles()
returns jsonb language sql stable security invoker set search_path = ''
as $fn$ select hdc_v2_private.list_profiles(); $fn$;
create or replace function public.hdc_v2_set_approval(p_user_id uuid,p_approved boolean)
returns jsonb language sql security invoker set search_path = ''
as $fn$ select hdc_v2_private.set_approval(p_user_id,p_approved); $fn$;
revoke all on function public.hdc_v2_list_profiles(),public.hdc_v2_set_approval(uuid,boolean) from public,anon,authenticated;
grant execute on function public.hdc_v2_list_profiles(),public.hdc_v2_set_approval(uuid,boolean) to authenticated;


create or replace function hdc_v2_private.set_display_name(p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(p_display_name);
  v_profile public.hdc_v2_profiles%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
  if v_name is null or char_length(v_name)<1 or char_length(v_name)>60 then
    raise exception using errcode='22023',message='표시 이름을 공백 제외 1~60자로 입력하세요.';
  end if;
  -- Only the caller's display label changes. Role and approval flags are never assigned here.
  insert into public.hdc_v2_profiles(id,display_name) values(v_actor,v_name)
  on conflict(id) do update set display_name=excluded.display_name
  returning * into v_profile;
  return to_jsonb(v_profile);
end;
$fn$;
revoke all on function hdc_v2_private.set_display_name(text) from public,anon,authenticated;
grant execute on function hdc_v2_private.set_display_name(text) to authenticated;
create or replace function public.hdc_v2_set_display_name(p_display_name text)
returns jsonb language sql security invoker set search_path = ''
as $fn$ select hdc_v2_private.set_display_name(p_display_name); $fn$;
revoke all on function public.hdc_v2_set_display_name(text) from public,anon,authenticated;
grant execute on function public.hdc_v2_set_display_name(text) to authenticated;

create or replace function hdc_v2_private.legacy_records()
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
declare v_records jsonb;
begin
  if auth.uid() is null or not hdc_v2_private.is_approved() then
    raise exception using errcode='42501',message='승인된 사용자만 기존 점검 기록을 조회할 수 있습니다.';
  end if;
  if to_regclass('public.check_records') is null then return '[]'::jsonb; end if;
  -- Read the original table without rewriting, importing, reassigning or deleting its rows.
  -- JSON projection tolerates compatible legacy tables with optional columns missing.
  execute $legacy$
    select coalesce(jsonb_agg(jsonb_build_object(
      'k',j.data->'k','rec_date',j.data->'rec_date','order_id',j.data->'order_id',
      'equip',j.data->'equip','who',j.data->'who','result',j.data->'result',
      'items',j.data->'items','note',j.data->'note','act',j.data->'act','created_at',j.data->'created_at'
    ) order by j.data->>'rec_date' desc nulls last,j.data->>'created_at' desc nulls last),'[]'::jsonb)
    from (select to_jsonb(r) as data from public.check_records r) j
  $legacy$ into v_records;
  return v_records;
end;
$fn$;
revoke all on function hdc_v2_private.legacy_records() from public,anon,authenticated;
grant execute on function hdc_v2_private.legacy_records() to authenticated;
create or replace function public.hdc_v2_legacy_records()
returns jsonb language sql stable security invoker set search_path = ''
as $fn$ select hdc_v2_private.legacy_records(); $fn$;
revoke all on function public.hdc_v2_legacy_records() from public,anon,authenticated;
grant execute on function public.hdc_v2_legacy_records() to authenticated;


comment on table public.hdc_v2_records is 'Factory shared read for approved members; validated creator/admin edits via hdc_v2_save_record only.';
comment on table public.hdc_v2_seed is 'Private company reference JSON. Approved factory read; administrator import RPC only.';
notify pgrst,'reload schema';
commit;

-- If there was no existing approved legacy administrator, an authorized project operator must
-- explicitly choose the first admin in SQL Editor after that account signs up. Do not run unchanged:
-- update public.hdc_v2_profiles set approved=true,is_admin=true
-- where id=(select id from auth.users where email='REPLACE_WITH_APPROVED_ADMIN_EMAIL');
--
-- Public API contract:
-- SELECT hdc_v2_profiles by id: current user can see own pending/approved state; admin can see all.
-- SELECT hdc_v2_records(body,owner_id,version,updated_at): approved members see all factory records.
-- RPC hdc_v2_save_record({p_record: record}): JSON body; PT409 VERSION_CONFLICT detail is latest body.
-- RPC hdc_v2_import_seed({p_payload: sourceJson}): administrator only.
-- RPC hdc_v2_list_profiles(): administrator only; JSON array.
-- RPC hdc_v2_set_approval({p_user_id: uuid,p_approved: bool}): administrator only; no role escalation.

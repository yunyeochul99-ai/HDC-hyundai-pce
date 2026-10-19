-- Record-scoped photo classification; existing records/photos are preserved.
begin;
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
notify pgrst,'reload schema';
commit;

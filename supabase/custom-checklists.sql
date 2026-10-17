-- Run after schema.sql, storage.sql and maintenance.sql.
-- App-added equipment and reusable inspection forms; original seed remains unchanged.
begin;
create table if not exists public.hdc_v2_custom_equipment(
 id text primary key check(id=upper(btrim(id)) and char_length(id) between 1 and 100),
 body jsonb not null check(jsonb_typeof(body)='object' and body->>'id'=id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table if not exists public.hdc_v2_custom_checklists(
 id text primary key,equipment_id text not null,
 body jsonb not null check(jsonb_typeof(body)='object' and body->>'id'=id and body->>'equipment'=equipment_id),
 request_hash text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create index if not exists hdc_custom_checklists_equipment on public.hdc_v2_custom_checklists(equipment_id);
create index if not exists hdc_custom_equipment_creator on public.hdc_v2_custom_equipment(created_by);
create index if not exists hdc_custom_checklists_creator on public.hdc_v2_custom_checklists(created_by);
alter table public.hdc_v2_custom_equipment enable row level security;
alter table public.hdc_v2_custom_checklists enable row level security;
revoke all on public.hdc_v2_custom_equipment,public.hdc_v2_custom_checklists from public,anon,authenticated;
grant select on public.hdc_v2_custom_equipment,public.hdc_v2_custom_checklists to authenticated;
drop policy if exists custom_equipment_read on public.hdc_v2_custom_equipment;
create policy custom_equipment_read on public.hdc_v2_custom_equipment for select to authenticated using((select hdc_v2_private.is_approved()));
drop policy if exists custom_checklists_read on public.hdc_v2_custom_checklists;
create policy custom_checklists_read on public.hdc_v2_custom_checklists for select to authenticated using((select hdc_v2_private.is_approved()));

create or replace function hdc_v2_private.create_checklist(p_equipment jsonb,p_template jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid();v_id text;v_hash text;v_equipment_id text;v_equipment jsonb;
 v_existing public.hdc_v2_custom_checklists%rowtype;v_body jsonb;v_items jsonb:='[]'::jsonb;
 v_item jsonb;v_name text;v_title text;v_cycle text;v_model text;v_category text;v_n integer:=0;
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise exception using errcode='42501',message='승인된 구성원만 장비와 점검 양식을 등록할 수 있습니다.';end if;
 if jsonb_typeof(p_template) is distinct from 'object' or octet_length(p_template::text)>131072 then raise exception using errcode='22023',message='점검 양식은 128KB 이하의 객체여야 합니다.';end if;
 if exists(select 1 from jsonb_object_keys(p_template) k where k not in ('id','equipmentId','title','cycle','items')) then raise exception using errcode='22023',message='허용되지 않은 양식 필드입니다.';end if;
 v_id:=p_template->>'id';
 if jsonb_typeof(p_template->'id') is distinct from 'string' or v_id !~* '^USR-CK-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='22023',message='올바른 양식 식별자가 필요합니다.';end if;
 if p_equipment is not null and (jsonb_typeof(p_equipment) is distinct from 'object' or octet_length(p_equipment::text)>4096) then raise exception using errcode='22023',message='장비 정보를 확인하세요.';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('equipment',p_equipment,'template',p_template)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_id,0));
 select * into v_existing from public.hdc_v2_custom_checklists where id=v_id;
 if found then
  if v_existing.created_by<>v_actor or v_existing.request_hash<>v_hash then raise sqlstate 'PT409' using message='이미 저장된 등록 요청입니다. 장비·양식 목록을 확인하고 다시 등록하세요.';end if;
  select body into v_equipment from public.hdc_v2_custom_equipment where id=v_existing.equipment_id;
  if v_equipment is null then select e.value into v_equipment from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'equipment') e where s.key='factory' and e.value->>'id'=v_existing.equipment_id;end if;
  return jsonb_build_object('equipment',v_equipment,'checklist',v_existing.body);
 end if;
 if jsonb_typeof(p_template->'title') is distinct from 'string' or jsonb_typeof(p_template->'cycle') is distinct from 'string' or jsonb_typeof(p_template->'items') is distinct from 'array' then raise exception using errcode='22023',message='양식 이름·점검 주기·점검 항목을 확인하세요.';end if;
 v_title:=btrim(p_template->>'title');v_cycle:=btrim(p_template->>'cycle');
 if char_length(v_title) not between 1 and 200 or char_length(v_cycle)>100 then raise exception using errcode='22023',message='양식 이름은 1~200자, 점검 주기는 100자 이내로 입력하세요.';end if;
 if v_cycle='' then v_cycle:='현장 지정';end if;
 if jsonb_array_length(p_template->'items') not between 1 and 100 then raise exception using errcode='22023',message='점검 항목은 1~100개로 작성하세요.';end if;
 for v_item in select value from jsonb_array_elements(p_template->'items') loop
  if jsonb_typeof(v_item) is distinct from 'object' then raise exception using errcode='22023',message='점검 항목의 형식을 확인하세요.';end if;
  if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('name','criteria')) or jsonb_typeof(v_item->'name') is distinct from 'string' or jsonb_typeof(v_item->'criteria') is distinct from 'string' then raise exception using errcode='22023',message='각 항목에 점검명과 판정 기준을 입력하세요.';end if;
  if char_length(btrim(v_item->>'name')) not between 1 and 200 or char_length(btrim(v_item->>'criteria')) not between 1 and 1000 then raise exception using errcode='22023',message='점검명은 1~200자, 판정 기준은 1~1,000자로 입력하세요.';end if;
  v_n:=v_n+1;v_items:=v_items||jsonb_build_array(jsonb_build_object('id',v_id||'-'||v_n,'name',btrim(v_item->>'name'),'criteria',btrim(v_item->>'criteria')));
 end loop;
 if p_equipment is not null then
  if exists(select 1 from jsonb_object_keys(p_equipment) k where k not in ('id','name','model','category')) then raise exception using errcode='22023',message='허용되지 않은 장비 필드입니다.';end if;
  if jsonb_typeof(p_equipment->'name') is distinct from 'string' or char_length(btrim(p_equipment->>'name')) not between 1 and 200 then raise exception using errcode='22023',message='새 장비 이름을 1~200자로 입력하세요.';end if;
  foreach v_name in array array['id','model','category'] loop
   if p_equipment ? v_name and jsonb_typeof(p_equipment->v_name) is distinct from 'string' then raise exception using errcode='22023',message='장비 코드·모델·분류는 문자열이어야 합니다.';end if;
  end loop;
  v_equipment_id:=upper(btrim(coalesce(p_equipment->>'id','')));
  if v_equipment_id='' then v_equipment_id:='USR-EQ-'||upper(substr(v_id,8));end if;
  v_model:=btrim(coalesce(p_equipment->>'model',''));v_category:=coalesce(nullif(btrim(p_equipment->>'category'),''),'기타');
  if char_length(v_equipment_id)>100 or v_equipment_id ~ '[[:cntrl:]]' or char_length(v_model)>200 or char_length(v_category)>100 then raise exception using errcode='22023',message='장비 코드·모델·분류 길이를 확인하세요.';end if;
  perform pg_advisory_xact_lock(hashtextextended('equipment:'||v_equipment_id,0));
  if exists(select 1 from public.hdc_v2_custom_equipment where id=v_equipment_id) or exists(select 1 from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'equipment') e where s.key='factory' and upper(e.value->>'id')=v_equipment_id) then raise sqlstate 'PT409' using message='이미 사용 중인 장비 코드입니다. 기존 장비를 선택하거나 다른 코드를 입력하세요.';end if;
  v_equipment:=jsonb_build_object('id',v_equipment_id,'name',btrim(p_equipment->>'name'),'model',v_model,'category',v_category,'grade','미분류','cycle',v_cycle,'gradeEvidence','현장 등록 · 설비등급 검토 필요','source',jsonb_build_object('id','APP-CUSTOM','sheet','앱에서 추가한 장비'),'isCustom',true);
  insert into public.hdc_v2_custom_equipment(id,body,created_by) values(v_equipment_id,v_equipment,v_actor);
 else
  if jsonb_typeof(p_template->'equipmentId') is distinct from 'string' then raise exception using errcode='22023',message='양식을 연결할 장비를 선택하세요.';end if;
  v_equipment_id:=btrim(p_template->>'equipmentId');
  select body into v_equipment from public.hdc_v2_custom_equipment where id=v_equipment_id;
  if v_equipment is null then select e.value into v_equipment from public.hdc_v2_seed s cross join lateral jsonb_array_elements(s.payload->'equipment') e where s.key='factory' and e.value->>'id'=v_equipment_id;end if;
  if v_equipment is null then raise exception using errcode='22023',message='등록된 장비를 선택하거나 새 장비로 추가하세요.';end if;
 end if;
 v_body:=jsonb_build_object('id',v_id,'equipment',v_equipment_id,'equipmentName',v_equipment->>'name','title',v_title,'cycle',v_cycle,'items',v_items,'isCustom',true,'source',jsonb_build_object('id','APP-CUSTOM','sheet','앱에서 추가한 점검 양식'));
 insert into public.hdc_v2_custom_checklists(id,equipment_id,body,request_hash,created_by) values(v_id,v_equipment_id,v_body,v_hash,v_actor);
 return jsonb_build_object('equipment',v_equipment,'checklist',v_body);
end;$fn$;
revoke all on function hdc_v2_private.create_checklist(jsonb,jsonb) from public,anon,authenticated;
grant execute on function hdc_v2_private.create_checklist(jsonb,jsonb) to authenticated;
create or replace function public.hdc_v2_create_checklist(p_equipment jsonb,p_template jsonb) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.create_checklist(p_equipment,p_template);$fn$;
revoke all on function public.hdc_v2_create_checklist(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.hdc_v2_create_checklist(jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

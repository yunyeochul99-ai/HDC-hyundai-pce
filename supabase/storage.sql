-- HDC PCE V2 private photo storage. Run schema.sql first.
-- Only hdc-v2-private and hdc_v2_* policies/functions are changed.
-- Approved factory members read; approved users upload in their own UUID folder.
-- No app UPDATE/DELETE; immutable photos avoid overwriting existing evidence.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hdc-v2-private','hdc-v2-private',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- Restrictive guards protect this new bucket even if the legacy project contains
-- unrelated permissive storage policies. Other buckets evaluate TRUE and are unaffected.
drop policy if exists hdc_v2_storage_authenticated_guard on storage.objects;
create policy hdc_v2_storage_authenticated_guard on storage.objects as restrictive
for select to public using(bucket_id<>'hdc-v2-private' or (select auth.uid()) is not null);

drop policy if exists hdc_v2_storage_approved_read_guard on storage.objects;
create policy hdc_v2_storage_approved_read_guard on storage.objects as restrictive
for select to authenticated using(bucket_id<>'hdc-v2-private' or (select public.hdc_v2_is_approved()));

drop policy if exists hdc_v2_storage_factory_read on storage.objects;
create policy hdc_v2_storage_factory_read on storage.objects for select to authenticated
using(bucket_id='hdc-v2-private' and (select public.hdc_v2_is_approved()));

drop policy if exists hdc_v2_storage_insert_auth_guard on storage.objects;
create policy hdc_v2_storage_insert_auth_guard on storage.objects as restrictive
for insert to public with check(bucket_id<>'hdc-v2-private' or (select auth.uid()) is not null);

drop policy if exists hdc_v2_storage_own_upload_guard on storage.objects;
create policy hdc_v2_storage_own_upload_guard on storage.objects as restrictive
for insert to authenticated with check(
  bucket_id<>'hdc-v2-private' or (
    (select public.hdc_v2_is_approved())
    and storage.foldername(name)=array[(select auth.uid())::text]
    and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

drop policy if exists hdc_v2_storage_own_upload on storage.objects;
create policy hdc_v2_storage_own_upload on storage.objects for insert to authenticated
with check(
  bucket_id='hdc-v2-private'
  and (select public.hdc_v2_is_approved())
  and storage.foldername(name)=array[(select auth.uid())::text]
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

drop policy if exists hdc_v2_storage_no_update on storage.objects;
create policy hdc_v2_storage_no_update on storage.objects as restrictive
for update to public using(bucket_id<>'hdc-v2-private') with check(bucket_id<>'hdc-v2-private');
drop policy if exists hdc_v2_storage_no_delete on storage.objects;
create policy hdc_v2_storage_no_delete on storage.objects as restrictive
for delete to public using(bucket_id<>'hdc-v2-private');

create or replace function hdc_v2_private.register_photo(p_id uuid,p_mime_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_path text;
  v_metadata jsonb;
  v_existing public.hdc_v2_photos%rowtype;
begin
  if v_actor is null or not hdc_v2_private.is_approved() then
    raise exception using errcode='42501',message='승인된 사용자만 사진을 등록할 수 있습니다.';
  end if;
  if p_id is null or p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp')
    or p_size is null or p_size<=0 or p_size>5242880 then
    raise exception using errcode='22023',message='JPG, PNG, WebP 사진을 5MB 이하로 업로드하세요.';
  end if;
  v_path := v_actor::text || '/' || p_id::text;
  select metadata into v_metadata from storage.objects
  where bucket_id='hdc-v2-private' and name=v_path;
  if not found then
    raise exception using errcode='22023',message='사진 파일을 먼저 내 계정 폴더에 업로드하세요.';
  end if;
  if v_metadata ? 'mimetype' and v_metadata->>'mimetype' <> p_mime_type then
    raise exception using errcode='22023',message='사진의 실제 저장 형식과 요청 형식이 다릅니다.';
  end if;
  if v_metadata->>'size' ~ '^[0-9]+$' and (v_metadata->>'size')::numeric <> p_size then
    raise exception using errcode='22023',message='사진의 실제 저장 크기와 요청 크기가 다릅니다.';
  end if;
  select * into v_existing from public.hdc_v2_photos where id=p_id;
  if found then
    if v_existing.owner_id<>v_actor or v_existing.object_path<>v_path
      or v_existing.mime_type<>p_mime_type or v_existing.size<>p_size then
      raise sqlstate 'PT409' using message='PHOTO_CONFLICT',hint='새 사진 식별자로 업로드하세요.';
    end if;
  else
    insert into public.hdc_v2_photos(id,owner_id,object_path,mime_type,size)
    values(p_id,v_actor,v_path,p_mime_type,p_size);
  end if;
  return jsonb_build_object('id',p_id,'mimeType',p_mime_type,'size',p_size,'path',v_path);
end;
$fn$;
revoke all on function hdc_v2_private.register_photo(uuid,text,integer) from public,anon,authenticated;
grant execute on function hdc_v2_private.register_photo(uuid,text,integer) to authenticated;
create or replace function public.hdc_v2_register_photo(p_id uuid,p_mime_type text,p_size integer)
returns jsonb language sql security invoker set search_path = ''
as $fn$ select hdc_v2_private.register_photo(p_id,p_mime_type,p_size); $fn$;
revoke all on function public.hdc_v2_register_photo(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.hdc_v2_register_photo(uuid,text,integer) to authenticated;

notify pgrst,'reload schema';
commit;

-- Upload workflow:
-- 1) Verify JPEG/PNG/WebP signature and file size in the app; generate UUID.
-- 2) storage.from('hdc-v2-private').upload(authUserId + '/' + photoId,file,{upsert:false,contentType:file.type})
-- 3) rpc('hdc_v2_register_photo',{p_id:photoId,p_mime_type:file.type,p_size:file.size})
-- 4) Keep returned id in record.photoIds; resolve object_path from hdc_v2_photos.
-- 5) Use an authenticated download or short-lived signed URL; never use getPublicUrl().
--    A signed URL is temporary access for its holder, so keep it out of public reports.
--
-- Storage enforces 5MB and allowed content types. File signature validation belongs at
-- the upload adapter: SQL cannot inspect Storage object bytes.
-- Existing old photos buckets are not migrated or made private by this script.

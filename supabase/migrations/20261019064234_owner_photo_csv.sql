begin;
create function hdc_v2_private.export_records() returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_owner boolean;
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 v_owner:=exists(select 1 from public.hdc_v2_form_owner where owner_id=auth.uid());
 return jsonb_build_object('isOwner',v_owner,'records',(select coalesce(jsonb_agg((case when v_owner then r.body else r.body-'photoIds'-'photoDetails' end)||case when p.planning is null then '{}'::jsonb else jsonb_build_object('planning',p.planning) end order by r.updated_at desc,r.id),'[]'::jsonb) from public.hdc_v2_records r left join public.hdc_v2_work_plans p on p.record_id=r.id));
end;$fn$;
create function hdc_v2_private.export_photo(p_record text,p_photo uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_body jsonb;
begin
 if auth.uid() is null or not hdc_v2_private.is_approved() or not exists(select 1 from public.hdc_v2_form_owner where owner_id=auth.uid()) then raise exception using errcode='42501',message='이 사진 링크는 지정된 본인 관리자 계정으로만 열 수 있습니다.';end if;
 select body into v_body from public.hdc_v2_records where id=p_record;
 if v_body is null or p_photo is null or not ((v_body->'photoIds') ? p_photo::text) then raise exception using errcode='22023',message='기록에 첨부된 사진을 확인할 수 없습니다.';end if;
 return jsonb_build_object('photoId',p_photo,'title',v_body->>'title','equipmentName',v_body->>'equipmentName','details',coalesce(v_body->'photoDetails'->p_photo::text,jsonb_build_object('stage','unclassified','part','','caption','')));
end;$fn$;
revoke all on function hdc_v2_private.export_records(),hdc_v2_private.export_photo(text,uuid) from public,anon,authenticated;
grant execute on function hdc_v2_private.export_records(),hdc_v2_private.export_photo(text,uuid) to authenticated;
create function public.hdc_v2_export_records() returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.export_records();$fn$;
create function public.hdc_v2_export_photo(p_record text,p_photo uuid) returns jsonb language sql security invoker set search_path='' as $fn$select hdc_v2_private.export_photo(p_record,p_photo);$fn$;
revoke all on function public.hdc_v2_export_records(),public.hdc_v2_export_photo(text,uuid) from public,anon,authenticated;
grant execute on function public.hdc_v2_export_records(),public.hdc_v2_export_photo(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

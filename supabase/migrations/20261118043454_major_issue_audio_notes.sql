-- Private short voice memo support for major issue records.
alter table public.hdc_v2_major_issues add column audio_data text not null default '';
alter table public.hdc_v2_major_issues add constraint hdc_v2_major_issues_audio_size check(length(audio_data)<=180000);
create or replace function hdc_v2_private.major_issue_save(p_record jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;v_old public.hdc_v2_major_issues%rowtype;v_owner boolean;v_title text;v_content text;v_sketch jsonb;v_audio text;v_name text;v_stroke jsonb;v_now timestamptz:=now();
begin
 if v_actor is null or not hdc_v2_private.is_approved() then raise insufficient_privilege;end if;
 if p_record is null or pg_column_size(p_record)>262144 then raise exception using errcode='22023',message='이슈 기록 크기가 허용 범위를 초과했습니다.';end if;
 begin v_id:=(p_record->>'id')::uuid;exception when others then raise exception using errcode='22023',message='이슈 식별자가 올바르지 않습니다.';end;
 v_title:=coalesce(p_record->>'title','');v_content:=coalesce(p_record->>'content','');v_sketch:=coalesce(p_record->'sketch','[]'::jsonb);v_audio:=p_record->>'audio_data';
 if length(btrim(v_title)) not between 1 and 180 or length(v_content)>12000 or jsonb_typeof(v_sketch)<>'array' or jsonb_array_length(v_sketch)>100 then raise exception using errcode='22023',message='제목·본문·스케치 항목 수를 확인하세요.';end if;
 if v_audio is not null and (length(v_audio)>180000 or v_audio !~ '^data:audio/(webm|ogg|mp4|wav)(;codecs=opus)?;base64,[A-Za-z0-9+/=]+$') then raise exception using errcode='22023',message='지원하지 않는 형식이거나 길이 제한을 넘은 음성 기록입니다.';end if;
 for v_stroke in select value from jsonb_array_elements(v_sketch) loop if jsonb_typeof(v_stroke)<>'array' or jsonb_array_length(v_stroke)>400 then raise exception using errcode='22023',message='스케치 데이터 형식이 올바르지 않습니다.';end if;end loop;
 select coalesce(display_name,'') into v_name from public.hdc_v2_profiles where id=v_actor;select exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) into v_owner;select * into v_old from public.hdc_v2_major_issues where id=v_id for update;
 if not found then
  if coalesce(p_expected_version,0)<>0 then raise exception using errcode='40001',message='기록 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.';end if;
  insert into public.hdc_v2_major_issues(id,title,content,sketch,audio_data,author_id,author_name,version,created_at,updated_at) values(v_id,v_title,v_content,v_sketch,coalesce(v_audio,''),v_actor,v_name,1,v_now,v_now) returning * into v_old;
 else
  if v_old.author_id<>v_actor and not v_owner then raise insufficient_privilege;end if;
  if p_expected_version is distinct from v_old.version then raise exception using errcode='40001',message='다른 사용자가 내용을 수정했습니다. 새로고침 후 다시 확인하세요.';end if;
  update public.hdc_v2_major_issues set title=v_title,content=v_content,sketch=v_sketch,audio_data=case when p_record?'audio_data' then coalesce(v_audio,'') else v_old.audio_data end,author_name=case when v_owner then v_old.author_name else v_name end,version=v_old.version+1,updated_at=v_now where id=v_id returning * into v_old;
 end if;return to_jsonb(v_old);
end $$;
revoke all on function hdc_v2_private.major_issue_save(jsonb,integer) from public,anon,authenticated;
grant execute on function hdc_v2_private.major_issue_save(jsonb,integer) to authenticated;

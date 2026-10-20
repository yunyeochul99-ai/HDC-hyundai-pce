do $migration$
declare v_definition text;v_marker text:='  v_found := found;';v_guard text:=$guard$
  -- Date authority is restricted to the dedicated factory owner, including other admins.
  if not exists(select 1 from public.hdc_v2_form_owner where owner_id=v_actor) then
    if v_found then
      if (v_record->>'date') is distinct from (v_existing.body->>'date')
         or coalesce(v_record->>'dueDate','') is distinct from coalesce(v_existing.body->>'dueDate','') then
        raise exception using errcode='42501',message='기록 일자와 완료 기한은 윤여철 공장장만 변경할 수 있습니다.';
      end if;
    elsif (v_record->>'date') is distinct from to_char(v_now at time zone 'Asia/Seoul','YYYY-MM-DD')
       or coalesce(v_record->>'dueDate','')<>'' then
      raise exception using errcode='42501',message='새 기록은 오늘 날짜·완료 기한 미지정으로 등록하세요. 다른 날짜는 윤여철 공장장만 지정할 수 있습니다.';
    end if;
  end if;
$guard$;
begin
 v_definition:=pg_get_functiondef('hdc_v2_private.save_record(jsonb)'::regprocedure);
 if position(v_marker in v_definition)=0 then raise exception 'save_record date guard insertion point not found';end if;
 if position('Date authority is restricted' in v_definition)>0 then raise exception 'date guard already installed';end if;
 execute replace(v_definition,v_marker,v_marker||v_guard);
end;$migration$;


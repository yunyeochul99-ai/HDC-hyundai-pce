import {readStatutoryDetails, statutoryFields, type StatutoryDetails} from './statutory-plans';

export function StatutoryPlanFields({value,onChange,disabled}:{value:StatutoryDetails;onChange:(value:StatutoryDetails)=>void;disabled:boolean}) {
  return <fieldset className="statutory-fields" disabled={disabled}>
    <legend>검사대상기기 관리대장</legend>
    <p className="footnote">관리대장의 항목에 맞춰 입력하세요. 검사일은 직접 입력하며 검사주기를 바꿔도 자동 변경되지 않습니다.</p>
    <div className="form-grid">{statutoryFields.map(([key,label,limit]) => <label key={key}>{label}
      <input type={key==='lastDate'||key==='nextDate'?'date':'text'} maxLength={limit} value={value[key]}
        list={key==='group'?'statutory-groups':undefined}
        onChange={event=>onChange({...value,[key]:event.target.value})}/>
    </label>)}</div>
    <datalist id="statutory-groups">{['설비','중기','양중장비','기타'].map(group=><option key={group} value={group}/>)}</datalist>
  </fieldset>;
}

export function StatutoryPlanSummary({evidence}:{evidence?:string}) {
  const details=readStatutoryDetails(evidence);
  return <dl className="statutory-summary">{statutoryFields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{details[key]||'미등록'}</dd></div>)}</dl>;
}

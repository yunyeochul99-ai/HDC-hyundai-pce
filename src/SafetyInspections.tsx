import {useEffect,useMemo,useState} from 'react';
import {loadSafetyInspections,newSafetyInspection,saveSafetyInspection,type SafetyCadence,type SafetyInspection,type SafetyItem,type SafetyResult} from './safety-inspections';
import './safety-inspection.css';

const periods:SafetyCadence[]=['일별','주별','월별'];
const dateText=(value:string)=>value?value.replaceAll('-','.'): '날짜 미기재';
const timeText=(value:string)=>{const d=new Date(value);return Number.isNaN(d.valueOf())?'':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(d);};
const signature=(r:SafetyInspection)=>JSON.stringify({cadence:r.cadence,inspection_date:r.inspection_date,area:r.area,inspector:r.inspector,shift:r.shift,follow_up:r.follow_up,items:r.items,status:r.status});
const resultLabels:SafetyResult[]=['양호','불량','해당없음','미점검'];
const defaultStandard='현장 기준과 확인 결과를 적습니다.';

export default function SafetyInspections({userId,userName,isOwner}:{userId:string;userName:string;isOwner:boolean}){
 const [rows,setRows]=useState<SafetyInspection[]>([]);
 const [record,setRecord]=useState<SafetyInspection|null>(null);
 const [saved,setSaved]=useState<SafetyInspection|null>(null);
 const [period,setPeriod]=useState<SafetyCadence>('일별');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [mode,setMode]=useState<'view'|'edit'>('view');
 const [error,setError]=useState('');
 const dirty=!!record&&(!saved||signature(record)!==signature(saved));
 const canEdit=!!record&&(isOwner||record.created_by===userId);
 const defects=record?.items.filter(i=>i.result==='불량')||[];
 const completionProblems=useMemo(()=>{if(!record)return [];const out:string[]=[];if(!record.area.trim())out.push('점검 구역');if(!record.inspector.trim())out.push('점검자');if(!record.items.length)out.push('점검 항목');if(record.items.some(i=>i.result==='미점검'))out.push('미점검 항목');if(record.items.some(i=>i.result==='불량'&&!i.note.trim()))out.push('불량 내용·임시조치');if(record.items.some(i=>i.result==='불량')&&!record.follow_up.trim())out.push('후속 조치');return out;},[record]);
 async function refresh(){setLoading(true);setError('');try{setRows(await loadSafetyInspections());}catch(e){setError(e instanceof Error?e.message:'안전점검 기록을 불러오지 못했습니다.');}finally{setLoading(false);}}
 useEffect(()=>{void refresh();},[]);
 const visible=rows.filter(r=>r.cadence===period);
 function startNew(){if(dirty&&!window.confirm('저장하지 않은 내용을 버리고 새 점검표를 작성할까요?'))return;const next=newSafetyInspection(period,userName);setRecord(next);setSaved(null);setMode('edit');setError('');}
 function openSaved(row:SafetyInspection){if(dirty&&!window.confirm('저장하지 않은 내용을 버리고 다른 기록을 열까요?'))return;setRecord(row);setSaved(row);setPeriod(row.cadence);setMode('view');setError('');}
 function patch(p:Partial<SafetyInspection>){setRecord(current=>current?{...current,...p}:current);}
 function patchItem(itemId:string,p:Partial<SafetyItem>){setRecord(current=>current?{...current,items:current.items.map(item=>item.id===itemId?{...item,...p}:item)}:current);}
 async function save(status:'작성중'|'완료'){
  if(!record||saving)return;
  if(status==='완료'&&completionProblems.length){setError('점검 완료 전에 확인하세요: '+completionProblems.join(' · '));return;}
  setSaving(true);setError('');
  try{const submitted={...record,status};const result=await saveSafetyInspection(submitted,record.version);setRows(current=>[result,...current.filter(r=>r.id!==result.id)].sort((a,b)=>b.inspection_date.localeCompare(a.inspection_date)||b.updated_at.localeCompare(a.updated_at)));setRecord(result);setSaved(result);setMode(status==='완료'?'view':'edit');}
  catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다. 연결을 확인하고 다시 시도하세요.');}
  finally{setSaving(false);}
 }
 function addItem(){if(!record)return;setRecord({...record,items:[...record.items,{id:crypto.randomUUID(),name:'추가 점검 항목',standard:defaultStandard,result:'미점검',note:'',custom:true}]});}
 function removeItem(itemId:string){if(!record)return;setRecord({...record,items:record.items.filter(item=>item.id!==itemId)});}
 const canPrint=!!saved&&!dirty;
 return <section className="safety-inspection-root">
  <div className="safety-screen">
   <div className="safety-intro card"><div><span className="safety-eyebrow">FIELD SAFETY CHECK</span><h2>일·주·월 안전점검 기록</h2><p>점검 결과와 부적합 조치 필요사항을 남기고 저장된 기록을 출력합니다.</p></div><button className="secondary" onClick={()=>void refresh()} disabled={loading}>기록 새로고침</button></div>
   <div className="safety-cadence-tabs" role="tablist" aria-label="점검 주기">{periods.map(p=><button type="button" role="tab" aria-selected={period===p} className={period===p?'active':''} key={p} onClick={()=>setPeriod(p)}>{p} 점검 <span>{rows.filter(r=>r.cadence===p).length}</span></button>)}</div>
   <div className="safety-workspace">
    <aside className="safety-record-list card"><div className="card-heading"><div><h3>{period} 점검기록</h3><p>최근 기록부터 표시</p></div><button type="button" className="primary" onClick={startNew}>새 점검표 +</button></div>
     {loading?<p className="safety-empty">서버 기록을 확인하고 있습니다…</p>:visible.length?visible.map(row=><button type="button" className={'safety-record-row '+(record?.id===row.id?'selected':'')} key={row.id} onClick={()=>openSaved(row)}><span className="safety-record-top"><b>{dateText(row.inspection_date)} · {row.area||'구역 미기재'}</b><em className={row.items.some(i=>i.result==='불량')?'issue':''}>{row.items.some(i=>i.result==='불량')?'불량 항목 있음':row.status}</em></span><span>{row.inspector||'점검자 미기재'}{row.shift?' · '+row.shift:''} · {row.items.filter(i=>i.result!=='미점검').length}/{row.items.length}항목</span><small>{row.items.filter(i=>i.result==='불량').length?'불량 '+row.items.filter(i=>i.result==='불량').length+'건 · ':''}수정 {timeText(row.updated_at)}</small></button>):<p className="safety-empty">이 주기의 기록이 없습니다. 새 점검표를 작성하세요.</p>}
    </aside>
    <div className="safety-form card">
     {!record?<div className="safety-empty large"><span>✓</span><h3>점검기록을 선택하거나 새로 작성하세요</h3><p>일별·주별·월별 점검표와 저장된 기록을 이곳에서 관리할 수 있습니다.</p><button type="button" className="primary" onClick={startNew}>새 {period} 점검표 작성</button></div>:<>
      <div className="card-heading safety-form-heading"><div><span className="safety-eyebrow">{record.cadence.toUpperCase()} SAFETY CHECK</span><h2>{record.cadence} 안전점검표</h2><p>{record.status==='완료'?'점검 완료 기록':'작성 중 · 저장 후 다른 기기에서도 조회'}{record.version?' · 버전 '+record.version:''}</p></div><span className={'safety-status '+(defects.length?'issue':'')}>{defects.length?'불량 '+defects.length+'건':record.status}</span></div>
      <div className="safety-fields"><label>점검일<input type="date" value={record.inspection_date} disabled={mode==='view'} onChange={e=>patch({inspection_date:e.target.value})}/></label><label>점검 구역·공정<input maxLength={120} placeholder="예: 홀1 · 절단 작업구역" value={record.area} disabled={mode==='view'} onChange={e=>patch({area:e.target.value})}/></label><label>점검자<input maxLength={100} placeholder="점검자 이름" value={record.inspector} disabled={mode==='view'} onChange={e=>patch({inspector:e.target.value})}/></label><label>근무조·시간대<input maxLength={80} placeholder="선택 입력" value={record.shift} disabled={mode==='view'} onChange={e=>patch({shift:e.target.value})}/></label></div>
      {defects.length>0&&<div className="safety-alert" role="status"><b>부적합 {defects.length}건</b><span>점검 완료 여부와 위험 해소 여부는 다릅니다. 현장 안전조치를 하고 아래 후속 조치사항을 기록하세요. 보전 작업은 자동 접수되지 않습니다.</span></div>}
      <div className="safety-check-list">{record.items.map((item,index)=><article className={'safety-check-row '+(item.result==='불량'?'is-issue':'')} key={item.id}><div className="safety-check-heading"><span>{String(index+1).padStart(2,'0')}</span><div className="safety-item-definition">{mode==='edit'?<><label>점검 항목<input maxLength={160} value={item.name} onChange={e=>patchItem(item.id,{name:e.target.value})}/></label><label>확인 기준<input maxLength={300} value={item.standard} onChange={e=>patchItem(item.id,{standard:e.target.value})}/></label></>:<><b>{item.name}</b><small>{item.standard}</small></>}</div></div><div className="safety-result-buttons" role="group" aria-label={item.name+' 결과'}>{resultLabels.map(result=><button type="button" key={result} disabled={mode==='view'} aria-pressed={item.result===result} className={(item.result===result?'chosen ':'')+(result==='불량'?'bad':'')} onClick={()=>patchItem(item.id,{result})}>{result}</button>)}</div>{mode==='edit'&&<div className="safety-item-note"><label>{item.result==='불량'?'불량 내용·임시조치 (필수)':'점검 메모'}<input maxLength={500} placeholder={item.result==='불량'?'확인한 위험과 임시조치를 기록하세요':'필요한 경우 메모'} value={item.note} onChange={e=>patchItem(item.id,{note:e.target.value})}/></label>{item.custom&&<button type="button" className="text-btn danger-text" onClick={()=>removeItem(item.id)}>추가 항목 삭제</button>}</div>}{mode==='view'&&item.note&&<p className="safety-saved-note">점검 메모: {item.note}</p>}</article>)}</div>
      {mode==='edit'&&<button type="button" className="secondary safety-add-item" onClick={addItem}>+ 현장 추가 항목</button>}
      <label className="safety-follow-up">후속 조치·담당·기한{defects.length>0&&<b> 불량 발견 시 필수</b>}<textarea maxLength={2000} disabled={mode==='view'} placeholder="예: 작업구역 임시 통제, 담당자·후속 요청·목표일을 기록하세요. 정비 요청은 별도 접수 절차를 사용합니다." value={record.follow_up} onChange={e=>patch({follow_up:e.target.value})}/></label>
      <div className="safety-form-note"><b>사용 범위</b><span>현장 안전 확인용 기록표입니다. 법정 검사, 위험성평가, 자격자 점검 및 회사 승인 절차를 대체하지 않습니다. 각 항목은 현장 기준에 맞게 추가·수정해 사용하세요.</span></div>
      {error&&<div role="alert" className="error-msg safety-error">{error}</div>}
      <div className="safety-actions">{mode==='view'?<>{canEdit&&<button type="button" className="secondary" onClick={()=>setMode('edit')}>기록 수정</button>}<button type="button" className="secondary" disabled={!canPrint} title={dirty?'저장하지 않은 변경사항이 있습니다. 먼저 저장하세요.':''} onClick={()=>window.print()}>저장 기록 인쇄</button></>:<><button type="button" className="secondary" disabled={saving} onClick={()=>void save('작성중')}>{saving?'저장 중…':'작성 중 저장'}</button><button type="button" className="secondary" disabled={saving||!canPrint} onClick={()=>window.print()}>저장 기록 인쇄</button><button type="button" className="primary" disabled={saving} onClick={()=>void save('완료')}>{saving?'저장 중…':'점검 완료 저장'}</button>{saved&&<button type="button" className="text-btn" disabled={saving} onClick={()=>{setRecord(saved);setMode('view');setError('');}}>변경 취소</button>}</>}</div>
      {dirty&&<p className="safety-unsaved">변경사항이 저장되지 않았습니다. 다른 화면으로 이동하기 전에 서버에 저장하세요.</p>}
     </>}
    </div>
   </div>
   {error&&!record&&<div role="alert" className="error-msg">{error}</div>}
  </div>
  {canPrint&&saved&&<article className="safety-print-area" aria-label="인쇄용 안전점검표"><div className="safety-print-brand">HDC 현대PCE · 설비보전 통합관리</div><h1>{saved.cadence} 안전점검 기록표</h1><div className="safety-print-meta"><span><b>점검일</b>{dateText(saved.inspection_date)}</span><span><b>점검 구역·공정</b>{saved.area||'미기재'}</span><span><b>점검자</b>{saved.inspector||'미기재'}</span><span><b>근무조·시간대</b>{saved.shift||'미기재'}</span><span><b>기록 상태</b>{saved.status}</span><span><b>저장 시각</b>{timeText(saved.updated_at)}</span></div><table><thead><tr><th>No.</th><th>점검 항목</th><th>확인 기준</th><th>결과</th><th>메모·불량 조치</th></tr></thead><tbody>{saved.items.map((item,index)=><tr key={item.id}><td>{index+1}</td><td>{item.name}</td><td>{item.standard}</td><td className={item.result==='불량'?'print-issue':''}>{item.result}</td><td>{item.note||'—'}</td></tr>)}</tbody></table><section className="safety-print-followup"><b>후속 조치·담당·기한</b><p>{saved.follow_up||'없음'}</p></section><p className="safety-print-caveat">현장 안전 확인용 기록이며 법정검사·위험성평가·자격자 점검을 대체하지 않습니다. 점검 완료는 불량 위험의 해소를 뜻하지 않습니다.</p><div className="safety-signatures"><span>점검자 확인: {saved.inspector||'________________'} (서명)</span><span>확인 일시: {timeText(saved.updated_at)}</span></div></article>}
 </section>;
}

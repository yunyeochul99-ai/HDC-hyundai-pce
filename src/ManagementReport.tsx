import {WorkflowKpi} from './WorkflowTrail';
import type {FlowEvent} from './workflow';
import {useState} from 'react';
import {normalizePlan,workIntervalMinutes,type WorkPlan} from './maintenance';
import './management-report.css';

type ReportRecord={id:string;type:string;date:string;title:string;equipmentName:string;assignee:string;status:string;dueDate:string;items:{result:string}[];planning?:WorkPlan};
type Period='주별'|'월별'|'연도별';
const now=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const day=(s:string)=>new Date(s+'T00:00:00Z');
const iso=(d:Date)=>d.toISOString().slice(0,10);
export function reportRange(period:Period,anchor:string){
 const d=day(anchor);if(!Number.isFinite(d.getTime()))return {start:'',end:''};
 if(period==='연도별')return {start:anchor.slice(0,4)+'-01-01',end:anchor.slice(0,4)+'-12-31'};
 if(period==='월별')return {start:anchor.slice(0,7)+'-01',end:iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)))};
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const start=iso(d);d.setUTCDate(d.getUTCDate()+6);return {start,end:iso(d)};
}
const f=(n:number)=>n.toLocaleString('ko-KR');
const cell=(v:unknown)=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replace(/"/g,'""')+'"';
export default function ManagementReport({workflow,activeIds,records,onRefresh}:{workflow:FlowEvent[];activeIds:Set<string>;records:ReportRecord[];onRefresh:()=>void}){
 const [period,setPeriod]=useState<Period>('월별');const [anchor,setAnchor]=useState(now());
 const {start,end}=reportRange(period,anchor);const inRange=(s:string)=>!!start&&s>=start&&s<=end;
 const checks=records.filter(r=>r.type==='inspection'&&inRange(r.date));
 const works=records.filter(r=>r.type==='workorder');
 const completed=works.filter(r=>r.status==='완료'&&inRange(normalizePlan(r.planning).actualEndAt.slice(0,10)||r.date));
 const received=works.filter(r=>inRange(r.date));
 const planned=works.filter(r=>inRange(normalizePlan(r.planning).plannedDate));
 const open=works.filter(r=>r.status!=='완료');
 const defective=checks.filter(r=>r.items.some(i=>i.result==='불량'));
 const knownCost=completed.filter(r=>normalizePlan(r.planning).actualCost!==null);
 const cost=knownCost.reduce((n,r)=>n+(normalizePlan(r.planning).actualCost||0),0);
 const minutes=(r:ReportRecord)=>{const p=normalizePlan(r.planning);return workIntervalMinutes(p.actualStartAt,p.actualEndAt)??p.actualMinutes;};
 const timed=completed.filter(r=>minutes(r)!==null);const totalMinutes=timed.reduce((n,r)=>n+(minutes(r)||0),0);
 const fallback=completed.filter(r=>!normalizePlan(r.planning).actualEndAt).length;
 const groups=new Map<string,{checks:number;done:number;cost:number}>();
 const tick=day(start||now());while(start&&iso(tick)<=end){const key=period==='연도별'?iso(tick).slice(0,7):iso(tick);if(!groups.has(key))groups.set(key,{checks:0,done:0,cost:0});tick.setUTCDate(tick.getUTCDate()+1);}
 checks.forEach(r=>{const k=period==='연도별'?r.date.slice(0,7):r.date;const g=groups.get(k);if(g)g.checks++;});
 completed.forEach(r=>{const p=normalizePlan(r.planning),date=p.actualEndAt.slice(0,10)||r.date,k=period==='연도별'?date.slice(0,7):date;const g=groups.get(k);if(g){g.done++;g.cost+=p.actualCost||0;}});
 const breakdown=Array.from(new Set([...checks,...completed].map(r=>r.equipmentName))).sort((a,b)=>a.localeCompare(b,'ko')).map(name=>({name,checks:checks.filter(r=>r.equipmentName===name).length,done:completed.filter(r=>r.equipmentName===name).length,cost:completed.filter(r=>r.equipmentName===name).reduce((n,r)=>n+(normalizePlan(r.planning).actualCost||0),0)}));
 const exportCsv=()=>{const rows:unknown[][]=[['HDC HYUNDAI PCE 보전 실적 보고서'],['보고 단위',period],['기간',start,end],['집계 시각(KST)',new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})],['점검 건수',checks.length],['불량 포함 점검',defective.length],['기간 접수 작업',received.length],['기간 계획 작업',planned.length],['완료 작업',completed.length],['등록 실제 비용(원)',cost],['비용 미입력(건)',completed.length-knownCost.length],['등록 작업시간(분)',totalMinutes],['작업시간 미입력(건)',completed.length-timed.length],['완료일 미입력·기록일 기준(건)',fallback],[],['일자/월','점검(건)','완료(건)','등록 실제 비용(원)'],...[...groups].map(([k,g])=>[k,g.checks,g.done,g.cost]),[],['완료 작업 상세'],['제목','설비','담당자','기록일','실제 시작','실제 종료','실제 시간(분)','실제 비용(원)','집계일 기준'],...completed.map(r=>{const p=normalizePlan(r.planning);return [r.title,r.equipmentName,r.assignee,r.date,p.actualStartAt,p.actualEndAt,minutes(r),p.actualCost,p.actualEndAt?'실제 종료일':'기록일 대체'];}),[],['집계 기준','점검·접수는 기록일, 계획은 계획일, 완료는 실제 종료일(없으면 기록일). 현재 저장 상태 기준이며 과거 시점 상태를 복원하지 않습니다.'],['제외','삭제 보관된 기록·기기 임시 저장·과거 수선비 원장·사진 주소는 제외. 작업시간은 생산 손실시간과 다릅니다.']];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`보전실적_${period}_${start}_${end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <div className="report-content management-report"><section className="card report-controls"><h2>보전 실적 자동 보고서</h2><p>보고 기간을 선택하면 서버에서 조회한 기록으로 즉시 집계합니다.</p><div className="button-row"><label>보고 단위<select value={period} onChange={e=>setPeriod(e.target.value as Period)}>{(['주별','월별','연도별'] as Period[]).map(p=><option key={p}>{p}</option>)}</select></label><label>기준 날짜<input type="date" required value={anchor} onChange={e=>{if(e.target.value)setAnchor(e.target.value);}}/></label><button className="secondary" onClick={onRefresh}>최신 서버 기록 조회</button><button className="secondary" onClick={exportCsv}>실적 보고서 CSV</button></div><p><b>{start} ~ {end}</b> · 한국시간 · 주별은 월요일~일요일(토요일 정상근무)</p></section><section className="card"><h2>{period} 보전 실적 보고</h2><p>보고 기간: {start} ~ {end} · 작성일: {now()}</p><div className="report-metrics"><div><b>{checks.length}<small>건</small></b><span>점검 / 불량 포함 {defective.length}건</span></div><div><b>{completed.length}<small>건</small></b><span>기간 완료 작업</span></div><div><b>{f(cost)}<small>원</small></b><span>등록 실제 비용</span></div><div><b>{f(totalMinutes)}<small>분</small></b><span>등록 실제 작업시간</span></div></div><h3>자동 작성 실적 요약</h3><p>이 기간 점검 {checks.length}건 중 불량 포함 점검은 {defective.length}건입니다. 접수된 보전 작업은 {received.length}건, 이 기간에 계획된 작업은 {planned.length}건이며, 완료 실적은 {completed.length}건입니다. 등록된 실제 보전비는 {f(cost)}원, 실제 작업시간은 {f(totalMinutes)}분입니다.</p><p className="report-data-note">보완 필요: 완료 작업 중 비용 미입력 {completed.length-knownCost.length}건 · 시간 미입력 {completed.length-timed.length}건 · 실제 종료일 미입력으로 기록일을 사용한 작업 {fallback}건. 미입력은 0원·0분 실적으로 확정하지 않습니다.</p><p>현재 미완료 작업 {open.length}건 · 현재 기한 경과 {open.filter(r=>r.dueDate&&r.dueDate<now()).length}건 (선택 기간과 별도의 현재 현황)</p><h3>{period==='연도별'?'월별':'일자별'} 실적</h3><div className="table-wrap"><table><thead><tr><th>기간</th><th>점검</th><th>완료</th><th>등록 실제 비용(원)</th></tr></thead><tbody>{[...groups].map(([k,g])=><tr key={k}><td>{k}</td><td>{g.checks}</td><td>{g.done}</td><td>{f(g.cost)}</td></tr>)}</tbody></table></div><h3>설비별 실적</h3>{breakdown.length?<div className="table-wrap"><table><thead><tr><th>설비</th><th>점검</th><th>완료</th><th>등록 실제 비용(원)</th></tr></thead><tbody>{breakdown.map(g=><tr key={g.name}><td>{g.name}</td><td>{g.checks}</td><td>{g.done}</td><td>{f(g.cost)}</td></tr>)}</tbody></table></div>:<p>이 기간에 저장된 실적이 없습니다.</p>}<div className="report-source">점검·접수는 기록일, 계획은 계획일, 완료는 실제 종료일 기준입니다. 실제 종료일이 없는 기존 완료 기록은 기록일로 집계합니다. 현재 저장된 상태를 집계하며 과거 시점의 승인·진행 상태를 복원하지 않습니다. 보관 삭제·기기 임시 저장·과거 원장 자료는 제외합니다. 작업시간은 생산 손실시간과 다르며 실제 생산량 손실을 추정하지 않습니다. 기록 수정 시 재조회하면 보고서에 반영됩니다.</div></section><WorkflowKpi events={workflow} start={start} end={end} activeIds={activeIds}/></div>;
}

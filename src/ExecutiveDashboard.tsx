import {buildMaintenanceEvents} from './maintenance-calendar';
import {workIntervalMinutes,normalizePlan} from './maintenance';
import {cmResult} from './cm-improvement';
import type {ManagedPlan} from './preventive-plans';

type Item={result:string};
type Spare={id:string;code:string;name:string;equipment:string;confirmedQuantity:number|null;safety:number|null;unitPrice?:number|null;supplier?:string;leadTime?:string};
type RecordRow={id:string;type:string;title:string;equipmentName:string;equipmentId:string;status:string;priority:string;assignee:string;date:string;dueDate:string;items:Item[];preventivePlanId?:string;sourceInspectionId?:string;planning?:any};
type Props={records:RecordRow[];plans:ManagedPlan[];equipmentIds:Set<string>;spares:Spare[];onRecord:(id:string)=>void;onPlan:(id:string)=>void;onOrders:()=>void;onSpareParts:()=>void;onReport:()=>void};
const now=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const fmt=(n:number)=>new Intl.NumberFormat('ko-KR').format(Math.round(n));
const month=(date:string,offset:number)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,7);};
const dateValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'));
const interval=(a:string,b:string)=>{if(!a||!b)return null;return workIntervalMinutes(a,b);};
const kstDate=(date:string)=>date?date.replaceAll('-','.'):'';

export default function ExecutiveDashboard({records,plans,equipmentIds,spares,onRecord,onPlan,onOrders,onSpareParts,onReport}:Props){
 const today=now(),currentMonth=today.slice(0,7),nextMonth=month(today,1),priorMonth=month(today,-1);
 const works=records.filter(r=>r.type==='workorder'),checks=records.filter(r=>r.type==='inspection');
 const active=works.filter(r=>r.status!=='완료'),overdue=active.filter(r=>r.dueDate&&r.dueDate<today);
 const plannedToDate=works.filter(r=>{const d=r.planning?.plannedDate||'';return dateValid(d)&&d.slice(0,7)===currentMonth&&d<=today;});
 const completedToDate=plannedToDate.filter(r=>r.status==='완료'&&!!r.planning?.actualEndAt);
 const completionRate=plannedToDate.length?Math.round(completedToDate.length/plannedToDate.length*100):null;
 const events=buildMaintenanceEvents(works as any[],plans,today,equipmentIds);
 const nextEvents=events.filter(e=>e.date.slice(0,7)===nextMonth).slice(0,10);
 const upcoming=events.filter(e=>e.date>=today&&e.date<=new Date(Date.parse(today+'T00:00:00Z')+30*86400000).toISOString().slice(0,10));
 const defectChecks=checks.filter(r=>r.items?.some(i=>i.result==='불량'));
 const linkedInspectionIds=new Set(works.map(r=>r.sourceInspectionId).filter(Boolean));
 const unaddressed=defectChecks.filter(r=>r.status!=='완료'&&!linkedInspectionIds.has(r.id));
 const highSignals=[...overdue.filter(r=>r.priority==='긴급'||r.priority==='높음').map(r=>({r,why:`기한 경과 · ${r.priority} 우선순위`})),...active.filter(r=>r.planning?.failureCauseStatus==='확인'&&r.planning?.failureEvidence?.trim()&&(r.priority==='긴급'||r.priority==='높음')).map(r=>({r,why:'확인된 고장 원인·근거 · 높은 우선순위'}))];
 const uniqueHigh=[...new Map(highSignals.map(x=>[x.r.id,x])).values()];
 const stockKnown=spares.filter(s=>s.confirmedQuantity!=null&&s.safety!=null&&Number.isFinite(s.confirmedQuantity)&&Number.isFinite(s.safety));
 const belowSafety=stockKnown.filter(s=>s.confirmedQuantity!<s.safety!);
 const stockUnknown=spares.filter(s=>s.confirmedQuantity==null||s.safety==null);
 const downtimeRows=works.map(r=>({r,minutes:interval(r.planning?.downtimeStartAt||'',r.planning?.downtimeEndAt||'')})).filter(x=>x.minutes!==null);
 const previousCutoff=(()=>{const [y,m,d]=today.split('-').map(Number),last=new Date(Date.UTC(y,m-1,0)).getUTCDate();return `${priorMonth}-${String(Math.min(d,last)).padStart(2,'0')}`;})();
 const downtimeThis=downtimeRows.filter(x=>x.r.planning?.downtimeStartAt?.slice(0,7)===currentMonth&&x.r.planning?.downtimeStartAt?.slice(0,10)<=today).reduce((n,x)=>n+(x.minutes||0),0);
 const downtimePrevious=downtimeRows.filter(x=>x.r.planning?.downtimeStartAt?.slice(0,7)===priorMonth&&x.r.planning?.downtimeStartAt?.slice(0,10)<=previousCutoff).reduce((n,x)=>n+(x.minutes||0),0);
 const downtimeChange=downtimePrevious>0?Math.round((downtimeThis-downtimePrevious)/downtimePrevious*100):null;
 const cmRows=works.filter(r=>r.planning?.category==='개선보전');
 const cmMeasured=cmRows.filter(r=>cmResult(r as any));
 const savedMinutes=cmMeasured.reduce((n,r)=>n+Math.max(0,cmResult(r as any)?.saved||0),0);
 const bottlenecks=active.filter(r=>!r.assignee.trim()||r.planning?.approval!=='승인'||!r.planning?.plannedDate);
 return <div className="executive-dashboard">
  <section className="card executive-intro"><div><span className="tag blue">경영진 의사결정</span><h2>예방·병목·실적 현황</h2><p>{kstDate(today)} 기준 · 운영기록과 승인된 예방정비 기준에서 확인되는 신호만 집계합니다.</p></div><div className="executive-actions"><button className="secondary" onClick={onOrders}>작업계획 보기 ↗</button><button className="secondary" onClick={onReport}>실적 보고 ↗</button></div></section>
  <div className="executive-kpis">
   <article className="executive-kpi"><span>이번 달 계획 이행</span><b>{completionRate===null?'계산 보류':`${completionRate}%`}</b><small>{plannedToDate.length?`${completedToDate.length}/${plannedToDate.length}건 · 계획일 도래분`:'계획일이 입력된 당월 작업 분모 없음'}</small></article>
   <article className="executive-kpi tone-red"><span>기한 경과 미완료</span><b>{overdue.length}건</b><small>미완료 {active.length}건 중 완료 기한이 지난 작업</small></article>
   <article className="executive-kpi tone-amber"><span>다음 30일 예방·검사 예정</span><b>{upcoming.length}건</b><small>등록 일정 또는 검증 가능한 기준 주기</small></article>
   <article className="executive-kpi"><span>실측 설비 정지시간</span><b>{fmt(downtimeThis)}분</b><small>{downtimeChange===null?'전월 비교 보류 · 전월 실측 0분 또는 자료 없음':`전월 대비 ${downtimeChange>0?'+':''}${downtimeChange}% · 실측 입력분만`}</small></article>
  </div>
  <div className="executive-grid">
   <section className="card"><div className="card-heading"><div><h2>다음 달 점검·정비 확인 예정</h2><p>{nextMonth} · 확정 일정과 승인된 주기 기준 일정</p></div><span className="tag">{nextEvents.length}건</span></div>{nextEvents.length?<div className="executive-list">{nextEvents.map(e=><button className="executive-row" key={e.id} onClick={()=>e.recordId?onRecord(e.recordId):e.planId?onPlan(e.planId):onOrders()}><span className="executive-date">{e.date}</span><span><b>{e.equipment}</b><small>{e.title}</small></span><span className="tag blue">{e.status}</span></button>)}</div>:<p className="executive-empty">다음 달로 확인 가능한 일정이 없습니다. 계획 일정·승인된 점검 주기 등록 여부를 확인하세요.</p>}<p className="footnote">주기 기준 일정은 기준일·주기·설비 연결·승인 상태가 확인되는 예방정비만 표시합니다. 고장 발생 확률을 뜻하지 않습니다.</p></section>
   <section className="card"><div className="card-heading"><div><h2>우선 위험 신호 · 높음</h2><p>기한 경과와 확인된 근거를 기준으로 한 조치 우선순위</p></div><span className="tag red">{uniqueHigh.length}건</span></div>{uniqueHigh.length?<div className="executive-list">{uniqueHigh.slice(0,6).map(({r,why})=><button className="executive-row" key={r.id} onClick={()=>onRecord(r.id)}><span className="tag red">높음</span><span><b>{r.equipmentName} · {r.title}</b><small>{why} · 기한 {r.dueDate||'미지정'}</small></span><span className="tag">{r.status}</span></button>)}</div>:<p className="executive-empty">현재 등록된 규칙 기준 ‘높음’ 신호가 없습니다. 이는 고장 위험이 없다는 뜻은 아닙니다.</p>}<div className="executive-rule"><b>판정 기준</b><span>높음/긴급 우선순위의 기한 경과 작업 또는 확인 상태의 고장 원인·근거가 기록된 높은 우선순위 작업. AI 고장확률 점수는 산출하지 않습니다.</span></div></section>
   <section className="card"><div className="card-heading"><div><h2>예비품 확보 검토</h2><p>실사 수량과 안전재고 기준을 모두 확인한 품목만 비교</p></div><button className="text-btn" onClick={onSpareParts}>예비품 목록 ↗</button></div>{belowSafety.length?<div className="executive-list">{belowSafety.slice(0,6).map(s=><div className="executive-row static" key={s.id}><span className="tag amber">기준 미달</span><span><b>{s.name} · {s.code||'코드 미기재'}</b><small>{s.equipment} · 실사 {s.confirmedQuantity} / 안전재고 {s.safety} · {s.supplier||'공급처 미기재'} · 리드타임 {s.leadTime||'미기재'}</small></span><span>검토</span></div>)}</div>:<p className="executive-empty">실사 수량·안전재고를 함께 확인한 기준 미달 품목이 없습니다.</p>}<p className="footnote">검토 대상은 발주 권고 수량이 아닙니다. 자재 출고·사용 이력이 없어 향후 소요량과 최적 구매량은 계산하지 않으며, 미실사 {stockUnknown.length}개 품목은 제외했습니다.</p></section>
   <section className="card"><div className="card-heading"><div><h2>정지시간 변화·개량 성과</h2><p>입력된 설비 정지 구간과 완료된 CM 전후 실측</p></div></div><div className="executive-stats"><div><span>이번 달 확인 정지시간</span><b>{fmt(downtimeThis)}분</b></div><div><span>전월 동일까지 확인 정지시간</span><b>{fmt(downtimePrevious)}분</b></div><div><span>CM 실측 완료</span><b>{cmMeasured.length}/{cmRows.length}건</b></div><div><span>CM 입력값상 단축 합계</span><b>{fmt(savedMinutes)}분</b></div></div><p className="footnote">정지시간은 실제 정지·재가동 시각을 모두 기록한 건만 집계합니다. 변화율은 이번 달과 전월 동일까지의 기간을 비교하며 전월 값이 0이거나 없으면 계산하지 않습니다. CM 단축은 입력된 비교값이며 생산성 향상·절감액 확정치가 아닙니다.</p></section>
   <section className="card"><div className="card-heading"><div><h2>병목·후속 조치 누락 후보</h2><p>미배정·미승인·일정 미등록 및 후속 작업 연결 확인</p></div><span className="tag amber">{bottlenecks.length+unaddressed.length}건</span></div><div className="executive-stats"><div><span>미배정 또는 일정 미등록</span><b>{active.filter(r=>!r.assignee.trim()||!r.planning?.plannedDate).length}건</b></div><div><span>승인 확인 필요</span><b>{active.filter(r=>r.planning?.approval!=='승인').length}건</b></div><div><span>불량 점검 후속 연결 확인</span><b>{unaddressed.length}건</b></div><div><span>다음 달 계획 일정</span><b>{nextEvents.length}건</b></div></div>{unaddressed.slice(0,4).map(r=><button className="executive-row" key={r.id} onClick={()=>onRecord(r.id)}><span className="tag red">후속 확인</span><span><b>{r.equipmentName} · {r.title}</b><small>불량 점검 기록 · 관련 작업 연결 여부 확인</small></span></button>)}<p className="footnote">기록의 누락 신호이며 실제 지연 원인을 자동 판정하지 않습니다. 대기 원인·협력사 대기·부품 대기 기록이 누적되면 병목 분류를 더 정확히 할 수 있습니다.</p></section>
   <section className="card executive-ai"><div className="card-heading"><div><h2>AI 고장확률·자재 사용량 예측</h2><p>예측 모델 적용 가능 상태</p></div><span className="tag amber">학습자료 부족</span></div><p>현재 확인 가능한 것은 일정·실사재고·확정된 작업 결과와 입력된 정지시간입니다. 장비별 운전시간, 충분한 고장 발생/정상 기간, 부품 출고·교체 수량 이력이 연결되지 않아 신뢰할 수 있는 고장확률(%)이나 다음 달 자재 소요량은 계산하지 않습니다.</p><ul><li>고장확률 예측: 고장·정상 이력과 운전시간 연결 후 검증</li><li>자재 사용 예측: 품목코드별 출고·교체 수량과 작업 연결 필요</li><li>AI 위험 판단: 입력 근거를 축적한 뒤 규칙 결과와 과거 실제를 비교 검증</li></ul><p className="footnote">현재 화면의 ‘높음’은 설명 가능한 업무 우선순위 규칙이며 AI 진단·고장확률이 아닙니다.</p></section>
  </div>
 </div>;
}

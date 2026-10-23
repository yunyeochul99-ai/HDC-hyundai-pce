import {useState} from 'react';
import type {ManagedPlan} from './preventive-plans';
import {readStatutoryDetails,sortStatutoryPlans,statutoryTiming,validStatutoryDate} from './statutory-plans';

const approvalLabels={original:'원본 기준자료',pending:'승인 대기',approved:'승인 완료',rejected:'반려',archived:'삭제됨'};
export default function StatutorySchedule({plans,onOpen,onEdit,onRequest,busy=false}:{busy?:boolean;onRequest:(plan:ManagedPlan)=>void;plans:ManagedPlan[];onOpen:(plan:ManagedPlan)=>void;onEdit?:(plan:ManagedPlan)=>void}) {
  const [view,setView]=useState<'upcoming'|'completed'>('upcoming');
  const completed=view==='completed';
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  const active=plans.filter(plan=>plan.catalogState!=='archived');
  const summaries=active.map(plan=>readStatutoryDetails(plan.evidence));
  const completedCount=summaries.filter(d=>validStatutoryDate(d.lastDate)&&d.lastDate<=today).length;
  const upcomingCount=summaries.filter(d=>validStatutoryDate(d.nextDate)&&d.nextDate>=today).length;
  const missingCount=summaries.filter(d=>!validStatutoryDate(d.lastDate)||!validStatutoryDate(d.nextDate)).length;
  const overdueCount=summaries.filter(d=>validStatutoryDate(d.nextDate)&&d.nextDate<today).length;
  const rows=sortStatutoryPlans(active,completed?'lastDate':'nextDate',completed).map(plan=>{
    const details=readStatutoryDetails(plan.evidence);
    return {plan,details,timing:statutoryTiming(details.nextDate,today),date:completed?details.lastDate:details.nextDate};
  });
  const months=new Map<string,typeof rows>();
  for(const row of rows){const key=validStatutoryDate(row.date)?row.date.slice(0,7):'미등록';months.set(key,[...(months.get(key)||[]),row]);}
  return <section className="card statutory-schedule" aria-labelledby="statutory-schedule-title">
    <div className="section-title"><h2 id="statutory-schedule-title">검사 완료 및 다가올 일정</h2><span>기준일 {today}</span></div>
    <p className="section-note">검사 완료일은 관리대장의 ‘최근검사일’, 다가올 일정은 ‘다음검사일’ 기준입니다. 공장장은 각 행의 ‘최종 수정’에서 날짜·주기·기기 정보를 고칠 수 있습니다. 수정 후 검토·승인을 진행하세요.</p>
    <div className="statutory-counts">
      <div><span>전체 검사대상</span><b>{active.length}<small>건</small></b></div>
      <div><span>최근 검사 완료일 등록</span><b>{completedCount}<small>건</small></b></div>
      <div><span>앞으로 다가올 검사</span><b>{upcomingCount}<small>건</small></b></div>
      <div><span>검사일 미등록·확인 필요</span><b>{missingCount}<small>건</small></b></div>
    </div>
    {overdueCount>0&&<p className="data-note">다음검사일이 지난 계획 {overdueCount}건이 있습니다. 완료일과 다음검사일을 확인·수정하세요.</p>}
    <div className="filter-tabs statutory-view-tabs" role="group" aria-label="검사 일정 구분">
      <button type="button" aria-pressed={!completed} className={!completed?'selected':''} onClick={()=>setView('upcoming')}>다가올 검사 일정 <span>{upcomingCount}건</span></button>
      <button type="button" aria-pressed={completed} className={completed?'selected':''} onClick={()=>setView('completed')}>최근 검사 완료 일정 <span>{completedCount}건</span></button>
    </div>
    <p className="footnote">{completed?'최근 검사 완료일이 최신인 순서입니다. 관리대장은 기기별 최근 검사 1회만 수록하며, 전체 과거 검사 이력은 아닙니다.':'목록의 행이나 계획 접수 버튼을 누르면 해당 검사 계획을 접수합니다. 승인 대기 계획은 공장장 승인 후 접수 화면으로 이어집니다.'} 삭제된 계획은 제외하며, 아래 검색·승인 필터와 관계없이 전체 일정을 표시합니다.</p>
    {rows.length>0?<>
      <ul className="statutory-months" aria-label={completed?'완료월별 검사 건수':'월별 검사 계획 건수'}>{[...months].map(([month,items])=><li key={month}><span>{month==='미등록'?'날짜 미등록':`${month.slice(0,4)}년 ${Number(month.slice(5))}월`}</span><b>{items.length}건</b></li>)}</ul>
      <div className="table-wrap"><table className="statutory-schedule-table"><caption>{completed?'관리대장 최근 검사 완료 일정':'앞으로 다가올 검사 일정'} · 전체 {rows.length}건</caption><thead><tr><th scope="col">{completed?'검사 완료일':'다음검사일'}</th><th scope="col">{completed?'완료일 등록':'남은 시기'}</th><th scope="col">구분</th><th scope="col">대상기기</th><th scope="col">검사주기</th><th scope="col">{completed?'다음검사일':'최근 검사 완료일'}</th><th scope="col">검사기관</th><th scope="col">최종 검토</th><th scope="col">확인·수정</th></tr></thead>
        {[...months].map(([month,items])=><tbody key={month}><tr className="statutory-month-heading"><th colSpan={9} scope="rowgroup">{month==='미등록'?'검사일 미등록 · 날짜 확인 필요':`${month.slice(0,4)}년 ${Number(month.slice(5))}월 ${completed?'최근 검사':'검사 예정'}`} · {items.length}건</th></tr>{items.map(({plan,details,timing,date})=><tr key={plan.id} className={!completed?'statutory-request-row':undefined} tabIndex={!completed&&!busy?0:undefined} aria-label={!completed?`${plan.title} 계획 접수`:undefined} onClick={()=>{if(!completed&&!busy)onRequest(plan);}} onKeyDown={event=>{if(event.target===event.currentTarget&&!completed&&!busy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onRequest(plan);}}}>
          <td><b>{validStatutoryDate(date)?date:'미등록'}</b>{date&&!validStatutoryDate(date)&&<small>입력값 확인: {date}</small>}</td>
          <td>{completed?<span className={`tag ${validStatutoryDate(date)&&date<=today?'green':'amber'}`}>{!validStatutoryDate(date)?'확인 필요':date>today?'미래 날짜 · 확인 필요':'대장상 완료'}</span>:<span className={`tag ${timing.tone}`}>{timing.label}</span>}</td><td>{details.group||'미등록'}</td>
          <td><b>{plan.title}</b>{plan.equipmentName!==plan.title&&<small>{plan.equipmentName}</small>}{plan.dataNote&&<small className="statutory-review-note">{plan.dataNote}</small>}</td><td>{plan.cycle||'미등록'}</td><td>{(completed?details.nextDate:details.lastDate)||'미등록'}</td><td>{details.agency||'미등록'}</td><td>{approvalLabels[plan.catalogState]}</td>
          <td onClick={event=>event.stopPropagation()}><div className="pm-buttons">{!completed&&<button type="button" className="primary" disabled={busy} aria-label={`${plan.title} 계획 접수`} onClick={()=>onRequest(plan)}>계획 접수</button>}<button type="button" className="text-btn" disabled={busy} aria-label={`${plan.title} 계획 상세`} onClick={()=>onOpen(plan)}>상세 보기</button>{onEdit&&<button type="button" className="secondary" disabled={busy} aria-label={`${plan.title} 최종 수정`} onClick={()=>onEdit(plan)}>최종 수정</button>}</div></td>
        </tr>)}</tbody>)}
      </table></div>
    </>:<p className="empty">등록된 법정 검사 계획이 없습니다. 계획을 등록하면 완료일과 다음검사일을 표시합니다.</p>}
  </section>;
}

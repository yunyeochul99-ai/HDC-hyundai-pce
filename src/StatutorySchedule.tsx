import type {ManagedPlan} from './preventive-plans';
import {readStatutoryDetails,sortStatutoryPlans,statutoryTiming,validStatutoryDate} from './statutory-plans';

const approvalLabels={original:'원본 기준자료',pending:'승인 대기',approved:'승인 완료',rejected:'반려',archived:'삭제됨'};
export default function StatutorySchedule({plans,onOpen}:{plans:ManagedPlan[];onOpen:(plan:ManagedPlan)=>void}) {
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  const rows=sortStatutoryPlans(plans.filter(plan=>plan.catalogState!=='archived')).map(plan=>{
    const details=readStatutoryDetails(plan.evidence);
    return {plan,details,timing:statutoryTiming(details.nextDate,today)};
  });
  const months=new Map<string,typeof rows>();
  for(const row of rows){const key=validStatutoryDate(row.details.nextDate)?row.details.nextDate.slice(0,7):'미등록';months.set(key,[...(months.get(key)||[]),row]);}
  return <section className="card statutory-schedule" aria-labelledby="statutory-schedule-title">
    <div className="section-title"><h2 id="statutory-schedule-title">전체 법정 검사 일정</h2><span>기준일 {today}</span></div>
    <p className="section-note">다음검사일이 빠른 순서입니다. 삭제된 계획은 제외하며 승인 대기·반려 계획도 함께 표시합니다. 아래 검색·승인 필터와 관계없이 전체 일정을 표시합니다.</p>
    <div className="statutory-counts">
      <div><span>전체 계획</span><b>{rows.length}<small>건</small></b></div>
      <div><span>등록 검사일 경과</span><b>{rows.filter(row=>row.timing.days!==null&&row.timing.days<0).length}<small>건</small></b></div>
      <div><span>오늘부터 30일 이내</span><b>{rows.filter(row=>row.timing.days!==null&&row.timing.days>=0&&row.timing.days<=30).length}<small>건</small></b></div>
      <div><span>날짜 미등록·확인 필요</span><b>{rows.filter(row=>row.timing.days===null).length}<small>건</small></b></div>
    </div>
    {rows.length>0?<>
      <ul className="statutory-months" aria-label="월별 검사 계획 건수">{[...months].map(([month,items])=><li key={month}><span>{month==='미등록'?'날짜 미등록':`${month.slice(0,4)}년 ${Number(month.slice(5))}월`}</span><b>{items.length}건</b></li>)}</ul>
      <div className="table-wrap"><table className="statutory-schedule-table"><caption>검사 시기별 전체 계획 목록</caption><thead><tr><th scope="col">다음검사일</th><th scope="col">남은 시기</th><th scope="col">구분</th><th scope="col">대상기기 / 연결 설비</th><th scope="col">검사주기</th><th scope="col">최근검사일</th><th scope="col">검사기관</th><th scope="col">승인 상태</th><th scope="col">상세</th></tr></thead>
        {[...months].map(([month,items])=><tbody key={month}><tr className="statutory-month-heading"><th colSpan={9} scope="rowgroup">{month==='미등록'?'검사일 미등록 · 날짜 확인 필요':`${month.slice(0,4)}년 ${Number(month.slice(5))}월 검사`} · {items.length}건</th></tr>{items.map(({plan,details,timing})=><tr key={plan.id}>
          <td><b>{validStatutoryDate(details.nextDate)?details.nextDate:'미등록'}</b>{details.nextDate&&!validStatutoryDate(details.nextDate)&&<small>입력값 확인: {details.nextDate}</small>}</td>
          <td><span className={`tag ${timing.tone}`}>{timing.label}</span></td><td>{details.group||'미등록'}</td>
          <td><b>{plan.title}</b><small>{plan.equipmentName}</small></td><td>{plan.cycle||'미등록'}</td><td>{details.lastDate||'미등록'}</td><td>{details.agency||'미등록'}</td><td>{approvalLabels[plan.catalogState]}</td>
          <td><button type="button" className="text-btn" aria-label={`${plan.title} 계획 상세`} onClick={()=>onOpen(plan)}>상세 보기</button></td>
        </tr>)}</tbody>)}
      </table></div>
    </>:<p className="empty">등록된 법정 검사 계획이 없습니다. 계획을 등록하면 월별 건수와 검사일 순서로 표시됩니다.</p>}
  </section>;
}

import {Clock3,CalendarDays,ShieldCheck,TriangleAlert,Wrench,ArrowRight} from 'lucide-react';
import {assessPlan,defaultPlan,normalizePlan,type MaintenancePolicy,type WorkPlan} from './maintenance';
import './work-planning.css';
export type PlanningRecord={id:string;type:string;title:string;equipmentName:string;status:string;assignee:string;date:string;planning?:WorkPlan};
const money=(v:number|null)=>v===null?'비용 미입력':`${new Intl.NumberFormat('ko-KR').format(v)}원`;
const categories:WorkPlan['category'][]=['예방보전','상태기반','고장수리','개선보전','유휴설비관리'];

export function PlanFields({value,onChange,isAdmin,policy,status='접수'}:{value:WorkPlan;onChange:(p:WorkPlan)=>void;isAdmin:boolean;policy:MaintenancePolicy;status?:string}){
 const p=normalizePlan(value),a=assessPlan(p,policy,status);
 const change=(key:keyof WorkPlan,value:unknown)=>{
  const next={...p,[key]:value};
  if(!isAdmin&&['category','plannedDate','window','estimatedMinutes','estimatedCost','qualityImpact','productionImpact','idleEquipment'].includes(key)&&p.approval==='승인')next.approval='미검토';
  onChange(next as WorkPlan);
 };
 const num=(key:'estimatedMinutes'|'estimatedCost'|'actualMinutes'|'actualCost',label:string,unit:string)=><label>{label}<small>{unit} · 미입력과 0을 구분합니다</small><input type="number" min="0" step="1" inputMode="numeric" value={p[key]??''} onChange={e=>change(key,e.target.value===''?null:Number(e.target.value))}/></label>;
 return <section className="work-planning-fields" aria-label="보전 작업 계획"><div className="planning-section-head"><h3><CalendarDays size={17}/>보전 작업 계획</h3><span className="tag blue">평일 계획 · 주말 작업 제외</span></div><p className="planning-help">08:00~09:30은 준비·안전 확보·수리·복구 시험·생산 인계를 모두 마칠 수 있는 작업에 사용합니다. 미계획은 접수·보류 상태로 먼저 저장할 수 있습니다.</p>
  <div className="form-grid"><label>보전 구분<select value={p.category} onChange={e=>{const category=e.target.value as WorkPlan['category'];onChange({...p,category,idleEquipment:category==='유휴설비관리'||p.idleEquipment,approval:!isAdmin&&p.approval==='승인'?'미검토':p.approval})}}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>작업 예정일<input type="date" value={p.plannedDate} onChange={e=>change('plannedDate',e.target.value)}/></label><label>작업 시간대<select value={p.window} onChange={e=>change('window',e.target.value)}><option value="unplanned">미계획 · 협의 전</option><option value="morning">평일 08:00~09:30</option><option value="weekday">별도 평일 정지계획</option></select></label>{num('estimatedMinutes','예상 전체 소요시간','분')}{num('estimatedCost','예상 보전비','원')}{num('actualMinutes','실제 소요시간','분')}{num('actualCost','실제 보전비','원')}</div>
  <div className="planning-checks">{([['qualityImpact','제품 품질에 영향'],['productionImpact','생산·설비 가용성에 영향'],['idleEquipment','유휴설비 보존·비용 최소화 작업']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={p[key]} onChange={e=>change(key,e.target.checked)}/>{label}</label>)}</div>
  <div className="planning-review"><div><b>특별관리 검토</b><p>장기 90분 초과 · 고액 {policy.highCostThreshold===null?'기준 미설정':`${money(policy.highCostThreshold)} 이상`}</p></div><label>검토 상태<select value={p.approval} onChange={e=>change('approval',e.target.value)}><option>미검토</option><option>검토요청</option><option disabled={!isAdmin}>승인</option><option disabled={!isAdmin}>반려</option></select></label></div>
  <label className="planning-note">검토·승인 근거<textarea value={p.approvalNote} maxLength={2000} disabled={!isAdmin&&['승인','반려'].includes(p.approval)} onChange={e=>change('approvalNote',e.target.value)} placeholder="작업 분할, 생산 협의, 견적·수리/교체 비교, 필요한 부품과 외주 검토"/></label><p className="planning-help">승인·반려는 관리자만 저장할 수 있습니다. 승인 후 계획이 변경되면 재검토하며, 작업 승인은 현장 작업허가를 대신하지 않습니다.</p>
  <div className="planning-section-head"><h3><ShieldCheck size={17}/>실행·복구 확인</h3></div><div className="planning-checks">{([['safetyChecked','작업 전 현장 안전절차 확인'],['functionChecked','복구 후 기능 시험 확인'],['qualityChecked','제품 품질 요구사항 확인'],['productionHandedOver','생산 담당자 인계 확인']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={p[key]} onChange={e=>change(key,e.target.checked)}/>{label}</label>)}</div><p className="planning-help">완료 처리에는 위 확인과 실제 시간·비용 입력이 필요합니다. 비용이 없으면 0원을 명시합니다.</p>
  {a.warnings.length>0&&<ul className="planning-warnings">{a.warnings.map(w=><li key={w}><TriangleAlert size={14}/>{w}</li>)}</ul>}{a.errors.length>0&&<div className="planning-errors" role="status"><b>저장 전 확인</b><ul>{a.errors.map(e=><li key={e}>{e}</li>)}</ul></div>}
 </section>;
}

export function PlanSummary({plan,policy}:{plan?:WorkPlan;policy:MaintenancePolicy}){
 if(!plan)return <p className="planning-help">이전 기록 · 작업 시간·비용·승인 계획 미입력. 수정 시 새 보전 기준을 확인하세요.</p>;
 const p=normalizePlan(plan),a=assessPlan(p,policy);
 return <section className="plan-readonly"><div className="detail-tags"><span className="tag blue">{p.category}</span>{a.longWork&&<span className="tag amber">장기 작업</span>}{a.highCost&&<span className="tag red">고액 특별관리</span>}{p.qualityImpact&&<span className="tag amber">품질 영향</span>}{p.idleEquipment&&<span className="tag">유휴설비 관리</span>}<span className={`tag ${p.approval==='승인'?'green':'amber'}`}>{p.approval}</span></div><dl><dt>계획일 / 시간대</dt><dd>{p.plannedDate||'미계획'} · {p.window==='morning'?'08:00~09:30':p.window==='weekday'?'별도 평일 정지':'시간대 미정'}</dd><dt>예상 / 실제 시간</dt><dd>{p.estimatedMinutes===null?'미입력':`${p.estimatedMinutes}분`} / {p.actualMinutes===null?'미입력':`${p.actualMinutes}분`}</dd><dt>예상 / 실제 비용</dt><dd>{money(p.estimatedCost)} / {money(p.actualCost)}</dd><dt>검토 근거</dt><dd className="pre-line">{p.approvalNote||'미입력'}</dd></dl></section>;
}

export function PlanningBoard({records,policy,onOpen}:{records:PlanningRecord[];policy:MaintenancePolicy;onOpen:(r:PlanningRecord)=>void}){
 const active=records.filter(r=>r.type==='workorder'&&r.status!=='완료');
 const loads:Record<string,number>={};active.filter(r=>r.planning?.window==='morning'&&r.planning.plannedDate).forEach(r=>{const key=`${r.planning!.plannedDate} · ${r.assignee||'담당 미정'}`;loads[key]=(loads[key]||0)+(r.planning!.estimatedMinutes??0)});
 const overloaded=Object.entries(loads).filter(([,minutes])=>minutes>90);
 const groups=[
  {name:'08:00~09:30 작업',icon:Clock3,description:'평일 90분 내 복구 · 계획된 작업',filter:(r:PlanningRecord)=>!!r.planning&&r.planning.window==='morning'&&assessPlan(r.planning,policy).morningEligible},
  {name:'장기·별도 평일 정지',icon:CalendarDays,description:'90분 초과 · 분할 및 생산 협의',filter:(r:PlanningRecord)=>!!r.planning&&(assessPlan(r.planning,policy).longWork||r.planning.window==='weekday')},
  {name:'특별관리·검토',icon:ShieldCheck,description:'장기·고액·품질·생산 영향 확인',filter:(r:PlanningRecord)=>!!r.planning&&(assessPlan(r.planning,policy).special||r.planning.qualityImpact||r.planning.productionImpact||r.planning.approval==='검토요청')},
  {name:'계획 수립 필요',icon:TriangleAlert,description:'시간·예산·평일 계획을 먼저 확인',filter:(r:PlanningRecord)=>!r.planning||!r.planning.plannedDate||r.planning.window==='unplanned'||r.planning.estimatedMinutes===null||r.planning.estimatedCost===null},
  {name:'유휴설비 관리',icon:Wrench,description:'안전·보존 중심 최소 비용 관리',filter:(r:PlanningRecord)=>!!r.planning&&(r.planning.idleEquipment||r.planning.category==='유휴설비관리')},
 ];
 return <section className="planning-board"><div className="section-title"><div><h2>보전 목적에 따른 작업계획</h2><p>미완료 작업을 분류합니다. 하나의 작업이 여러 업무함에 표시될 수 있습니다.</p></div></div>{overloaded.length>0&&<div className="planning-errors"><b>아침 작업의 담당자별 합계 시간 확인</b>{overloaded.map(([key,minutes])=><p key={key}>{key} · {minutes}분 / 90분</p>)}<p>동일 담당자의 계획 시간을 합산했습니다. 인력 배분·동시 작업 여부와 별도 평일 계획을 확인하세요.</p></div>}<div className="planning-columns">{groups.map(g=>{const list=active.filter(g.filter);return <section className="planning-lane" key={g.name}><header><g.icon size={18}/><h3>{g.name}</h3><span className="number-pill">{list.length}</span></header><p>{g.description}</p>{list.length?list.map(r=><button className="planning-task" key={r.id} onClick={()=>onOpen(r)}><b>{r.equipmentName}</b><span>{r.title}</span><small>{r.planning?.plannedDate||'계획일 미정'} · {r.assignee||'담당 미정'}</small><div><span className="tag">{r.status}</span><span className="tag">{r.planning?.approval||'미계획'}</span><ArrowRight size={13}/></div></button>):<div className="planning-lane-empty">해당 작업 없음</div>}</section>})}</div></section>;
}

export function MaintenanceSummary({records,policy,onOrders,onProcedure}:{records:PlanningRecord[];policy:MaintenancePolicy;onOrders:()=>void;onProcedure:()=>void}){
 const ops=records.filter(r=>r.type==='workorder'),active=ops.filter(r=>r.status!=='완료');
 const morning=active.filter(r=>r.planning?.window==='morning'&&assessPlan(r.planning,policy).morningEligible);
 const special=active.filter(r=>r.planning&&assessPlan(r.planning,policy).special&&r.planning.approval!=='승인');
 const long=active.filter(r=>r.planning&&assessPlan(r.planning,policy).longWork);
 const risk=active.filter(r=>r.planning?.qualityImpact||r.planning?.productionImpact);
 const monthly=ops.filter(r=>r.date.slice(0,7)===policy.costPeriod),known=monthly.filter(r=>r.planning?.actualCost!=null);
 const spend=known.reduce((sum,r)=>sum+(r.planning?.actualCost??0),0),missing=monthly.length-known.length;
 const ratio=policy.manufacturingCost&&known.length?`${(spend/policy.manufacturingCost*100).toFixed(2)}%`:'집계 기준 확인';
 return <><div className="maintenance-purpose"><div><span className="eyebrow">목적 → 정책 → 계획 → 실행 → 검증</span><h2>필요한 설비를 정상으로, 보전비는 합리적으로</h2><p>평일 08:00~09:30 활용 · 주말 계획 작업 제외 · 고액 기준 {policy.highCostThreshold===null?'미설정':money(policy.highCostThreshold)+' 이상'}</p></div><button className="secondary" onClick={onProcedure}>설비보전 절차서 ↗</button></div><div className="maintenance-metrics">{[['08:00~09:30 계획',morning.length,'90분 내 복구 예정'],['특별관리 승인 대기',special.length,'장기·고액 작업'],['90분 초과 작업',long.length,'별도 평일 정지 검토'],['품질·생산 영향',risk.length,'확인·복구 시험 필요']].map(([label,value,note])=><button key={String(label)} onClick={onOrders}><span>{label}</span><b>{value}<small>건</small></b><p>{note}</p></button>)}</div><section className="maintenance-cost"><div><span>{policy.costPeriod} 실제 보전비 / 제조원가</span><b>{ratio}</b></div><p>{known.length?`${money(spend)} · 실제비용 입력 ${known.length}건`:'해당 월 실제비용 입력 전'} · 미입력 {missing}건{missing>0?' · 부분 집계':''}<br/>작업 기록 일자 기준이며, 과거 ERP 수선비 원장과 합산하지 않습니다.</p></section></>;
}

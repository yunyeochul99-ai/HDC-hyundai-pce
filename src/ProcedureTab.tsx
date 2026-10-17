import {useEffect,useState} from 'react';
import {ArrowRight,BookOpen,CalendarDays,Check,CheckCircle2,ClipboardCheck,Clock3,Coins,Factory,FileCheck2,LockKeyhole,Settings2,ShieldCheck,TriangleAlert,Users,Wrench} from 'lucide-react';
import type {MaintenancePolicy} from './maintenance';
import './procedure.css';

type Props={policy:MaintenancePolicy;isAdmin:boolean;onPolicySave:(next:MaintenancePolicy)=>Promise<void>;onCreateWork:()=>void;onOpenInspection:()=>void};
const money=(value:number)=>`${new Intl.NumberFormat('ko-KR').format(value)}원`;
const objectives=[
 {icon:ShieldCheck,title:'안전과 제품 품질',text:'현장 안전 절차를 준수하고, 설비 복구 후 제품의 품질 요구사항을 확인합니다.',measure:'품질 영향·복구 시험·인계 확인'},
 {icon:Factory,title:'필요한 설비의 정상 가용',text:'생산에 필요한 설비가 사용 가능한 정상 상태를 유지하도록 이상을 조기에 발견하고 조치합니다.',measure:'고장·정지 시간·조치 이력'},
 {icon:Coins,title:'제조원가 중 보전비 절감',text:'예방과 계획 정비로 재고장과 불필요한 지출을 줄이고, 수리·교체의 경제성을 검토합니다.',measure:'월별 실제 보전비 / 같은 월 제조원가'},
 {icon:Wrench,title:'생산에 충분한 설비 제공',text:'생산 일정과 필요한 설비를 확인해 점검·보수를 계획하고, 생산 차질을 줄입니다.',measure:'생산 요구·정비 계획·완료 기한'},
 {icon:LockKeyhole,title:'유휴 설비의 최소 유지비',text:'가동·유휴·폐기 검토 상태를 구분하고, 유휴 설비에는 필요한 보존 정비만 시행합니다.',measure:'설비 상태·보존 정비·재가동 승인'},
 {icon:Users,title:'숙련된 관리와 표준 작업',text:'담당과 승인 책임을 명확히 하고, 작업 기록과 재발 방지 내용을 다음 정비에 반영합니다.',measure:'담당 지정·표준 작업·재발 개선'},
];
const workflow=[
 ['발견·요청','점검 이상 또는 생산 요청을 접수하고 설비와 현상을 기록합니다.'],
 ['영향·우선순위 분류','안전·품질·생산 영향, 긴급도, 설비 상태를 확인합니다.'],
 ['평일 작업 계획','작업 범위·예상 시간·비용·부품·담당과 생산 정지 시간을 정합니다.'],
 ['특별관리·사전 승인','장시간·고액 작업은 관리자 사전 승인을 받고, 품질 영향은 품질 담당자와 검증 기준을 확인합니다.'],
 ['안전 확보·실행','현장 안전 절차에 따른 에너지 차단·잔류 에너지 확인 후 승인 범위의 작업을 진행합니다.'],
 ['복구 검증·생산 인계','기능 시험과 품질 요구사항을 확인하고 생산 담당자에게 인계합니다.'],
 ['실적·재발 개선','실제 비용·소요 시간·원인·조치를 기록하고 다음 점검과 계획을 개선합니다.'],
];
const responsibilities=[
 ['보전 담당','이상 접수, 작업 계획·시간·비용 추정, 안전 절차 준수, 수리 및 실적 기록','복구 시험과 재발 방지 근거'],
 ['생산 담당','생산 요구와 정지 가능 시간 협의, 필요한 설비 확보, 복구 후 인수 확인','생산 인계와 사용 가능 상태'],
 ['품질 담당','품질 영향 판단, 필요한 검증 항목과 제품 품질 요구사항 확인','품질 영향 작업의 검증 결과'],
 ['관리자','보전 정책·금액 기준 설정, 장시간·고액 계획 검토, 특별관리 승인','승인 근거와 비용·성과 검토'],
];

export default function ProcedureTab({policy,isAdmin,onPolicySave,onCreateWork,onOpenInspection}:Props){
 const [threshold,setThreshold]=useState(policy.highCostThreshold===null?'':String(policy.highCostThreshold));
 const [manufacturing,setManufacturing]=useState(policy.manufacturingCost===null?'':String(policy.manufacturingCost));
 const [period,setPeriod]=useState(policy.costPeriod);
 const [saving,setSaving]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{setThreshold(policy.highCostThreshold===null?'':String(policy.highCostThreshold));setManufacturing(policy.manufacturingCost===null?'':String(policy.manufacturingCost));setPeriod(policy.costPeriod);},[policy]);
 async function savePolicy(event:React.FormEvent){
  event.preventDefault();if(saving||!isAdmin)return;
  setMessage('');setFailed(false);
  const parse=(value:string,label:string)=>{if(!value.trim())return null;const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||n<=0)throw Error(`${label}은 1원 이상의 정수로 입력하세요.`);return n;};
  try{
   const nextThreshold=parse(threshold,'고액 특별관리 기준'),nextManufacturing=parse(manufacturing,'제조원가');
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('제조원가의 기준 월을 선택하세요.');
   setSaving(true);await onPolicySave({...policy,highCostThreshold:nextThreshold,manufacturingCost:nextManufacturing,costPeriod:period});
   setMessage('보전 관리 기준을 저장했습니다. 승인된 공장 구성원에게 같은 기준이 적용됩니다.');
  }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'관리 기준을 저장하지 못했습니다. 다시 확인하세요.');}
  finally{setSaving(false);}
 }
 return <div className="procedure-tab">
  <section className="card procedure-cover" aria-labelledby="procedure-title">
   <div className="procedure-cover-main"><span className="procedure-kicker"><BookOpen size={15}/> HDC PCE · 설비보전 운영 기준</span><h2 id="procedure-title">목적을 먼저 정하고,<br/>그 목적에 맞게 정비합니다.</h2><p>생산과 품질에 필요한 설비를 유지하면서, 정지 시간과 유지보수 비용을 줄이는 보전 부서의 운영 초안입니다.</p><div className="procedure-document-meta"><span className="tag green">운영 초안 v{policy.policyVersion}</span><span>적용 대상 · 생산 설비와 유휴 설비</span><span>추가 세부 기준 · 관리자 검토 필요</span></div></div>
   <aside className="procedure-window"><div className="procedure-window-icon"><Clock3 size={22}/></div><span>평일 비가동 시간 우선 활용</span><strong>08:00 <i>—</i> 09:30</strong><p>준비부터 생산 인계까지<br/><b>90분 안에 완료 가능한 작업</b>을 우선 배정합니다.</p><div><CalendarDays size={14}/> 주말 계획 작업은 배정하지 않습니다</div></aside>
  </section>

  <div className="procedure-section-head"><div><span className="procedure-step-label">01 · 보전 목적</span><h2>보전 부서가 지켜야 할 여섯 가지 목적</h2></div><span className="procedure-caption">안전·품질을 전제로 시간과 비용을 관리</span></div>
  <div className="procedure-objectives">{objectives.map(({icon:ObjectiveIcon,title,text,measure},index)=><section className="card procedure-objective" key={title}><div className="procedure-objective-top"><span><ObjectiveIcon size={20}/></span><b>0{index+1}</b></div><h3>{title}</h3><p>{text}</p><small><Check size={12}/>{measure}</small></section>)}</div>

  <div className="procedure-section-head"><div><span className="procedure-step-label">02 · 부서 정책</span><h2>작업 요청을 계획으로 바꾸는 판단 기준</h2></div></div>
  <section className="card procedure-policy-card" aria-label="보전 부서 정책">
   <div className="procedure-rule"><span className="procedure-rule-icon green"><Clock3 size={19}/></span><div><h3>90분 안에 끝낼 수 있는 작업을 우선</h3><p>준비·안전 격리·수리·복구·기능 및 품질 검증·생산 인계까지 필요한 전체 시간을 기준으로 판단합니다. 수리 시간만으로 90분 작업 여부를 정하지 않습니다.</p></div><span className="tag green">평일 08:00–09:30</span></div>
   <div className="procedure-rule"><span className="procedure-rule-icon amber"><CalendarDays size={19}/></span><div><h3>장시간 작업은 별도의 평일 정지 계획</h3><p>90분 초과 작업은 작업 분할 가능성과 별도 평일 생산 정지 계획을 검토하고 관리자의 사전 승인을 받습니다. 주말 계획 작업은 배정하지 않습니다.</p></div><span className="tag amber">특별관리</span></div>
   <div className="procedure-rule"><span className="procedure-rule-icon amber"><Coins size={19}/></span><div><h3>고액 작업은 예산과 수리·교체 경제성 검토</h3><p>예상·실제 비용을 관리하고, 고액 작업은 견적·예산·수리 또는 교체 근거를 검토한 뒤 승인합니다. {policy.highCostThreshold===null?'고액 기준이 아직 없어 금액 판단은 관리자 검토가 필요합니다.':`현재 고액 특별관리 기준은 ${money(policy.highCostThreshold)} 이상입니다.`}</p></div><span className={`tag ${policy.highCostThreshold===null?'amber':'blue'}`}>{policy.highCostThreshold===null?'기준 미설정':`${money(policy.highCostThreshold)} 이상`}</span></div>
   <div className="procedure-rule"><span className="procedure-rule-icon blue"><ShieldCheck size={19}/></span><div><h3>안전·품질·생산 영향은 작업 전 확인</h3><p>고장이나 품질 영향이 예상되면 우선순위와 검증 계획을 먼저 정합니다. 현장 안전 절차를 따르고, 복구 시험과 필요한 품질 확인 후 생산에 인계합니다.</p></div><span className="tag blue">영향 사전 관리</span></div>
   <div className="procedure-rule"><span className="procedure-rule-icon"><LockKeyhole size={19}/></span><div><h3>유휴 설비는 필요한 보존 정비만</h3><p>가동·유휴·폐기 검토 상태를 구분해 불필요한 정비 지출을 줄입니다. 유휴 설비는 보존에 필요한 정비를 실시하고, 승인 없이 재가동하지 않습니다.</p></div><span className="tag">상태별 관리</span></div>
   <div className="procedure-rule"><span className="procedure-rule-icon green"><FileCheck2 size={19}/></span><div><h3>실적을 남기고 다음 계획을 개선</h3><p>실제 비용·시간과 원인·조치를 기록하고 재발 방지에 반영합니다. 제조원가 대비 유지보수비는 같은 월의 실제 비용과 제조원가가 준비된 경우에만 판단합니다.</p></div><span className="tag green">비용·시간 개선</span></div>
  </section>

  <div className="procedure-section-head"><div><span className="procedure-step-label">03 · 표준 업무 흐름</span><h2>요청에서 생산 인계와 개선까지</h2></div><div className="button-row"><button className="secondary" onClick={onOpenInspection}><ClipboardCheck size={15}/>점검·이상 발견</button><button className="primary" onClick={onCreateWork}><Wrench size={15}/>정비 요청 등록</button></div></div>
  <section className="card procedure-flow-card"><ol className="procedure-flow">{workflow.map(([title,description],index)=><li key={title}><span className="procedure-flow-number">{index+1}</span><div><h3>{title}</h3><p>{description}</p></div>{index<workflow.length-1&&<ArrowRight size={15} className="procedure-flow-arrow"/>}</li>)}</ol><div className="procedure-note"><TriangleAlert size={16}/><p>점검 양식과 예방정비 계획은 <b>기준 템플릿</b>입니다. 실제 수행 결과를 저장한 기록만 운영 실적으로 관리합니다. 현장별 안전 정비 방법과 세부 품질 기준은 해당 현장의 승인된 절차를 따릅니다.</p></div></section>

  <div className="procedure-bottom-grid">
   <section className="card procedure-responsibility"><div className="card-heading"><div><h2>역할과 확인 책임</h2><p>실행·인계·검증·승인을 구분합니다.</p></div><Users size={19}/></div><div className="table-wrap"><table><thead><tr><th>역할</th><th>주요 책임</th><th>확인 근거</th></tr></thead><tbody>{responsibilities.map(([role,duties,evidence])=><tr key={role}><td><b>{role}</b></td><td>{duties}</td><td>{evidence}</td></tr>)}</tbody></table></div></section>
   <section className="card procedure-measures"><div className="card-heading"><div><h2>성과를 판단하기 전 확인</h2><p>자료가 준비되기 전에는 달성률을 표시하지 않습니다.</p></div><CheckCircle2 size={19}/></div><dl><div><dt>비용 절감</dt><dd>동일 월 비용·제조원가와 비교 기준 필요</dd></div><div><dt>설비 가용</dt><dd>계획 가동 시간과 실제 정지 시간 필요</dd></div><div><dt>품질 충족</dt><dd>품질 영향과 복구 검증 결과 필요</dd></div><div><dt>작업 숙련도</dt><dd>표준 준수·재작업·재발 기록 필요</dd></div></dl><p className="procedure-measure-status">목표 수치와 평가 기준은 추가 수립이 필요합니다.</p></section>
  </div>

  <section className="card procedure-settings" aria-labelledby="procedure-settings-title"><div className="card-heading"><div><h2 id="procedure-settings-title">금액 기준과 제조원가 설정</h2><p>관리자가 설정한 공통 기준을 폰과 PC에서 함께 사용합니다.</p></div><Settings2 size={19}/></div>
   {isAdmin?<form onSubmit={savePolicy}><div className="procedure-settings-grid"><label>고액 특별관리 기준 <span>원 · 이 금액 이상부터 검토</span><input type="number" min="1" step="1" inputMode="numeric" value={threshold} onChange={e=>setThreshold(e.target.value)} placeholder="미설정" disabled={saving}/><small>비워 두면 기준 미설정으로 표시합니다.</small></label><label>제조원가 기준 월 <span>월별 실제 보전비와 같은 기간</span><input type="month" value={period} onChange={e=>setPeriod(e.target.value)} required disabled={saving}/><small>기간이 다른 원장 지출과 혼합하지 않습니다.</small></label><label>해당 월 제조원가 <span>원 · 비용 비율의 분모</span><input type="number" min="1" step="1" inputMode="numeric" value={manufacturing} onChange={e=>setManufacturing(e.target.value)} placeholder="미설정" disabled={saving}/><small>실제 보전비 누락 여부를 함께 확인해야 합니다.</small></label></div><div className="procedure-settings-actions"><p>공통 관리 기준의 저장은 개별 작업의 특별관리 승인을 대신하지 않습니다.</p><button className="primary" type="submit" disabled={saving}><Check size={15}/>{saving?'저장 중…':'공통 기준 저장'}</button></div>{message&&<p className={`procedure-save-message ${failed?'error':''}`} role={failed?'alert':'status'}>{message}</p>}</form>:<div className="procedure-readonly"><div><span>고액 특별관리 기준</span><b>{policy.highCostThreshold===null?'기준 미설정 · 관리자 검토 필요':`${money(policy.highCostThreshold)} 이상`}</b></div><div><span>{policy.costPeriod} 제조원가</span><b>{policy.manufacturingCost===null?'기준 미설정':money(policy.manufacturingCost)}</b></div><p><LockKeyhole size={14}/>기준 변경은 관리자에게 요청하세요.</p></div>}
  </section>
  <p className="procedure-draft-note"><BookOpen size={14}/>운영 초안 v{policy.policyVersion} · 사용자가 제시한 보전 목적과 기본 원칙을 반영했습니다. 세부 목표·현장별 작업 기준·정책 승인 절차는 관리자 검토 후 확정합니다.</p><p className="procedure-draft-note">참고 자료: <a href="https://www.energy.gov/cmei/femp/articles/operations-and-maintenance-best-practices-guide-achieving-operational-efficiency" target="_blank" rel="noreferrer">미국 에너지부 O&amp;M Best Practices ↗</a></p>
 </div>;
}

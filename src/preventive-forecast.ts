import type {ManagedPlan} from './preventive-plans';
const prefix='HDC-PREVENTIVE-V1\n';
export type ForecastSettings={partCode:string;partName:string;interval:number|null;unit:'days'|'months';lastDate:string};
export const emptyForecast:ForecastSettings={partCode:'',partName:'',interval:null,unit:'months',lastDate:''};
export function validForecastDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function readForecast(evidence=''):{settings:ForecastSettings;evidence:string}{
 if(evidence.startsWith(prefix))try{const p=JSON.parse(evidence.slice(prefix.length));if(p&&typeof p.evidence==='string'&&typeof p.partCode==='string'&&typeof p.partName==='string'&&typeof p.lastDate==='string'&&(p.unit==='days'||p.unit==='months')&&(p.interval===null||Number.isInteger(p.interval)&&p.interval>0&&p.interval<=3650))return {settings:{partCode:p.partCode,partName:p.partName,interval:p.interval,unit:p.unit,lastDate:p.lastDate},evidence:p.evidence};}catch{/* Preserve unrecognized evidence verbatim. */}
 return {settings:{...emptyForecast},evidence};
}
export function writeForecast(settings:ForecastSettings,evidence:string){
 if(!settings.partCode.trim()&&!settings.partName.trim()&&settings.interval===null&&!settings.lastDate)return evidence;
 if(settings.partCode.length>80||settings.partName.length>100)throw Error('부품코드는 80자, 부품명은 100자 이하로 입력하세요.');
 if(settings.interval!==null&&(!Number.isInteger(settings.interval)||settings.interval<1||settings.interval>3650))throw Error('예방정비 주기는 1~3650의 정수로 입력하세요.');
 if(settings.lastDate&&!validForecastDate(settings.lastDate))throw Error('최근 점검·정비 완료일을 확인하세요.');
 const value=prefix+JSON.stringify({...settings,partCode:settings.partCode.trim(),partName:settings.partName.trim(),evidence});
 if([...value].length>2000)throw Error('예방정비 기준과 근거·이력의 합계가 너무 깁니다. 근거 내용을 줄여주세요.');
 return value;
}
export function forecastSummary(evidence:string){const {settings:s,evidence:text}=readForecast(evidence);return [s.partCode&&`부품코드: ${s.partCode}`,s.partName&&`부품명: ${s.partName}`,s.interval&&`예방정비 주기: ${s.interval}${s.unit==='months'?'개월':'일'}`,s.lastDate&&`기준 완료일: ${s.lastDate}`,text].filter(Boolean).join('\n');}
export function nextForecastDate(date:string,amount:number,unit:'days'|'months'){
 if(!validForecastDate(date)||!Number.isInteger(amount)||amount<1||amount>3650)return '';
 const d=new Date(date+'T00:00:00Z');
 if(unit==='days')d.setUTCDate(d.getUTCDate()+amount);
 else {const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+amount);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));}
 const result=d.toISOString().slice(0,10);return validForecastDate(result)?result:'';
}
export function forecastWorkDate(due:string){
 if(!validForecastDate(due))return '';
 const date=new Date(due+'T00:00:00Z');
 if(date.getUTCDay()===0)date.setUTCDate(date.getUTCDate()-1);
 return date.toISOString().slice(0,10);
}
export type ForecastRecord={id:string;type:string;status:string;equipmentId:string;preventivePlanId?:string;note?:string;planning?:{actualEndAt?:string};items?:{result:string}[]};
export function buildForecast(plans:ManagedPlan[],records:ForecastRecord[],today:string,availableEquipment:Set<string>){
 if(!validForecastDate(today))throw Error('조회 기준일을 확인하세요.');
 return plans.filter(p=>p.catalogState!=='archived'&&!/^법정(?:\s*검사)?$/.test(p.method.trim())).map(plan=>{
  const {settings}=readForecast(plan.evidence);
  const linked=records.filter(r=>r.type==='workorder'&&r.equipmentId===plan.equipment&&r.preventivePlanId===plan.id);
  const completions=linked.filter(r=>r.status==='완료');
  // Older plan-linked records without a part code must not be reassigned to a newly configured part.
  const partCompletions=completions.filter(r=>settings.partCode.trim()&&(r.note||'').split(/\r?\n/).some(line=>line===`부품코드: ${settings.partCode.trim()}`));
  const dates=[...new Set(partCompletions.map(r=>r.planning?.actualEndAt?.slice(0,10)||'').filter(d=>validForecastDate(d)&&d<=today))].sort();
  const manual=validForecastDate(settings.lastDate)&&settings.lastDate<=today?settings.lastDate:'';
  const baseline=[...dates,manual].sort().at(-1)||'';
  const issues:string[]=[];
  if(!availableEquipment.has(plan.equipment))issues.push('실제 설비 연결 필요');
  if(!settings.partCode.trim()||!settings.partName.trim())issues.push('부품코드·부품명 입력 필요');
  if(!settings.interval)issues.push('계산용 정비 주기 입력 필요');
  if(!baseline)issues.push('실제 완료일 또는 기준 완료일 필요');
  if(settings.lastDate&&(!validForecastDate(settings.lastDate)||settings.lastDate>today))issues.push('기준 완료일 확인 필요');
  if(!plan.checklist.length)issues.push('사전 점검 항목·판정 기준 필요');
  if(plan.catalogState!=='original'&&plan.catalogState!=='approved')issues.push('기준 계획 승인 필요');
  const due=baseline&&settings.interval?nextForecastDate(baseline,settings.interval,settings.unit):'';
  const gaps=dates.slice(1).map((date,i)=>(Date.parse(date)-Date.parse(dates[i]))/86400000);
  const sorted=[...gaps].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  const candidate=sorted.length>=2?Math.round(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2):null;
  return {plan,settings,baseline,due,issues,completionCount:completions.length,datedCount:dates.length,candidate,active:linked.filter(r=>r.status!=='완료'),days:due?Math.round((Date.parse(due)-Date.parse(today))/86400000):null};
 }).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||a.plan.equipmentName.localeCompare(b.plan.equipmentName)||a.plan.id.localeCompare(b.plan.id));
}

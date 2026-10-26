import {validForecastDate,buildForecast} from './preventive-forecast';
import {readStatutoryDetails} from './statutory-plans';
import type {ManagedPlan} from './preventive-plans';
export type CalendarRecord={id:string;type:string;title:string;equipmentName:string;equipmentId:string;status:string;assignee:string;dueDate:string;note?:string;preventivePlanId?:string;planning?:{plannedDate:string;plannedStartAt:string;plannedEndAt:string;actualEndAt:string;window:string;approval:string;estimatedMinutes:number|null}};
export type MaintenanceEvent={id:string;recordId?:string;planId?:string;date:string;endDate:string;kind:'work'|'done'|'forecast'|'legal'|'deadline';title:string;equipment:string;assignee:string;status:string;time:string;minutes:number;morning:boolean};
export function monthDays(month:string){
 if(!/^\d{4}-\d{2}$/.test(month)||!validForecastDate(month+'-01'))return [];
 const first=new Date(month+'-01T00:00:00Z');first.setUTCDate(1-first.getUTCDay());
 return Array.from({length:42},(_,i)=>{const day=new Date(first);day.setUTCDate(day.getUTCDate()+i);return day.toISOString().slice(0,10);});
}
export function shiftCalendarMonth(month:string,offset:number){const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,7);}
export function buildMaintenanceEvents(records:CalendarRecord[],plans:ManagedPlan[],today:string,equipment:Set<string>):MaintenanceEvent[]{
 const result:MaintenanceEvent[]=[];
 for(const r of records.filter(r=>r.type==='workorder')){
  const p=r.planning;
  const completed=r.status==='완료';
  const planned=p?.plannedDate||'';
  const date=completed?p?.actualEndAt?.slice(0,10)||'':validForecastDate(planned)?planned:r.dueDate;
  if(!validForecastDate(date))continue;
  const kind=completed?'done':validForecastDate(planned)?'work':'deadline';
  const end=!completed&&kind==='work'&&p?.window==='weekday'&&validForecastDate(p.plannedEndAt?.slice(0,10))&&p.plannedEndAt.slice(0,10)>=date?p.plannedEndAt.slice(0,10):date;
  result.push({id:'record:'+r.id,recordId:r.id,planId:r.preventivePlanId,date,endDate:end,kind,title:r.title,equipment:r.equipmentName,assignee:r.assignee,status:completed?'완료':r.status==='보류'?'보류':kind==='deadline'?'기한 · 작업일 미정':p?.approval==='승인'?'승인 계획':'계획 · 승인 확인',time:completed?'실제 완료일':p?.window==='morning'?'08:00~09:30':p?.plannedStartAt?.slice(11,16)||'시간 미정',minutes:p?.estimatedMinutes||0,morning:p?.window==='morning'&&r.status!=='보류'&&!completed});
 }
 const reserved=new Set(result.filter(e=>e.recordId&&e.kind!=='done').map(e=>e.planId));
 for(const row of buildForecast(plans,records,today,equipment))if(row.due&&!row.issues.length&&!reserved.has(row.plan.id))result.push({id:'forecast:'+row.plan.id,planId:row.plan.id,date:row.due,endDate:row.due,kind:'forecast',title:row.settings.partName+' · '+row.plan.title,equipment:row.plan.equipmentName,assignee:'',status:'예상 · 미접수',time:'설정 주기 기준',minutes:0,morning:false});
 for(const plan of plans.filter(p=>p.catalogState!=='archived'&&/^법정(?:\s*검사)?$/.test(p.method.trim()))){const due=readStatutoryDetails(plan.evidence).nextDate;if(validForecastDate(due)&&!reserved.has(plan.id))result.push({id:'legal:'+plan.id,planId:plan.id,date:due,endDate:due,kind:'legal',title:plan.title,equipment:plan.equipmentName,assignee:'',status:plan.catalogState==='pending'?'검사 예상 · 승인 대기':'검사 예상 · 미접수',time:'법정 검사 기한',minutes:0,morning:false});}
 return result.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
}
export function eventsOnDay(events:MaintenanceEvent[],day:string){return events.filter(e=>e.date<=day&&e.endDate>=day);}
export function morningOverloads(events:MaintenanceEvent[]){const sums=new Map<string,number>();for(const e of events.filter(e=>e.morning&&e.assignee.trim()))sums.set(e.assignee,(sums.get(e.assignee)||0)+e.minutes);return [...sums].filter(([,minutes])=>minutes>90);}

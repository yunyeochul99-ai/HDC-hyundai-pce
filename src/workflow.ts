import {supabase,readableError} from './backend';
import type {InspectionRequest} from './inspection-hub';
export type FlowEvent={id:number;entity_id:string;stage:'request'|'accept'|'inspection'|'plan'|'approve'|'start'|'complete'|'reopen';actor_id:string;actor_name:string;occurred_at:string;evidence:string;recovered:boolean};
export const flowLabels:Record<FlowEvent['stage'],string>={request:'요청자',accept:'접수자',inspection:'점검 완료자',plan:'작업 요청·계획 등록 계정',approve:'승인자',start:'작업 시작 등록자',complete:'수리 완료자',reopen:'재진행 등록자'};
export async function loadWorkflow():Promise<FlowEvent[]>{const {data,error}=await supabase.rpc('hdc_v2_workflow');if(error)throw Error(readableError(error));return data||[];}
export async function acceptInspection(id:string){const {error}=await supabase.rpc('hdc_v2_inspection_accept',{p_request:id});if(error)throw Error(readableError(error));}
export function linkedFlowIds(record:{id:string;sourceInspectionId?:string},requests:InspectionRequest[],records:{id:string;sourceInspectionId?:string}[]=[]){
 const ids=new Set([record.id]);if(record.sourceInspectionId)ids.add(record.sourceInspectionId);
 for(const r of requests)if(ids.has(r.id)||!!r.inspection_id&&ids.has(r.inspection_id)){ids.add(r.id);if(r.inspection_id)ids.add(r.inspection_id);}
 for(const r of records)if(r.sourceInspectionId&&ids.has(r.sourceInspectionId))ids.add(r.id);
 return ids;
}

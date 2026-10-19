import {supabase,readableError} from './backend';
export type InspectionRequest={id:string;equipment_id:string;assignee_id:string;symptom:string;inspection_id:string|null;created_at:string;completed_at:string|null};
export type EquipmentLifecycle={equipment_id:string;status:'active'|'retired';reason:string;effective_on:string;version:number};
export type InspectionHubState={members:{id:string;name:string}[];requests:InspectionRequest[];lifecycle:EquipmentLifecycle[]};
export const emptyInspectionHub:InspectionHubState={members:[],requests:[],lifecycle:[]};
async function rpc(name:string,args?:Record<string,unknown>){const {data,error}=await supabase.rpc(name,args);if(error)throw Error(error.message||readableError(error));return data;}
export const loadInspectionHub=async():Promise<InspectionHubState>=>await rpc('hdc_v2_inspection_hub');
export const createInspectionRequest=(id:string,equipment:string,assignee:string,symptom:string)=>rpc('hdc_v2_inspection_request',{p_id:id,p_equipment:equipment,p_assignee:assignee,p_symptom:symptom});
export const finishInspectionRequest=(request:string,record:unknown)=>rpc('hdc_v2_inspection_finish',{p_request:request,p_record:record});
export const equipmentAction=(equipment:string,action:string,body:unknown,version:number)=>rpc('hdc_v2_equipment_action',{p_equipment:equipment,p_action:action,p_body:body,p_version:version});

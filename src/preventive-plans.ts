import {supabase,readableError} from './backend';
export type PreventivePlan={id:string;equipment:string;equipmentName:string;title:string;grade:string;cycle:string;method:string;priority:string;criteria:string;materials:string;estimatedCost:string;evidence:string;dataNote?:string;checklist:{name:string;criteria:string}[];source?:{id?:string;sheet?:string;row?:number}};
export type PreventiveEntry={id:string;body:PreventivePlan;state:'pending'|'approved'|'rejected'|'archived';version:number;decision_note:string;updated_at:string};
export type PreventiveCatalog={isOwner:boolean;ownerName:string;entries:PreventiveEntry[]};
export const emptyPreventiveCatalog:PreventiveCatalog={isOwner:false,ownerName:'전용 승인자',entries:[]};
export type ManagedPlan=PreventivePlan&{catalogState:'original'|PreventiveEntry['state'];catalogVersion:number;decisionNote:string};
export function mergePreventivePlans(original:PreventivePlan[],catalog:PreventiveCatalog):ManagedPlan[]{const map=new Map(original.map(p=>[p.id,{...p,catalogState:'original' as ManagedPlan['catalogState'],catalogVersion:0,decisionNote:''}]));for(const entry of catalog.entries)map.set(entry.id,{...entry.body,catalogState:entry.state,catalogVersion:entry.version,decisionNote:entry.decision_note});return [...map.values()];}
export const usablePreventivePlan=(p:ManagedPlan)=>p.catalogState==='original'||p.catalogState==='approved';
async function rpc(name:string,args?:Record<string,unknown>){const {data,error}=await supabase.rpc(name,args);if(error)throw Error(error.message||readableError(error));return data;}
export const loadPreventiveCatalog=async():Promise<PreventiveCatalog>=>await rpc('hdc_v2_preventive_catalog');
export const savePreventivePlan=(id:string,body:unknown,version:number)=>rpc('hdc_v2_preventive_save',{p_id:id,p_body:body,p_version:version});
export const actionPreventivePlan=(id:string,action:string,note:string,version:number)=>rpc('hdc_v2_preventive_action',{p_id:id,p_action:action,p_note:note,p_version:version});

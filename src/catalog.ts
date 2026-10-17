import {readableError,supabase} from './backend';
export type CatalogEquipment={id:string;name:string;grade?:string;model?:string;category?:string;cycle?:string;isCustom?:boolean;source?:{id?:string;sheet?:string}};
export type CatalogChecklist={id:string;equipment:string;equipmentName?:string;title:string;cycle:string;isCustom?:boolean;items:{id:string;name:string;criteria:string}[]};
export type Catalog={equipment:CatalogEquipment[];checklists:CatalogChecklist[]};
export type CatalogCreated={equipment:CatalogEquipment;checklist:CatalogChecklist};
export const emptyCatalog:Catalog={equipment:[],checklists:[]};
export function mergeCatalogLists(before:Catalog,next:Catalog):Catalog{
 const merge=<T extends {id:string}>(a:T[],b:T[])=>[...new Map([...a,...b].map(item=>[item.id,item])).values()];
 return {equipment:merge(before.equipment,next.equipment),checklists:merge(before.checklists,next.checklists)};
}
export function mergeCatalog<T extends Catalog>(base:T,extra:Catalog):T{
 const supplement=<I extends {id:string}>(a:I[],b:I[])=>[...a,...b.filter(item=>!a.some(old=>old.id===item.id))];
 return {...base,equipment:supplement(base.equipment,extra.equipment),checklists:supplement(base.checklists,extra.checklists)};
}
export async function loadCatalog():Promise<Catalog>{
 async function rows(table:string){const all:unknown[]=[];for(let from=0;;from+=500){const {data,error}=await supabase.from(table).select('body').order('id').range(from,from+499);if(error)throw Error(readableError(error));all.push(...(data||[]).map(row=>row.body));if(!data||data.length<500)return all;}}
 const [equipment,checklists]=await Promise.all([rows('hdc_v2_custom_equipment'),rows('hdc_v2_custom_checklists')]);
 return {equipment:equipment as CatalogEquipment[],checklists:checklists as CatalogChecklist[]};
}
export type NewChecklist={id:string;equipmentId:string;title:string;cycle:string;items:{name:string;criteria:string}[]};
export async function createChecklist(equipment:{id:string;name:string;model:string;category:string}|null,template:NewChecklist):Promise<CatalogCreated>{
 const {data,error}=await supabase.rpc('hdc_v2_create_checklist',{p_equipment:equipment,p_template:template});
 if(error){if(error.code==='PT409')throw Error(error.message);throw Error(readableError(error));}
 return data as CatalogCreated;
}

// Keep old device drafts and backups linked to the renamed 22 source plans.
export function canonicalPlanId(id:string){return /^PM-2026-V2-(00[1-9]|01\d|02[0-2])$/.test(id)?id.replace('-V2-','-'):id;}
export function canonicalPlanText(text:string){return text.replace(/PM-2026-V2-(00[1-9]|01\d|02[0-2])\b/g,'PM-2026-$1');}
export function canonicalPlanRecord<T extends Record<string,unknown>>(record:T):T{return {...record,...(typeof record.preventivePlanId==='string'?{preventivePlanId:canonicalPlanId(record.preventivePlanId)}:{}),...(typeof record.note==='string'?{note:canonicalPlanText(record.note)}:{})};}

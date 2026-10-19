import type {Catalog,CatalogChecklist} from './catalog';
export const inspectionCycles=['일일','주간','월간'] as const;
export function periodicTemplates(catalog:Catalog):CatalogChecklist[]{return catalog.equipment.flatMap(eq=>inspectionCycles.map((cycle,index)=>{
 const sources=catalog.checklists.filter(t=>t.equipment===eq.id&&t.cycle.includes(['일','주','월'][index]));
 const items=[...new Map(sources.flatMap(t=>t.items).map(i=>[i.name+'\0'+i.criteria,i])).values()].slice(0,100);
 return {id:`AUTO-${['DAILY','WEEKLY','MONTHLY'][index]}-${eq.id}`,equipment:eq.id,equipmentName:eq.name,title:`${eq.name} ${cycle}점검`.slice(0,200),cycle,items:items.length?items:[{id:`${eq.id}-${index}-review`,name:index===0?'외관·이상 증상 확인':index===1?'주간 이상 이력·미조치 사항 확인':'월간 정비 이력·제조사 점검 주기 확인',criteria:'현장 확인 필요 · 승인된 점검 항목과 판정 기준이 미등록입니다. 담당자가 제조사 기준·현장 안전절차를 확인한 후 결과와 확인 근거를 기록하세요.'}]};
}));}

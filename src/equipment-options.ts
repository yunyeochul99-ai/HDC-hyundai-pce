import type {CatalogEquipment} from './catalog';
export type EquipmentSort='name'|'importance'|'code';
export const equipmentGrade=(equipment:CatalogEquipment)=>{
 const grade=(equipment.grade||'').trim().toUpperCase();
 return /^[ABC](?:등급)?$/.test(grade)?grade[0]:'미분류';
};
export const equipmentCategory=(equipment:CatalogEquipment)=>equipment.category?.trim()||'기타';
const collator=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});
export function matchesEquipmentSearch(value:string,search:string){
 const normalize=(text:string)=>text.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,'');
 return normalize(value).includes(normalize(search));
}
export function equipmentOptions(equipment:CatalogEquipment[],options:{sort:EquipmentSort;category:string;grade:string;search:string}){
 const query=options.search.trim();
 const rank:Record<string,number>={A:0,B:1,C:2,'미분류':3};
 return equipment.filter(eq=>(!options.category||equipmentCategory(eq)===options.category)&&(!options.grade||equipmentGrade(eq)===options.grade)&&matchesEquipmentSearch(`${eq.name} ${eq.id} ${eq.model||''} ${equipmentCategory(eq)}`,query)).sort((a,b)=>{
  if(options.sort==='importance'){const difference=rank[equipmentGrade(a)]-rank[equipmentGrade(b)];if(difference)return difference;}
  if(options.sort==='code'){const difference=collator.compare(a.id,b.id);if(difference)return difference;}
  return collator.compare(a.name,b.name)||collator.compare(a.id,b.id);
 });
}


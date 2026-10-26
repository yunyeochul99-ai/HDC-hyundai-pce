import type {SparePart} from './SpareParts';
export const spareTextFields={name:'품목명',code:'품목코드',group:'설비군',equipment:'대상 설비 표기',spec:'규격·상세사양',location:'보관위치',supplier:'조달처',leadTime:'리드타임',note:'비고'};
export const spareNumberFields={confirmedQuantity:'실사 확인 수량',safety:'안전재고 기준',unitPrice:'관리 단가(원)'};
export type SpareOverride={part_id:string;patch:Partial<SparePart>;version:number;updated_at:string};
export function mergeSparePart(item:SparePart,edit?:SpareOverride):SparePart{return {...item,...edit?.patch,id:item.id,list:item.list,sourceQuantity:item.sourceQuantity,quantityText:item.quantityText,sourceAmount:item.sourceAmount,sourceSheet:item.sourceSheet,sourceRow:item.sourceRow};}
export function sparePatch(original:SparePart,values:Record<string,string>){
 const patch:Record<string,string|number|null>={};
 for(const key of Object.keys(spareTextFields)){const next=values[key].trim();if(next!==String(original[key as keyof SparePart]??''))patch[key]=next;}
 for(const key of Object.keys(spareNumberFields)){const raw=values[key].trim(),next=raw===''?null:Number(raw);if(next!==null&&(!Number.isFinite(next)||next<0||next>1e12))throw Error('수량·가격은 0 이상의 숫자로 입력하세요.');if(next!==(original[key as keyof SparePart]??null))patch[key]=next;}
 if(!values.name.trim())throw Error('품목명을 입력하세요.');return patch;
}

export function spareStockStatus(item:{confirmedQuantity:number|null;safety:number|null}){
 return item.confirmedQuantity===null?'실사 재고 미확인':item.safety===null?'안전재고 기준 미확인':item.confirmedQuantity<item.safety?'안전재고 미달':'안전재고 충족';
}

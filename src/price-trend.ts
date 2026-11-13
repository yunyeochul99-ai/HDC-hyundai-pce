export type PricePoint={id:string;part_id:string;price_date:string;amount:number;unit:string;vat:string;kind:string;supplier:string;spec:string;evidence:string;supersedes:string|null;created_at:string};
export const priceSeriesKey=(p:PricePoint)=>JSON.stringify([p.unit,p.vat,p.kind,p.supplier,p.spec]);
export function activePrices(points:PricePoint[]){const replaced=new Set(points.map(p=>p.supersedes).filter(Boolean));return points.filter(p=>!replaced.has(p.id));}
export function priceTrend(points:PricePoint[]){
 const sorted=activePrices(points).filter(p=>Number.isFinite(p.amount)&&p.amount>=0).sort((a,b)=>a.price_date.localeCompare(b.price_date)||a.created_at.localeCompare(b.created_at));
 const keys=new Set(sorted.map(priceSeriesKey));if(keys.size>1)throw Error('서로 다른 가격 조건은 별도로 비교하세요.');
 const dates=new Map<string,PricePoint[]>();for(const p of sorted)dates.set(p.price_date,[...(dates.get(p.price_date)||[]),p]);
 const ambiguous=[...dates.values()].some(a=>new Set(a.map(p=>p.amount)).size>1);
 const series=[...dates.values()].map(a=>a.at(-1)!);const first=series[0],last=series.at(-1);const delta=first&&last?last.amount-first.amount:null;
 const percent=first&&first.amount>0&&last?(last.amount/first.amount-1)*100:null;
 const rising=series.length>=3&&!ambiguous&&series.slice(1).every((p,i)=>p.amount>series[i].amount);
 return {series,first,last,delta,percent,ambiguous,label:ambiguous?'동일 날짜 가격 상충 · 확인 필요':series.length<2?'이력 부족':rising?'연속 상승 관찰':series.length===2&&delta!>0?'단가 상승 · 추세 확인 필요':delta!>0?'등락 중 · 최초 대비 상승':delta!<0?'최초 대비 하락':'변동 없음'};
}
export function purchaseScenario(price:number,quantity:number,increase:number,holdingRate:number,months:number){
 if(![price,quantity,increase,holdingRate,months].every(Number.isFinite)||price<0||quantity<=0||increase<0||increase>100||holdingRate<0||holdingRate>100||months<=0||months>60)throw Error('구매수량·상승 가정·보유비율·소진기간을 확인하세요.');
 const budget=price*quantity,avoided=budget*increase/100,holding=budget*holdingRate/100*months/12;
 return {budget,avoided,holding,net:avoided-holding,breakEven:holding/budget*100||0};
}

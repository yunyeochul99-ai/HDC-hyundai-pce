export type OriginRecord={id:string;type:string;title:string;equipmentName:string;date:string;assignee:string;note:string;createdAt?:string;sourceInspectionId?:string};
const hashes=new Map<string,Promise<string>>();
function defectId(id:string){let hash=hashes.get(id);if(!hash){hash=crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)).then(buffer=>'defect-'+Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join(''));hashes.set(id,hash);}return hash;}
// Match the server's deterministic relation; an editable memo is never the authority for the link.
export async function withInspectionOrigins<T extends OriginRecord>(records:T[]):Promise<T[]>{
 if(!records.some(r=>r.type==='workorder'&&r.id.startsWith('defect-')))return records;
 const sources=new Map(await Promise.all(records.filter(r=>r.type==='inspection').map(async r=>[await defectId(r.id),r] as const)));
 return records.map(r=>{if(r.type!=='workorder')return r;const source=sources.get(r.id);if(!source)return r;const header=/^점검 기록 [A-Za-z0-9_-]+의 불량 항목(?:\\n|\n)?/;
 const note=header.test(r.note)?r.note.replace(header,()=>`[불량 점검으로 자동 생성된 수리 요청]\n원본 점검: ${source.title}\n설비: ${source.equipmentName}\n점검일: ${source.date} · 점검 담당: ${source.assignee||'미지정'}\n\n수리가 필요한 항목\n`).replace(/\\n/g,'\n'):r.note;
 return {...r,sourceInspectionId:source.id,note,title:r.title===`[이상점검] ${source.title}`?`[자동 수리요청] ${source.equipmentName}`:r.title};});
}


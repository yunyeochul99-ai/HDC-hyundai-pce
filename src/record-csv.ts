import {photoDetail,photoStageLabels} from './photo-details';
type RecordRow=Record<string,any>;
export function buildRecordCsv(records:RecordRow[],isOwner:boolean,origin:string){
 const headers=['유형','일자','설비','제목','상태','우선순위','담당','기한','메모','보전구분','계획일','시간대','예상분','실제분','예상비용','실제비용','승인'];
 if(isOwner)for(let index=1;index<=5;index++)headers.push(`사진${index} 구분`,`사진${index} 부위`,`사진${index} 설명`,`사진${index} 보기 링크`);
 const rows=records.map(r=>{const p=r.planning;const row=[r.type,r.date,r.equipmentName,r.title,r.status,r.priority,r.assignee,r.dueDate,r.note,p?.category,p?.plannedDate,p?.window,p?.estimatedMinutes,p?.actualMinutes,p?.estimatedCost,p?.actualCost,p?.approval];
  if(isOwner)for(let index=0;index<5;index++){const id=r.photoIds?.[index];if(id){const d=photoDetail(r.photoDetails,id);row.push(photoStageLabels[d.stage],d.part,d.caption,`${origin}/#export-photo/${encodeURIComponent(r.id)}/${encodeURIComponent(id)}`);}else row.push('','','','');}
  return row;
 });
 const cell=(value:unknown)=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
 return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}

export const photoStages=['before','after','unclassified'] as const;
export type PhotoStage=typeof photoStages[number];
export type PhotoDetail={stage:PhotoStage;part:string;caption:string};
export type PhotoDetails=Record<string,PhotoDetail>;
export const photoStageLabels:Record<PhotoStage,string>={before:'보수 전',after:'보수 후',unclassified:'미분류'};
export const emptyPhotoDetail=(stage:PhotoStage='unclassified'):PhotoDetail=>({stage,part:'',caption:''});
export function photoDetail(details:PhotoDetails|undefined,id:string):PhotoDetail{const d=details?.[id];return d&&photoStages.includes(d.stage)?d:emptyPhotoDetail();}
export const photoFileKey=(file:File)=>JSON.stringify([file.name,file.size,file.lastModified]);
export function attachedPhotoDetails(ids:string[],details:PhotoDetails|undefined):PhotoDetails{return Object.fromEntries(ids.map(id=>[id,photoDetail(details,id)]));}
export function validPhotoDetails(value:unknown):boolean{return value===undefined||!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(d=>d&&typeof d==='object'&&photoStages.includes(d.stage)&&typeof d.part==='string'&&d.part.length<=100&&typeof d.caption==='string'&&d.caption.length<=500);}

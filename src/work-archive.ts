import {supabase,readableError} from './backend';
export type WorkArchive={record_id:string;archived:boolean;reason:string;updated_at:string};
export async function loadWorkArchives():Promise<WorkArchive[]>{const {data,error}=await supabase.from('hdc_v2_work_archives').select('record_id,archived,reason,updated_at');if(error)throw Error(readableError(error));return data||[];}
export async function workArchiveAction(record:string,action:'archive'|'restore',version:number,reason:string){const {error}=await supabase.rpc('hdc_v2_work_archive_action',{p_record:record,p_action:action,p_version:version,p_reason:reason});if(error)throw Error(readableError(error));}


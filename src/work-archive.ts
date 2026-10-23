import {supabase,readableError} from './backend';
export async function purgeWorkRecord(record:string,version:number,reason:string,confirmation:string){const {error}=await supabase.rpc('hdc_v2_work_record_purge',{p_record:record,p_version:version,p_reason:reason,p_confirmation:confirmation});if(error)throw Error(readableError(error));}
export type WorkArchive={record_id:string;archived:boolean;reason:string;updated_at:string};
export async function loadWorkArchives():Promise<WorkArchive[]>{const {data,error}=await supabase.from('hdc_v2_work_archives').select('record_id,archived,reason,updated_at');if(error)throw Error(readableError(error));return data||[];}
export async function workArchiveAction(record:string,action:'archive'|'restore',version:number,reason:string){const {error}=await supabase.rpc('hdc_v2_work_archive_action',{p_record:record,p_action:action,p_version:version,p_reason:reason});if(error)throw Error(readableError(error));}


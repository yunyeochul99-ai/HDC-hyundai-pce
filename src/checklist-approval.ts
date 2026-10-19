import {supabase,readableError} from './backend';
export type FormApproval={template_id:string;state:'pending'|'approved'|'rejected'|'restored';reason:string;requested_by:string;requested_at:string;decided_at:string|null;version:number};
export type FormApprovalState={isOwner:boolean;ownerName:string;forms:FormApproval[]};
export const emptyApproval:FormApprovalState={isOwner:false,ownerName:'전용 승인자',forms:[]};
export async function loadFormApprovals():Promise<FormApprovalState>{const {data,error}=await supabase.rpc('hdc_v2_form_approvals');if(error)throw Error(readableError(error));return data as FormApprovalState;}
export async function decideForm(templateId:string,action:'request'|'approve'|'reject'|'restore',reason:string,version:number){const {error}=await supabase.rpc('hdc_v2_form_action',{p_template_id:templateId,p_action:action,p_reason:reason,p_version:version});if(error)throw Error(error.message||readableError(error));}

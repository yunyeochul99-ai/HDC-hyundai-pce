import {useEffect,useRef,useState} from 'react';
import {supabase,readableError} from './backend';
import type {SpareOverride} from './spare-edit-values';
export {spareTextFields,spareNumberFields,sparePatch,mergeSparePart} from './spare-edit-values';
export function useSpareEdits(){
 const [edits,setEdits]=useState<SpareOverride[]>([]),[error,setError]=useState(''),[live,setLive]=useState(false),[ready,setReady]=useState(false);const seq=useRef(0);
 async function reload(){const id=++seq.current;try{const {data,error}=await supabase.from('hdc_v2_spare_overrides').select('part_id,patch,version,updated_at');if(error)throw Error(readableError(error));if(id===seq.current){setEdits(data||[]);setError('');setReady(true);}}catch(e){if(id===seq.current)setError(e instanceof Error?e.message:'수정 내용 조회 실패');}}
 useEffect(()=>{void reload();const channel=supabase.channel('spare-edits').on('postgres_changes',{event:'*',schema:'public',table:'hdc_v2_spare_overrides'},()=>void reload()).subscribe(status=>{setLive(status==='SUBSCRIBED');if(status==='SUBSCRIBED')void reload();});const onFocus=()=>{if(document.visibilityState==='visible')void reload();};document.addEventListener('visibilitychange',onFocus);window.addEventListener('focus',onFocus);const timer=setInterval(onFocus,15000);return()=>{seq.current++;clearInterval(timer);document.removeEventListener('visibilitychange',onFocus);window.removeEventListener('focus',onFocus);void supabase.removeChannel(channel);};},[]);
 return {edits,error,live,ready,reload};
}

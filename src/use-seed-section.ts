import {useEffect,useRef,useState} from 'react';
import {supabase,readableError} from './backend';
/** Read only an approved user's private seed section; never bundle source files. */
export function useSeedSection<T>(key:'sourceInventory'|'spareParts',initial?:T){
 const [value,setValue]=useState<T|undefined>(initial),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const request=useRef(0),version=useRef('');
 async function reload(force=true){
  const id=++request.current;setLoading(true);
  try{
   const stamp=await supabase.from('hdc_v2_seed').select('updated_at').eq('key','factory').maybeSingle();
   if(stamp.error)throw Error(readableError(stamp.error));
   if(!force&&stamp.data?.updated_at===version.current)return;
   const response=await supabase.from('hdc_v2_seed').select(`section:payload->${key}`).eq('key','factory').maybeSingle();
   if(response.error)throw Error(readableError(response.error));
   if(id===request.current){setValue((response.data as unknown as {section?:T}|null)?.section);version.current=stamp.data?.updated_at||'';setError('');}
  }catch(e){if(id===request.current)setError(e instanceof Error?e.message:'목록 조회 실패');}
  finally{if(id===request.current)setLoading(false);}
 }
 useEffect(()=>{void reload();const timer=setInterval(()=>{if(document.visibilityState==='visible')void reload(false);},60000);return()=>{request.current++;clearInterval(timer);};},[key]);
 return {value,error,loading,reload:()=>reload()};
}

import {useEffect,useRef,useState} from 'react';
import {supabase,readableError} from './backend';
import type {LayoutPosition} from './factory-layout';
export function useLayoutPositions(){
 const [positions,setPositions]=useState<LayoutPosition[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false),[live,setLive]=useState(false);const sequence=useRef(0);
 async function reload(){const id=++sequence.current;try{const {data,error}=await supabase.from('hdc_v2_layout_positions').select('equipment_id,zone_id,version,reason,updated_at');if(error)throw Error(readableError(error));if(id===sequence.current){setPositions(data||[]);setReady(true);setError('');}}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:'위치 정보 조회 실패');}}
 useEffect(()=>{void reload();const c=supabase.channel('factory-layout-positions').on('postgres_changes',{event:'*',schema:'public',table:'hdc_v2_layout_positions'},()=>void reload()).subscribe(status=>{setLive(status==='SUBSCRIBED');if(status==='SUBSCRIBED')void reload();});const changed=()=>{if(document.visibilityState==='visible')void reload();};const timer=setInterval(changed,15000);document.addEventListener('visibilitychange',changed);return()=>{sequence.current++;clearInterval(timer);document.removeEventListener('visibilitychange',changed);void supabase.removeChannel(c);};},[]);
 return {positions,error,ready,live,reload};
}

import {useEffect,useRef,useState} from 'react';
import {purgeWorkRecord} from './work-archive';

export default function PurgeRecordForm({record,onCancel,onDeleted}:{record:{id:string;title:string;equipmentName:string;version:number};onCancel:()=>void;onDeleted:(id:string)=>Promise<void>}) {
  const [confirmation,setConfirmation]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false);
  const form=useRef<HTMLFormElement>(null);
  useEffect(()=>{form.current?.scrollIntoView({behavior:'smooth',block:'center'});},[]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if(lock.current||confirmation!=='완전 삭제'||!reason.trim())return;
    lock.current=true;setBusy(true);setError('');
    try {
      await purgeWorkRecord(record.id,record.version,reason,confirmation);
      await onDeleted(record.id);
    } catch(error) {setError(error instanceof Error?error.message:'완전 삭제 처리 결과를 확인하세요.');}
    finally {lock.current=false;setBusy(false);}
  }
  return <form ref={form} className="purge-record-form" onSubmit={submit}>
    <h3>삭제 보관 기록 완전 삭제</h3>
    <p><b>{record.title}</b><br/>{record.equipmentName}</p>
    <p className="error-msg">이 기록의 본문·작업계획·변경 이력을 영구 삭제하며 복원할 수 없습니다. 연결된 다른 기록과 사진 파일은 유지합니다. 요청서만 삭제하면 별도로 저장된 원본 점검은 실적에 남습니다. 테스트 기록 정리는 전체 업무 기록에서 원본 점검도 확인하세요.</p>
    <label>완전 삭제 사유<textarea required disabled={busy} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label>확인을 위해 ‘완전 삭제’를 입력하세요<input required disabled={busy} autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
    {error&&<p role="alert" className="error-msg">{error}</p>}
    <div className="form-approval-buttons"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>취소</button><button className="primary" disabled={busy||confirmation!=='완전 삭제'||!reason.trim()}>{busy?'완전 삭제 처리 중…':'영구 삭제 실행'}</button></div>
  </form>;
}

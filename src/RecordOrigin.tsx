import type {OriginRecord} from './record-origin';

export default function RecordOrigin({record,records,onOpen}:{record:OriginRecord;records:OriginRecord[];onOpen?:(record:OriginRecord)=>void}){
 const source=records.find(r=>r.id===record.sourceInspectionId),children=records.filter(r=>r.sourceInspectionId===record.id);
 if(!source&&!children.length)return null;
 return <section className="record-origin" aria-label="원본 점검과 자동 수리 요청"><b>{source?'불량 점검에서 자동 생성된 수리 요청':'이 점검에서 생성된 수리 요청'}</b><p>{source?'점검에서 불량이 확인되어 시스템이 후속 수리 요청을 만들었습니다. 수리 완료 여부는 이 작업의 진행 상태로 확인하세요.':'불량 항목에 대한 수리 진행 상황을 아래 요청에서 확인하세요.'}</p>{(source?[source]:children).map(r=><div key={r.id}><strong>{r.title}</strong><p>{r.equipmentName} · 기록 일자 {r.date} · 담당 {r.assignee||'미지정'}</p>{r.createdAt&&<small>서버 등록: {new Date(r.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</small>}{onOpen?<button type="button" className="secondary" onClick={()=>onOpen(r)}>{source?'원본 점검 보기':'관련 수리 요청 보기'}</button>:source&&<details><summary>원본 점검 내용 확인</summary><p className="pre-line">{r.note||'추가 메모 없음'}</p></details>}</div>)}</section>;
}


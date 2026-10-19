import { CloudCheck, CloudUpload, WifiOff, CircleAlert, Clock3, LoaderCircle, UserRound } from 'lucide-react';
import type { TransferStatus } from './record-transfer';
import './save-status.css';

export const statusTime = (time: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(time));

export function ConnectionStatus({ checking, connected, online, checkedAt }: { checking: boolean; connected: boolean; online: boolean; checkedAt: number | null }) {
  const Icon = !online ? WifiOff : checking ? LoaderCircle : connected ? CloudCheck : CircleAlert;
  const text = !online ? '인터넷 연결 끊김' : checking ? '서버 확인 중' : connected ? '서버 연결 확인' : '서버 확인 실패';
  return <span className={`connection-status ${!online || (!checking && !connected) ? 'is-error' : checking ? 'is-checking' : 'is-connected'}`} role="status" title={`${text}${checkedAt ? ` · 마지막 조회 ${statusTime(checkedAt)}` : ''} · 작성 중인 기록의 저장 여부는 별도 표시됩니다.`}><Icon size={16} className={checking && online ? 'status-spin' : ''}/><span>{text}{checkedAt && !checking && <small>최근 조회 {statusTime(checkedAt)}</small>}</span></span>;
}

export function LoggedInUser({ name, onClick }: { name: string; onClick: () => void }) {
  return <button className="header-user" onClick={onClick} aria-label={`로그인 담당자 ${name} · 계정 설정`}><UserRound size={18}/><span><small>로그인 담당자</small><strong>{name}</strong></span></button>;
}

export default function SaveStatus({ status, compact = false, onView }: { status: TransferStatus; compact?: boolean; onView?: () => void }) {
  const pending = ['preparing', 'uploading', 'saving'].includes(status.phase);
  const Icon = pending ? LoaderCircle : status.phase === 'saved' ? CloudCheck : status.phase === 'failed' ? CircleAlert : status.phase === 'draft' ? Clock3 : CloudUpload;
  const labels = { unsaved: '서버 저장 전', preparing: '사진 확인·자동 압축 중', uploading: '사진 업로드 중', saving: '서버 등록 중', saved: '서버 등록 완료', failed: '저장 실패 · 서버 등록 확인 필요', draft: '기기에만 임시 저장됨' };
  const help = status.message || (status.phase === 'saved' ? `사진 ${status.photoCount ?? 0}장 포함 · 다른 기기에서 조회할 수 있습니다.` : status.phase === 'failed' ? '서버 등록 여부를 확인하지 못했습니다. 기록을 새로 조회한 뒤 다시 시도하세요.' : status.phase === 'draft' ? '현재 내용은 기기에만 저장되어, 다른 기기에서는 변경 내용을 볼 수 없습니다.' : status.phase === 'unsaved' ? '‘서버에 저장’을 눌러야 사진과 기록이 등록됩니다.' : '완료 표시가 나올 때까지 기다려 주세요.');
  return <section className={`save-status phase-${status.phase}${compact ? ' is-compact' : ''}`} role="status" aria-live="polite" aria-atomic="true"><Icon size={compact ? 18 : 23} className={pending ? 'status-spin' : ''}/><div className="save-status-copy"><div><strong>{labels[status.phase]}</strong>{status.at && <time dateTime={new Date(status.at).toISOString()}>{statusTime(status.at)}</time>}</div>{status.title && !compact && <b className="save-status-title">{status.title}</b>}<p>{help}</p>{pending && status.total !== undefined && <progress aria-label="사진과 기록 저장 진행 단계" max={status.total} value={status.completed ?? 0}/>}</div>{onView && status.phase === 'saved' && <button type="button" onClick={onView}>저장 기록 확인</button>}</section>;
}


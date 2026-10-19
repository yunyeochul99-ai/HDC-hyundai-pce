import { useEffect, useRef, useState } from 'react';
import { readableError, supabase } from './backend';
import './legacy.css';

type LegacyRecord = {
  k?: unknown;
  rec_date?: unknown;
  order_id?: unknown;
  equip?: unknown;
  who?: unknown;
  result?: unknown;
  items?: unknown;
  note?: unknown;
  act?: unknown;
  created_at?: unknown;
};

function plainText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '자료 미기재';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return '자료를 표시할 수 없습니다.'; }
  }
  return String(value);
}

const LEGACY_PHOTO_PATH = /^mig\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/i;
const MAX_LEGACY_PHOTO_BYTES = 5 * 1024 * 1024;

/** Only raster images embedded in the original record are converted to local URLs. */
function embeddedPhoto(value: string): Blob | null {
  if (value.length > Math.ceil(MAX_LEGACY_PHOTO_BYTES / 3) * 4 + 64) return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    if (!binary.length || binary.length > MAX_LEGACY_PHOTO_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const starts = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[index + offset] === byte);
    const type = match[1].toLowerCase();
    const valid = type === 'jpeg' ? starts([0xff, 0xd8, 0xff])
      : type === 'png' ? starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    return valid ? new Blob([bytes], { type: `image/${type}` }) : null;
  } catch { return null; }
}

function LegacyPhoto({ value, index }: { value: unknown; index: number }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let localUrl = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    setUrl('');
    setError('');
    setLoading(true);
    const load = async () => {
      try {
        if (typeof value !== 'string') throw new Error('올바른 사진 정보가 아닙니다.');
        if (value.startsWith('data:')) {
          const image = embeddedPhoto(value);
          if (!image) throw new Error('JPG·PNG·WebP 형식의 5MB 이하 원본 사진만 표시할 수 있습니다.');
          localUrl = URL.createObjectURL(image);
          if (alive) setUrl(localUrl);
          return;
        }
        if (!LEGACY_PHOTO_PATH.test(value) || value.includes('..')) throw new Error('이전 사진의 저장 경로를 확인해 주세요.');
        // The photos bucket authorizes approved factory members through Storage RLS.
        // Never fetch a URL supplied directly in a legacy record.
        const result = await supabase.storage.from('photos').createSignedUrl(value, 15 * 60);
        if (result.error) throw result.error;
        if (!result.data?.signedUrl) throw new Error('이전 사진을 찾을 수 없습니다.');
        if (!alive) return;
        setUrl(result.data.signedUrl);
        setError('');
        timer = setTimeout(() => { if (alive) void load(); }, 12 * 60 * 1000);
      } catch (failure) {
        if (alive) {
          setUrl('');
          setLoading(false);
          setError(readableError(failure));
        }
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [value]);
  return <figure className="legacy-photo">{url && !error && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`이전 사진 ${index + 1} 원본 열기`}><img src={url} alt={`이전 점검 사진 ${index + 1}`} loading="lazy" decoding="async" onLoad={() => setLoading(false)} onError={() => { setLoading(false); setError('사진을 표시하지 못했습니다. 이전 기록을 다시 열어 주세요.'); }} /><span>사진 {index + 1} · 원본 열기 ↗</span></a>}{loading && !error && <p className="legacy-photo-status" role="status">사진을 불러오는 중…</p>}{error && <p className="legacy-photo-status legacy-photo-error" role="status">{error}</p>}</figure>;
}

function LegacyPhotos({ values }: { values: unknown[] }) {
  if (!values.length) return <p className="legacy-muted">저장된 사진이 없습니다.</p>;
  return <div className="legacy-photo-grid">{values.map((value, index) => <LegacyPhoto value={value} index={index} key={index} />)}</div>;
}

function ItemValues({ value }: { value: unknown }) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return <dl className="legacy-item-fields">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{key === 'imgs' && Array.isArray(entry) ? '현장 사진' : key}</dt><dd>{key === 'imgs' && Array.isArray(entry) ? <LegacyPhotos values={entry} /> : <pre>{plainText(entry)}</pre>}</dd></div>)}</dl>;
  }
  return <pre className="legacy-plain-value">{plainText(value)}</pre>;
}

export function LegacyRecordDetails({ record }: { record: LegacyRecord }) {
  let items = record.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { /* Older records may contain plain text. */ }
  }
  return <div className="legacy-record-body"><dl className="legacy-metadata"><div><dt>점검일</dt><dd>{plainText(record.rec_date)}</dd></div><div><dt>대상 설비</dt><dd>{plainText(record.equip)}</dd></div><div><dt>담당·점검자</dt><dd>{plainText(record.who)}</dd></div><div><dt>원본 판정</dt><dd>{plainText(record.result)}</dd></div><div><dt>원본 작업 ID</dt><dd>{plainText(record.order_id)}</dd></div><div><dt>원본 등록 시각</dt><dd>{plainText(record.created_at)}</dd></div></dl><div className="legacy-note"><h4>점검 메모</h4><pre>{plainText(record.note)}</pre></div><div className="legacy-note"><h4>조치 내역</h4><pre>{plainText(record.act)}</pre></div><div className="legacy-items"><h4>원본 점검 항목</h4>{Array.isArray(items) ? items.length > 0 ? items.map((item, index) => <details className="legacy-item" key={index}><summary>항목 {index + 1}</summary><ItemValues value={item} /></details>) : <p className="legacy-muted">저장된 세부 항목이 없습니다.</p> : <ItemValues value={items} />}</div><p className="legacy-muted">원본 항목과 기록에 포함된 사진을 함께 표시합니다. 이전 사진은 현재 서버의 보호된 사진 저장소 또는 기록에 보존된 원본 이미지에서 조회합니다.</p></div>;
}

/** Read-only legacy history, kept outside all V2 operational metrics. */
export default function LegacyRecords() {
  const [records, setRecords] = useState<LegacyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++request.current; };
  }, []);

  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const sequence = ++request.current;
    setLoading(true);
    setError('');
    try {
      const result = await supabase.rpc('hdc_v2_legacy_records');
      if (result.error) throw result.error;
      if (!Array.isArray(result.data) || result.data.some((entry: unknown) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) throw new Error('이전 점검기록 목록의 형식을 확인해 주세요.');
      if (alive.current && sequence === request.current) { setRecords(result.data as LegacyRecord[]); setLoaded(true); }
    } catch (failure) {
      if (alive.current && sequence === request.current) { setError(readableError(failure)); setRecords([]); setLoaded(false); }
    } finally {
      inFlight.current = false;
      if (alive.current && sequence === request.current) setLoading(false);
    }
  };

  const search = query.trim().toLocaleLowerCase('ko-KR');
  const filtered = records.filter((record) => [record.rec_date, record.equip, record.who, record.result, record.order_id, record.note, record.act].some((value) => plainText(value).toLocaleLowerCase('ko-KR').includes(search)));
  return <section className="card legacy-records"><div className="card-heading"><div><h2>이전 앱 점검기록 {loaded && <span className="number-pill">{records.length}</span>}</h2><p>원본 보존 · 읽기 전용</p></div><span className="tag neutral">새 운영 집계와 별도</span></div><p className="legacy-intro">기존 점검기록과 이전 사진을 현재 서버에서 조회합니다. 원본 기록은 읽기 전용으로 보존하며 새 점검·조치 작업 실적과 별도로 표시합니다.</p><button type="button" className="secondary legacy-expand-button" aria-expanded={expanded} aria-controls="legacy-record-list" onClick={() => { const next = !expanded; setExpanded(next); if (next && !loaded) void load(); }}>{expanded ? '이전 기록 접기' : '이전 기록 펼치기'}<span aria-hidden="true">{expanded ? '−' : '+'}</span></button>{expanded && <div id="legacy-record-list" className="legacy-list"><div className="legacy-tools"><input type="search" aria-label="이전 점검기록 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="날짜, 설비, 담당자, 판정 검색" /><button type="button" className="secondary" disabled={loading} onClick={() => void load()}>{loading ? '조회 중…' : '원본 새로고침'}</button></div>{loading && <p className="legacy-muted" role="status">이전 점검기록을 불러오고 있습니다.</p>}{error && <p className="auth-error" role="alert">{error}</p>}{!loading && !error && loaded && <><p className="legacy-count">검색 {filtered.length}건 / 원본 {records.length}건</p>{filtered.map((record, index) => <details className="legacy-record" key={`${plainText(record.k)}-${index}`}><summary><span className="legacy-summary-date">{plainText(record.rec_date)}</span><span className="legacy-summary-equipment"><b>{plainText(record.equip)}</b><small>{plainText(record.who)}</small></span><span className="tag neutral">{plainText(record.result)}</span></summary><LegacyRecordDetails record={record} /></details>)}{filtered.length === 0 && <p className="legacy-muted">{records.length ? '검색 조건과 일치하는 이전 기록이 없습니다.' : '조회할 이전 점검기록이 없습니다.'}</p>}</>}</div>}</section>;
}

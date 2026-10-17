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

function ItemValues({ value }: { value: unknown }) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return <dl className="legacy-item-fields">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{key}</dt><dd><pre>{plainText(entry)}</pre></dd></div>)}</dl>;
  }
  return <pre className="legacy-plain-value">{plainText(value)}</pre>;
}

export function LegacyRecordDetails({ record }: { record: LegacyRecord }) {
  let items = record.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { /* Older records may contain plain text. */ }
  }
  return <div className="legacy-record-body"><dl className="legacy-metadata"><div><dt>점검일</dt><dd>{plainText(record.rec_date)}</dd></div><div><dt>대상 설비</dt><dd>{plainText(record.equip)}</dd></div><div><dt>담당·점검자</dt><dd>{plainText(record.who)}</dd></div><div><dt>원본 판정</dt><dd>{plainText(record.result)}</dd></div><div><dt>원본 작업 ID</dt><dd>{plainText(record.order_id)}</dd></div><div><dt>원본 등록 시각</dt><dd>{plainText(record.created_at)}</dd></div></dl><div className="legacy-note"><h4>점검 메모</h4><pre>{plainText(record.note)}</pre></div><div className="legacy-note"><h4>조치 내역</h4><pre>{plainText(record.act)}</pre></div><div className="legacy-items"><h4>원본 점검 항목</h4>{Array.isArray(items) ? items.length > 0 ? items.map((item, index) => <details className="legacy-item" key={index}><summary>항목 {index + 1}</summary><ItemValues value={item} /></details>) : <p className="legacy-muted">저장된 세부 항목이 없습니다.</p> : <ItemValues value={items} />}</div><p className="legacy-muted">원본 항목의 키와 값을 그대로 표시합니다. URL과 사진 정보도 텍스트로만 표시하며 이전 사진 파일을 새 저장소로 옮기지 않습니다.</p></div>;
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
  return <section className="card legacy-records"><div className="card-heading"><div><h2>이전 앱 점검기록 {loaded && <span className="number-pill">{records.length}</span>}</h2><p>원본 보존 · 읽기 전용</p></div><span className="tag neutral">새 운영 집계와 별도</span></div><p className="legacy-intro">기존 점검기록은 원본 테이블에 그대로 보존합니다. 이 목록은 새 점검·조치 작업 실적에 포함하지 않으며 이전 사진 파일은 자동 이전하지 않습니다.</p><button type="button" className="secondary legacy-expand-button" aria-expanded={expanded} aria-controls="legacy-record-list" onClick={() => { const next = !expanded; setExpanded(next); if (next && !loaded) void load(); }}>{expanded ? '이전 기록 접기' : '이전 기록 펼치기'}<span aria-hidden="true">{expanded ? '−' : '+'}</span></button>{expanded && <div id="legacy-record-list" className="legacy-list"><div className="legacy-tools"><input type="search" aria-label="이전 점검기록 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="날짜, 설비, 담당자, 판정 검색" /><button type="button" className="secondary" disabled={loading} onClick={() => void load()}>{loading ? '조회 중…' : '원본 새로고침'}</button></div>{loading && <p className="legacy-muted" role="status">이전 점검기록을 불러오고 있습니다.</p>}{error && <p className="auth-error" role="alert">{error}</p>}{!loading && !error && loaded && <><p className="legacy-count">검색 {filtered.length}건 / 원본 {records.length}건</p>{filtered.map((record, index) => <details className="legacy-record" key={`${plainText(record.k)}-${index}`}><summary><span className="legacy-summary-date">{plainText(record.rec_date)}</span><span className="legacy-summary-equipment"><b>{plainText(record.equip)}</b><small>{plainText(record.who)}</small></span><span className="tag neutral">{plainText(record.result)}</span></summary><LegacyRecordDetails record={record} /></details>)}{filtered.length === 0 && <p className="legacy-muted">{records.length ? '검색 조건과 일치하는 이전 기록이 없습니다.' : '조회할 이전 점검기록이 없습니다.'}</p>}</>}</div>}</section>;
}

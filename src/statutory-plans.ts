// Keep structured register fields in the existing evidence field so the current
// server validation, approval history and legacy plans remain compatible.
const prefix = 'HDC-STATUTORY-V1\n';
export const statutoryFields = [
  ['group', '구분', 40], ['sequence', '번호', 20],
  ['quantity', '수량', 40], ['capacity', '용량', 80],
  ['lastDate', '최근검사일', 10], ['nextDate', '다음검사일', 10],
  ['agency', '검사기관', 100], ['modelNumber', '형식번호', 100],
  ['application', '검사신청', 100], ['managementNumber', '관리번호', 100],
] as const;
export type StatutoryKey = typeof statutoryFields[number][0];
export type StatutoryDetails = Record<StatutoryKey, string> & { evidence: string };
export function readStatutoryDetails(evidence = ''): StatutoryDetails {
  const empty = Object.fromEntries(statutoryFields.map(([key]) => [key, ''])) as Record<StatutoryKey, string>;
  if (evidence.startsWith(prefix)) {
    try {
      const parsed: unknown = JSON.parse(evidence.slice(prefix.length));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const data = parsed as Record<string, unknown>;
        if (statutoryFields.every(([key]) => typeof data[key] === 'string') && typeof data.evidence === 'string')
          return { ...empty, ...Object.fromEntries(statutoryFields.map(([key]) => [key, data[key]])), evidence: data.evidence } as StatutoryDetails;
      }
    } catch { /* Preserve malformed/legacy evidence as text for recovery. */ }
  }
  return { ...empty, evidence };
}
export function writeStatutoryDetails(details: StatutoryDetails): string {
  for (const [key, label, limit] of statutoryFields) {
    if (details[key].length > limit) throw Error(`${label}은 ${limit}자 이하로 입력하세요.`);
  }
  for (const key of ['lastDate', 'nextDate'] as const) {
    const value = details[key];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value))
      throw Error('검사일을 올바른 날짜로 입력하세요.');
  }
  if (details.lastDate && details.nextDate && details.nextDate < details.lastDate)
    throw Error('다음검사일은 최근검사일 이후로 입력하세요.');
  const encoded = prefix + JSON.stringify(details);
  if ([...encoded].length > 2000) throw Error('검사 정보와 근거·이력의 전체 입력 길이를 줄여주세요.');
  return encoded;
}
export function statutorySummary(evidence = ''): string {
  const details = readStatutoryDetails(evidence);
  return [...statutoryFields.filter(([key]) => details[key]).map(([key,label]) => `${label}: ${details[key]}`), details.evidence].filter(Boolean).join('\n');
}

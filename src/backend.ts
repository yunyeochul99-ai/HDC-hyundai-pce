import {canonicalPlanId,canonicalPlanRecord} from './plan-code';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../public-config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'hdc-pce-v2-auth-pcaporgqhzzwzfgkxars',
  },
});

export type Profile = {
  id: string;
  display_name: string | null;
  approved: boolean;
  is_admin: boolean;
  created_at?: string;
};

type JsonObject = Record<string, unknown>;
type BackendError = { code?: string; message?: string; details?: string; status?: number };
const PHOTO_BUCKET = 'hdc-v2-private';
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seedCache = new Map<string, { payload: JsonObject; loadedAt: number }>();
const photoCache = new Map<string, { url: string; expiresAt: number }>();
const recordOwners = new Map<string, string>();
let accessProfile: Profile | null = null;
let activeAccount: string | null = null;

export function clearAuthenticatedCaches() {
  seedCache.clear();
  photoCache.clear();
  recordOwners.clear();
  accessProfile = null;
}

export function setAccessProfile(profile: Profile | null) { accessProfile = profile; }
export function invalidateSeedCache() { seedCache.clear(); }
export function canEditRecord(id: string) {
  return accessProfile?.approved === true && (accessProfile.is_admin === true || recordOwners.get(id) === accessProfile.id);
}

// Keep this callback synchronous: Supabase Auth holds its internal session lock
// while notifying listeners. Database/Auth work is scheduled by AuthGate later.
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || next !== activeAccount) clearAuthenticatedCaches();
  activeAccount = next;
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function statusFor(error: BackendError) {
  if (error.code === 'PT409') return 409;
  if (error.code === '42501' || error.code === 'PT403') return 403;
  if (error.code === 'PT401' || error.status === 401) return 401;
  if (error.code === 'PGRST116' || error.code === 'PT404') return 404;
  if (error.code === '42P01' || error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST205') return 503;
  if (error.code === '22023' || error.code === '23514' || error.code === '22P02' || error.code === 'PT400') return 400;
  return error.status && error.status >= 400 && error.status <= 599 ? error.status : 500;
}

export function readableError(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : { message: String(error) }) as BackendError;
  const message = e.message || '';
  if (e.code === 'PT409' || /VERSION_CONFLICT/.test(message)) return '다른 기기에서 변경된 기록입니다. 최신 기록과 비교한 뒤 다시 저장하세요.';
  if (/Invalid login credentials/i.test(message) || e.code === 'invalid_credentials') return '아이디 또는 이메일과 비밀번호를 확인하세요.';
  if (/Email not confirmed/i.test(message) || e.code === 'email_not_confirmed') return '서버의 이메일 인증 설정으로 로그인이 차단되었습니다. 관리자에게 가입 설정 확인을 요청하세요. 업무 자료는 관리자 승인 후 이용할 수 있습니다.';
  if (/already registered|already been registered/i.test(message) || e.code === 'user_already_exists') return '이미 가입된 이메일입니다. 로그인 화면에서 접속하세요.';
  if (/rate limit|too many requests|over_email_send_rate_limit|over_request_rate_limit/i.test(`${e.code} ${message}`)) return '요청이 많습니다. 잠시 후 다시 시도하세요.';
  if (/Password should|weak password/i.test(message) || e.code === 'weak_password') return '비밀번호는 8자 이상으로 입력하고 안내된 비밀번호 기준을 확인하세요.';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.';
  if (statusFor(e) === 503) return '데이터 저장소 설치가 필요합니다. 관리자에게 Supabase 설정을 확인해 달라고 요청하세요.';
  if (statusFor(e) === 403 || /NOT_APPROVED|APPROVAL_REQUIRED|FORBIDDEN|ADMIN_REQUIRED|not approved|administrator required/i.test(message)) return '승인된 계정 또는 관리자 권한이 필요합니다.';
  if (/JWT|session.*missing|Auth session missing/i.test(message)) return '로그인 시간이 만료되었습니다. 다시 로그인하세요.';
  // The database raises readable Korean validation messages. Avoid exposing
  // internal SQL errors or table names through unexpected PostgreSQL messages.
  if (/[가-힣]/.test(message)) return message.slice(0, 400);
  if (e.code === '22023' || e.code === '23514' || e.code === '22P02') return '입력값을 확인하세요. 필요한 항목과 자료 형식을 다시 확인하세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
}

function errorResponse(error: BackendError) {
  let latest: unknown;
  if (error.code === 'PT409' && error.details) {
    try { latest = JSON.parse(error.details); } catch { /* Older versions may not include the latest record. */ }
  }
  return response({ error: readableError(error), ...(latest ? { record: latest } : {}) }, statusFor(error));
}

async function signedInUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw { code: 'PT401', message: '로그인이 필요합니다.' } satisfies BackendError;
  return data.user;
}

async function validatedPhoto(file: File) {
  if (!file.size || file.size > MAX_PHOTO_SIZE) throw { code: 'PT400', message: '사진은 파일당 5MB 이하로 선택하세요.' } satisfies BackendError;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (values: number[], offset = 0) => values.every((value, index) => bytes[index + offset] === value);
  let mime = '';
  if (starts([0xff, 0xd8, 0xff])) mime = 'image/jpeg';
  else if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mime = 'image/png';
  else if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) mime = 'image/webp';
  if (!mime || (file.type && file.type !== mime)) throw { code: 'PT400', message: '실제 JPG·PNG·WebP 사진 파일을 선택하세요.' } satisfies BackendError;
  return mime;
}

/** Explicit adapter for the previous UI's request contract. Does not modify fetch. */
export async function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const method = (init.method || 'GET').toUpperCase();
    const user = await signedInUser();
    if (path === '/data.json' && method === 'GET') {
      const cached = seedCache.get(user.id);
      if (cached && Date.now() - cached.loadedAt < 60_000) return response(cached.payload);
      const { data, error } = await supabase.from('hdc_v2_seed').select('payload,updated_at').eq('key', 'factory').maybeSingle();
      if (error) return errorResponse(error);
      if (!data?.payload) return response({ error: '공장 기준자료가 아직 등록되지 않았습니다. 관리자가 비공개 seed-data.json을 등록해야 합니다.' }, 404);
      const payload={...data.payload,workorders:(data.payload.workorders||[]).map((p:JsonObject)=>({...p,id:canonicalPlanId(String(p.id))}))};
      seedCache.set(user.id, { payload: payload as JsonObject, loadedAt: Date.now() });
      return response(payload);
    }
    if (path === '/api/records' && method === 'GET') {
      const records: unknown[] = [];
      const pageSize = 500;
      let start = 0;
      for (;;) {
        const { data, error } = await supabase.from('hdc_v2_records').select('body,owner_id').order('updated_at', { ascending: false }).order('id', { ascending: true }).range(start, start + pageSize - 1);
        if (error) return errorResponse(error);
        records.push(...(data || []).map((row) => canonicalPlanRecord(row.body)));
        if (activeAccount === user.id) (data || []).forEach((row) => {
          if (row.body?.id && typeof row.owner_id === 'string') recordOwners.set(row.body.id, row.owner_id);
        });
        if (!data || data.length < pageSize) break;
        start += pageSize;
      }
      return response({ records });
    }
    if (path === '/api/records' && method === 'POST') {
      let parsed: { record?: unknown };
      try {
        if (typeof init.body !== 'string' || new Blob([init.body]).size > 256 * 1024) return response({ error: '올바른 크기의 JSON 기록을 전송하세요.' }, 400);
        parsed = JSON.parse(init.body) as { record?: unknown };
      } catch { return response({ error: '기록 JSON 형식을 확인하세요.' }, 400); }
      if (!parsed.record || typeof parsed.record !== 'object') return response({ error: '저장할 기록이 없습니다.' }, 400);
      const { data, error } = await supabase.rpc('hdc_v2_save_record', { p_record: canonicalPlanRecord(parsed.record as JsonObject) });
      if (error) return errorResponse(error);
      if (activeAccount === user.id && data?.id && !recordOwners.has(data.id)) recordOwners.set(data.id, user.id);
      return response({ record: data });
    }
    if (path === '/api/photos' && method === 'POST') {
      const file = init.body instanceof FormData ? init.body.get('file') : null;
      if (!(file instanceof File)) return response({ error: '사진 파일을 선택하세요.' }, 400);
      const mime = await validatedPhoto(file);
      const id = crypto.randomUUID();
      const objectPath = `${user.id}/${id}`;
      const uploaded = await supabase.storage.from(PHOTO_BUCKET).upload(objectPath, file, { contentType: mime, cacheControl: '0', upsert: false });
      if (uploaded.error) return errorResponse(uploaded.error);
      const registered = await supabase.rpc('hdc_v2_register_photo', { p_id: id, p_mime_type: mime, p_size: file.size });
      if (registered.error) {
        // Cleanup is best-effort. A restrictive storage policy may leave an
        // unregistered object for an operator to clean up later.
        await supabase.storage.from(PHOTO_BUCKET).remove([objectPath]).catch(() => undefined);
        return errorResponse(registered.error);
      }
      return response({ photo: registered.data }, 201);
    }
    return response({ error: '지원하지 않는 요청입니다.' }, 404);
  } catch (error) {
    return errorResponse(error as BackendError);
  }
}

export async function getPhotoUrl(id: string): Promise<string> {
  if (!UUID.test(id)) throw new Error('올바른 사진 식별자가 아닙니다.');
  const user = await signedInUser();
  const cacheKey = `${user.id}:${id}`;
  const cached = photoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data: photo, error } = await supabase.from('hdc_v2_photos').select('object_path').eq('id', id).maybeSingle();
  if (error) throw new Error(readableError(error));
  if (!photo?.object_path) throw new Error('사진을 찾을 수 없거나 조회 권한이 없습니다.');
  const result = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(photo.object_path, 15 * 60);
  if (result.error || !result.data?.signedUrl) throw new Error(readableError(result.error));
  photoCache.set(cacheKey, { url: result.data.signedUrl, expiresAt: Date.now() + 11 * 60 * 1000 });
  return result.data.signedUrl;
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireArray(parent: JsonObject, key: string, max = 20_000): unknown[] {
  const value = parent[key];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${key} 자료 형식 또는 수록 건수를 확인하세요.`);
  return value;
}

function requireStrings(value: unknown, fields: string[], label: string): asserts value is JsonObject {
  if (!object(value) || fields.some((key) => typeof value[key] !== 'string')) throw new Error(`${label}의 필수 항목을 확인하세요.`);
}

/** Validate every consumed seed collection before any administrator upload. */
export function validateSeed(value: unknown): asserts value is JsonObject {
  if (!object(value) || !object(value.meta) || !object(value.costSummary)) throw new Error('이 앱의 전체 기준자료 JSON을 선택하세요.');
  if (typeof value.meta.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.meta.asOf)) throw new Error('기준자료의 기준일을 확인하세요.');
  const equipment = requireArray(value, 'equipment', 5_000);
  const workorders = requireArray(value, 'workorders', 5_000);
  const checklists = requireArray(value, 'checklists', 5_000);
  const ledger = requireArray(value, 'ledger');
  const kpis = requireArray(value, 'kpiTargets', 500);
  const sources = requireArray(value, 'sources', 5_000);
  if (!equipment.length || !workorders.length || !checklists.length || !ledger.length) throw new Error('설비·계획·점검표·원장이 모두 포함된 기준자료를 선택하세요.');
  const equipmentIds = new Set<string>();
  equipment.forEach((entry) => {
    requireStrings(entry, ['id', 'name', 'grade'], '설비 자료');
    if (!entry.id || equipmentIds.has(entry.id as string)) throw new Error('설비 관리번호가 비어 있거나 중복되었습니다.');
    equipmentIds.add(entry.id as string);
  });
  workorders.forEach((entry) => {
    requireStrings(entry, ['id', 'equipment', 'equipmentName', 'title', 'cycle', 'criteria', 'method', 'grade', 'materials', 'estimatedCost', 'evidence'], '예방정비 계획');
    if (!object(entry.source) || typeof entry.source.sheet !== 'string' || typeof entry.source.row !== 'number') throw new Error('예방정비 계획의 원본 시트와 행 정보를 확인하세요.');
    const items = requireArray(entry, 'checklist', 100);
    if (!items.length) throw new Error('계획별 점검항목이 누락되었습니다.');
    items.forEach((item) => requireStrings(item, ['name', 'criteria'], '계획별 점검항목'));
  });
  checklists.forEach((entry) => {
    requireStrings(entry, ['id', 'equipment', 'title', 'cycle'], '표준 점검표');
    requireArray(entry, 'items', 100).forEach((item) => requireStrings(item, ['id', 'name', 'criteria'], '점검표 항목'));
  });
  let ledgerTotal = 0;
  const yearTotals = new Map<number, { amount: number; count: number }>();
  ledger.forEach((entry) => {
    requireStrings(entry, ['id', 'date', 'category', 'title'], '수선원장');
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || typeof entry.year !== 'number' || !Number.isInteger(entry.year)) throw new Error('원장 금액과 연도를 확인하세요.');
    ledgerTotal += entry.amount;
    const bucket = yearTotals.get(entry.year) || { amount: 0, count: 0 };
    bucket.amount += entry.amount;
    bucket.count++;
    yearTotals.set(entry.year, bucket);
  });
  const summary = value.costSummary;
  if (summary.totalCount !== ledger.length || typeof summary.totalAmount !== 'number' || Math.abs(summary.totalAmount - ledgerTotal) > 0.01) throw new Error('원장 행 수 또는 합계가 요약 집계와 일치하지 않습니다.');
  const series = requireArray(summary, 'series', 200);
  const seriesYears = new Set<number>();
  series.forEach((entry) => {
    if (!object(entry) || typeof entry.year !== 'number' || typeof entry.amount !== 'number' || typeof entry.count !== 'number') throw new Error('연도별 수선비 집계 형식을 확인하세요.');
    const expected = yearTotals.get(entry.year);
    if (!expected || seriesYears.has(entry.year) || expected.count !== entry.count || Math.abs(expected.amount - entry.amount) > 0.01) throw new Error('연도별 집계가 원장 자료와 일치하지 않습니다.');
    seriesYears.add(entry.year);
  });
  if (seriesYears.size !== yearTotals.size) throw new Error('일부 연도의 수선비 집계가 누락되었습니다.');
  kpis.forEach((entry) => requireStrings(entry, ['name', 'formula', 'baseline', 'year1', 'year3'], 'KPI 목표'));
  sources.forEach((entry) => requireStrings(entry, ['id', 'path'], '원본 출처'));
  if (!Array.isArray(value.meta.notes) || value.meta.notes.some((note) => typeof note !== 'string')) throw new Error('기준자료 확인 사항을 확인하세요.');
}


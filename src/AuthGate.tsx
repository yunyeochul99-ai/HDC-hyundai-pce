import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { clearAuthenticatedCaches, getPhotoUrl, invalidateSeedCache, readableError, setAccessProfile, supabase, validateSeed, type Profile } from './backend';
import './auth.css';
import BrandLogo from './BrandLogo';

export type AuthContext = {
  user: User;
  profile: Profile;
  signOut: () => Promise<void>;
  openAdmin: () => void;
  openAccount: () => void;
};

type PhotoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'id'> & { id: string };

const ADMIN_SERVER = 'https://supabase.com/dashboard/project/pcaporgqhzzwzfgkxars';
const isRealEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/@hdc-pce\.netlify\.app$/i.test(value);

function passwordError(failure: unknown) {
  const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : '';
  if (code === 'same_password') return '현재 비밀번호와 다른 새 비밀번호를 입력하세요.';
  if (code === 'reauthentication_needed' || code === 'reauthentication_not_valid') return '본인 확인이 만료되었습니다. 다시 로그인한 뒤 비밀번호를 변경하세요.';
  return readableError(failure);
}

const RECOVERY_ACCOUNT_KEY = 'hdc-pce-password-recovery-account';
function rememberRecoveryAccount(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(RECOVERY_ACCOUNT_KEY, id);
    else window.sessionStorage.removeItem(RECOVERY_ACCOUNT_KEY);
  } catch { /* Recovery still works when browser storage is unavailable. */ }
}

function PasswordRecoveryPanel({ user, onDone, onSignOut }: { user: User; onDone: () => void; onSignOut: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (password.length < 8 || password.length > 128) { setError('새 비밀번호는 8~128자로 입력하세요.'); return; }
    if (password !== confirmation) { setError('새 비밀번호와 확인 입력이 일치하지 않습니다.'); return; }
    setBusy(true);
    try {
      const current = await supabase.auth.getUser();
      if (current.error) throw current.error;
      if (current.data.user.id !== user.id) throw new Error('로그인 계정이 변경되었습니다. 재설정 메일을 다시 요청하세요.');
      const updated = await supabase.auth.updateUser({ password });
      if (updated.error) throw updated.error;
      if (!updated.data.user || updated.data.user.id !== user.id) throw new Error('비밀번호 변경 결과를 확인하지 못했습니다. 다시 로그인해 확인하세요.');
      setPassword('');
      setConfirmation('');
      setComplete(true);
      rememberRecoveryAccount(null);
    } catch (failure) { setError(passwordError(failure)); }
    finally { setBusy(false); }
  };
  const exit = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try { await onSignOut(); }
    catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-card auth-recovery-card">
    <BrandLogo className="status-logo" /><span className="auth-eyebrow">PASSWORD RESET</span>
    <h2>{complete ? '비밀번호를 변경했습니다' : '새 비밀번호 설정'}</h2>
    {complete ? <><p role="status">다음 로그인부터 새 비밀번호를 사용하세요. 업무 자료는 기존 승인 상태에 따라 표시됩니다.</p><button type="button" className="auth-primary auth-full" onClick={onDone}>업무 화면으로</button></> : <>
      <p>재설정 메일로 확인한 계정의 새 비밀번호를 입력하세요.</p>
      <form onSubmit={submit}>
        <input type="text" name="username" autoComplete="username" value={user.email || ''} readOnly hidden />
        <label>새 비밀번호<input type="password" autoComplete="new-password" name="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} placeholder="8자 이상 입력" /></label>
        <label>새 비밀번호 확인<input type="password" autoComplete="new-password" name="confirm-password" required minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
        <button className="auth-primary auth-full" disabled={busy}>{busy ? '변경 중…' : '새 비밀번호 저장'}</button>
      </form>
    </>}
    {error && <p className="auth-error auth-recovery-error" role="alert">{error}</p>}
    <button type="button" className="auth-secondary auth-full auth-recovery-exit" disabled={busy} onClick={() => void exit()}>로그아웃</button>
  </section></main>;
}

export function Photo({ id, alt = '현장 기록 사진', ...props }: PhotoProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setUrl('');
    setError('');
    const load = async () => {
      try {
        const signedUrl = await getPhotoUrl(id);
        if (!alive) return;
        setUrl(signedUrl);
        setError('');
        timer = setTimeout(load, 12 * 60 * 1000);
      } catch (failure) {
        if (alive) setError(failure instanceof Error ? failure.message : '사진을 불러오지 못했습니다.');
      }
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
  if (error) return <span className="auth-photo-message" role="status">{error}</span>;
  if (!url) return <span className="auth-photo-message">사진을 불러오는 중…</span>;
  return <a href={url} target="_blank" rel="noreferrer"><img {...props} src={url} alt={alt} onError={() => setError('사진을 표시하지 못했습니다. 잠시 후 다시 열어 주세요.')} /></a>;
}

export function AdminPanel({ onClose, onProfileChanged }: { onClose: () => void; onProfileChanged?: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploaded, setUploaded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadProfiles = async () => {
    setError('');
    const result = await supabase.rpc('hdc_v2_list_profiles');
    if (result.error) setError(readableError(result.error));
    else setProfiles(Array.isArray(result.data) ? result.data as Profile[] : []);
  };
  useEffect(() => { void loadProfiles(); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const approve = async (profile: Profile) => {
    if (busy) return;
    setBusy(profile.id);
    setError('');
    setNotice('');
    try {
      const result = await supabase.rpc('hdc_v2_set_approval', { p_user_id: profile.id, p_approved: !profile.approved });
      if (result.error) throw result.error;
      await loadProfiles();
      onProfileChanged?.();
      setNotice(`${profile.display_name || '선택한 계정'}의 승인을 ${profile.approved ? '해제' : '완료'}했습니다.`);
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(''); }
  };
  const uploadSeed = async (file: File) => {
    if (busy) return;
    setBusy('seed');
    setError('');
    setNotice('');
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('기준자료는 4MB 이하의 JSON 파일을 선택하세요.');
      let payload: unknown;
      try { payload = JSON.parse(await file.text()); } catch { throw new Error('올바른 JSON 기준자료를 선택하세요.'); }
      validateSeed(payload);
      const result = await supabase.rpc('hdc_v2_import_seed', { p_payload: payload });
      if (result.error) throw result.error;
      invalidateSeedCache();
      window.dispatchEvent(new Event('hdc-v2-seed-updated'));
      setUploaded(true);
      setNotice('공장 기준자료를 등록했습니다. 업무 화면을 새로고침하면 적용됩니다.');
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(''); if (fileInput.current) fileInput.current.value = ''; }
  };
  return <div className="auth-admin-overlay"><section className="auth-admin" role="dialog" aria-modal="true" aria-labelledby="auth-admin-title" ref={panel} onKeyDown={(event) => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key === 'Tab') {
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([type="hidden"]),a[href]') || []).filter((element) => element.offsetParent !== null);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><header className="auth-admin-head"><div><span className="auth-eyebrow">ADMINISTRATION</span><h2 id="auth-admin-title">계정 승인과 기준자료</h2></div><button className="auth-icon-button" type="button" onClick={onClose} disabled={!!busy} aria-label="관리자 화면 닫기">×</button></header><div className="auth-admin-body"><section className="auth-server-management"><h3>로그인·사진 관리 서버</h3><p>가입 계정과 로그인 차단은 Supabase에서, 업무 자료 접근은 사용자 승인에서 관리합니다. 내 비밀번호는 계정 설정에서 변경할 수 있습니다.</p><div className="auth-server-links"><a className="auth-primary" href={`${ADMIN_SERVER}/auth/users`} target="_blank" rel="noreferrer">Supabase에서 계정·비밀번호 관리 ↗</a><a className="auth-secondary" href={`${ADMIN_SERVER}/editor`} target="_blank" rel="noreferrer">가입 승인 관리 ↗</a><a className="auth-secondary" href={`${ADMIN_SERVER}/storage/files`} target="_blank" rel="noreferrer">사진 보관함 열기 ↗</a></div><p className="auth-fine">관리 서버: pcaporgqhzzwzfgkxars · Supabase 운영자 로그인이 필요합니다. Users에서 계정을 선택해 로그인 상태를 관리할 수 있습니다. 이메일 재설정은 운영용 SMTP 연결 후 사용하세요. 기존 아이디형 계정(@hdc-pce.netlify.app)은 메일을 받을 수 없으므로 본인이 로그인해 내 계정 설정에서 변경하거나 운영자에게 문의하세요.</p><p className="auth-fine">업무 자료 접근은 아래 사용자 승인에서 관리하세요. 서버에서 직접 관리할 때는 Table Editor → hdc_v2_profiles에서 해당 계정의 approved 값을 변경합니다. 관리자 역할은 운영자만 관리합니다. 사진 파일은 Users가 아닌 Storage에서 확인합니다.</p></section><section><h3>공장 기준자료 등록</h3><p>비공개 패키지의 seed-data.json을 선택하세요. 기존 기준자료를 교체하며 실제 점검·작업 기록은 유지합니다.</p><input type="file" accept=".json,application/json" ref={fileInput} disabled={!!busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSeed(file); }} /><p className="auth-fine">자료는 승인된 공장 팀 계정이 조회합니다. 공개 GitHub와 Netlify 정적 파일에 원본 JSON을 넣지 않습니다.</p>{uploaded && <button className="auth-primary" type="button" onClick={() => window.location.reload()}>업무 화면 새로고침</button>}</section><section><div className="auth-admin-section-title"><h3>사용자 승인</h3><button className="auth-secondary" type="button" disabled={!!busy} onClick={() => void loadProfiles()}>목록 새로고침</button></div><p>승인한 계정은 공장 팀 자료를 조회하고 운영 기록을 작성합니다. 관리자 역할 변경은 DB 운영자가 관리합니다.</p><div className="auth-profile-list">{profiles.map((profile) => <div className="auth-profile-row" key={profile.id}><div><b>{profile.display_name || '이름 미등록'}</b><small>계정 {profile.id.slice(0, 8)} · {profile.is_admin ? '관리자' : profile.approved ? '승인됨' : '승인 대기'}</small></div><button className={profile.approved ? 'auth-secondary' : 'auth-primary'} type="button" disabled={!!busy || profile.is_admin} onClick={() => void approve(profile)}>{busy === profile.id ? '처리 중…' : profile.is_admin ? '관리자' : profile.approved ? '승인 해제' : '승인'}</button></div>)}{profiles.length === 0 && <p className="auth-fine">조회할 계정이 없습니다. 목록을 새로고침하거나 설치 상태를 확인하세요.</p>}</div></section>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-success" role="status">{notice}</p>}{busy === 'seed' && <p role="status">기준자료를 확인하고 등록하는 중…</p>}</div></section></div>;
}

function AccountPanel({ user, profile, onClose, onSaved, signOut }: { user: User; profile: Profile; onClose: () => void; onSaved: (profile: Profile) => void; signOut: () => Promise<void> }) {
  const [name, setName] = useState(profile.display_name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<'name' | 'password' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    const value = name.trim();
    if (!value || value.length > 100) { setError('표시 이름은 1~100자로 입력하세요.'); return; }
    setBusy('name');
    try {
      const result = await supabase.rpc('hdc_v2_set_display_name', { p_display_name: value });
      if (result.error) throw result.error;
      onSaved(result.data as Profile);
      setNotice('표시 이름을 저장했습니다.');
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(''); }
  };
  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    if (!currentPassword) { setError('현재 비밀번호를 입력하세요.'); return; }
    if (nextPassword.length < 8 || nextPassword.length > 128) { setError('새 비밀번호는 8~128자로 입력하세요.'); return; }
    if (nextPassword !== confirmPassword) { setError('새 비밀번호와 확인 입력이 일치하지 않습니다.'); return; }
    if (nextPassword === currentPassword) { setError('현재 비밀번호와 다른 새 비밀번호를 입력하세요.'); return; }
    if (!user.email) { setError('로그인한 이메일을 확인할 수 없습니다. 다시 로그인하세요.'); return; }
    setBusy('password');
    try {
      const verified = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (verified.error) throw verified.error;
      if (verified.data.user.id !== user.id) throw new Error('로그인 계정이 변경되었습니다. 다시 로그인하세요.');
      const current = await supabase.auth.getUser();
      if (current.error) throw current.error;
      if (current.data.user.id !== user.id) throw new Error('로그인 계정이 변경되었습니다. 다시 로그인하세요.');
      const updated = await supabase.auth.updateUser({ password: nextPassword });
      if (updated.error) throw updated.error;
      if (!updated.data.user || updated.data.user.id !== user.id) throw new Error('비밀번호 변경 결과를 확인하지 못했습니다. 다시 로그인해 확인하세요.');
      setNextPassword('');
      setConfirmPassword('');
      setNotice('비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.');
    } catch (failure) { setError(passwordError(failure)); }
    finally { setCurrentPassword(''); setBusy(''); }
  };
  const exit = async () => {
    if (busy) return;
    setError('');
    setBusy('name');
    try { await signOut(); }
    catch (failure) { setError(readableError(failure)); }
    finally { setBusy(''); }
  };
  return <div className="auth-admin-overlay"><section className="auth-admin auth-account-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="auth-account-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key === 'Tab') {
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || []).filter((element) => element.offsetParent !== null);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="auth-admin-head"><div><span className="auth-eyebrow">MY ACCOUNT</span><h2 id="auth-account-title">내 계정 설정</h2></div><button className="auth-icon-button" type="button" disabled={!!busy} onClick={onClose} aria-label="계정 설정 닫기">×</button></header>
    <div className="auth-admin-body">
      <form className="auth-account-form" onSubmit={saveName}>
        <h3>표시 이름</h3>
        <label>이름<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" disabled={!!busy} /></label>
        <p className="auth-fine">업무 화면에 표시할 이름을 저장합니다.</p>
        <button className="auth-primary" disabled={!!busy}>{busy === 'name' ? '저장 중…' : '이름 저장'}</button>
      </form>
      <form className="auth-account-form auth-password-form" onSubmit={savePassword}>
        <h3>내 비밀번호 변경</h3>
        <p>현재 비밀번호로 본인을 확인한 뒤 새 비밀번호를 저장합니다.</p>
        <input type="text" name="username" autoComplete="username" value={user.email || ''} readOnly hidden />
        <label>현재 비밀번호<input type="password" name="current-password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={!!busy} /></label>
        <label>새 비밀번호<input type="password" name="new-password" autoComplete="new-password" required minLength={8} maxLength={128} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} disabled={!!busy} placeholder="8자 이상 입력" /></label>
        <label>새 비밀번호 확인<input type="password" name="confirm-password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={!!busy} /></label>
        <button className="auth-primary" disabled={!!busy}>{busy === 'password' ? '변경 중…' : '비밀번호 변경'}</button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-success" role="status">{notice}</p>}
      <div className="auth-button-row"><button type="button" className="auth-secondary" disabled={!!busy} onClick={() => void exit()}>로그아웃</button><button type="button" className="auth-secondary" disabled={!!busy} onClick={onClose}>닫기</button></div>
    </div>
  </section></div>;
}
export default function AuthGate({ children }: { children: (context: AuthContext) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [recoveryAccount, setRecoveryAccount] = useState<string | null>(() => {
    try { return window.sessionStorage.getItem(RECOVERY_ACCOUNT_KEY); } catch { return null; }
  });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useRef<string | null>(null);
  const profileRequest = useRef(0);
  const mounted = useRef(true);

  const loadProfile = async (id: string, block = true) => {
    const requestId = ++profileRequest.current;
    if (block) setLoading(true);
    const result = await supabase.from('hdc_v2_profiles').select('id,display_name,approved,is_admin,created_at').eq('id', id).maybeSingle();
    if (!mounted.current || requestId !== profileRequest.current || account.current !== id) return;
    if (result.error) { setError(readableError(result.error)); setProfile(null); setAccessProfile(null); }
    else {
      setProfile(result.data as Profile | null);
      setAccessProfile(result.data as Profile | null);
      setError(result.data ? '' : '승인 프로필이 없습니다. 관리자에게 계정 프로필 등록을 요청하세요.');
    }
    setLoading(false);
  };

  useEffect(() => {
    mounted.current = true;
    let authSequence = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const acceptSession = (next: Session | null) => {
      if (!mounted.current) return;
      const changed = account.current !== (next?.user.id ?? null);
      if (changed || !next) { clearAuthenticatedCaches(); setProfile(null); setAdminOpen(false); setAccountOpen(false); }
      if (!next) { setRecoveryAccount(null); rememberRecoveryAccount(null); }
      else setRecoveryAccount((id) => {
        if (id && id !== next.user.id) { rememberRecoveryAccount(null); return null; }
        return id;
      });
      account.current = next?.user.id ?? null;
      setSession(next);
      if (next) void loadProfile(next.user.id, changed);
      else { ++profileRequest.current; setLoading(false); }
    };
    const subscription = supabase.auth.onAuthStateChange((event, next) => {
      ++authSequence;
      if (event === 'PASSWORD_RECOVERY' && next) {
        rememberRecoveryAccount(next.user.id);
        setRecoveryAccount(next.user.id);
        setAdminOpen(false);
        setAccountOpen(false);
        setPassword('');
        setError('');
        setNotice('');
      }
      // Never await Supabase calls inside onAuthStateChange's session lock.
      const timer = setTimeout(() => { timers.delete(timer); acceptSession(next); }, 0);
      timers.add(timer);
    });
    const initialSequence = authSequence;
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!mounted.current || authSequence !== initialSequence) return;
      if (authError) { setError(readableError(authError)); setLoading(false); }
      else acceptSession(data.session);
    }).catch((failure: unknown) => { if (mounted.current) { setError(readableError(failure)); setLoading(false); } });
    const poll = setInterval(() => { if (account.current) void loadProfile(account.current, false); }, 30_000);
    return () => {
      mounted.current = false;
      ++profileRequest.current;
      subscription.data.subscription.unsubscribe();
      clearInterval(poll);
      timers.forEach(clearTimeout);
    };
  }, []);

  const signOut = async (propagate = false) => {
    try {
      const result = await supabase.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
      clearAuthenticatedCaches();
      setAdminOpen(false);
      setAccountOpen(false);
      setRecoveryAccount(null);
      rememberRecoveryAccount(null);
    } catch (failure) { setError(readableError(failure)); if (propagate) throw failure; }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = identifier.trim();
      if (mode === 'reset') {
        if (!isRealEmail(value)) throw new Error('메일을 받을 수 있는 실제 이메일을 입력하세요. 기존 아이디형 계정은 로그인 후 내 계정 설정에서 변경하거나 운영자에게 문의하세요.');
        const result = await supabase.auth.resetPasswordForEmail(value, { redirectTo: window.location.origin });
        if (result.error) throw result.error;
        setNotice('등록된 이메일이면 재설정 링크가 발송됩니다. 받은편지함과 스팸함을 확인하세요. 메일이 오지 않으면 운영자에게 문의하세요.');
      } else if (mode === 'signup') {
        if (!isRealEmail(value)) throw new Error('새 계정은 본인의 실제 이메일로 가입하세요.');
        if (!displayName.trim()) throw new Error('이름을 입력하세요.');
        if (password.length < 8) throw new Error('비밀번호를 8자 이상 입력하세요.');
        const result = await supabase.auth.signUp({ email: value, password, options: { data: { display_name: displayName.trim() }, emailRedirectTo: window.location.origin } });
        if (result.error) throw result.error;
        setNotice(result.data.session ? '가입 요청이 접수되었습니다. 이메일 인증 없이 관리자 승인 후 업무 화면을 사용할 수 있습니다.' : '가입 요청이 접수되었습니다. 관리자 승인 후 로그인하세요. 이메일 인증 안내가 계속 나오면 관리자에게 서버의 가입 설정을 확인해 달라고 요청하세요.');
        setPassword('');
      } else {
        const email = value.includes('@') ? value : `${value.toLowerCase()}@hdc-pce.netlify.app`;
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        setPassword('');
      }
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); }
  };

  if (session && recoveryAccount === session.user.id) return <PasswordRecoveryPanel user={session.user} onSignOut={() => signOut(true)} onDone={() => { setRecoveryAccount(null); rememberRecoveryAccount(null); void loadProfile(session.user.id); }} />;
  if (loading) return <main className="auth-screen"><section className="auth-card auth-status-card"><BrandLogo className="status-logo" /><h1>설비보전 업무 공간</h1><p>로그인과 계정 승인을 확인하고 있습니다.</p></section></main>;
  const accountPanel = session && profile && accountOpen ? <AccountPanel user={session.user} profile={profile} onClose={() => setAccountOpen(false)} signOut={() => signOut(true)} onSaved={(saved) => { setProfile(saved); setAccessProfile(saved); }} /> : null;
  const displayedProfile = profile;
  if (session && profile?.approved === true && displayedProfile) return <>{children({ user: session.user, profile: displayedProfile, signOut, openAdmin: () => { if (profile.is_admin === true) setAdminOpen(true); }, openAccount: () => setAccountOpen(true) })}{adminOpen && profile.is_admin === true && <AdminPanel onClose={() => setAdminOpen(false)} onProfileChanged={() => { if (account.current) void loadProfile(account.current, false); }} />}{accountPanel}</>;
  if (session) return <><main className="auth-screen"><section className="auth-card auth-status-card"><BrandLogo className="status-logo" /><span className="auth-eyebrow">HDC PCE MAINTENANCE</span><h1>{profile ? '관리자 승인 대기' : '계정 확인이 필요합니다'}</h1><p>{profile ? '가입한 계정이 아직 승인되지 않았습니다. 관리자가 승인하면 공장 업무 자료를 사용할 수 있습니다.' : '업무 자료를 열기 위한 계정 프로필을 확인해 주세요.'}</p><div className="auth-account-label">{displayedProfile?.display_name || session.user.email || '로그인한 계정'}</div>{error && <p className="auth-error" role="alert">{error}</p>}<div className="auth-button-row"><button type="button" className="auth-primary" onClick={() => void loadProfile(session.user.id)}>승인 상태 새로고침</button>{profile && <button type="button" className="auth-secondary" onClick={() => setAccountOpen(true)}>계정 설정</button>}<button type="button" className="auth-secondary" onClick={() => void signOut()}>로그아웃</button></div></section></main>{accountPanel}</>;
  const switchMode = (nextMode: 'signin' | 'signup' | 'reset') => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setPassword('');
  };
  return <main className="auth-screen">
    <section className="auth-intro"><div className="auth-brand"><BrandLogo /></div><span className="auth-eyebrow">설비보전 통합관리</span><h1>현장 기록으로<br /><strong>점검과 정비를 이어갑니다.</strong></h1><p>표준 점검과 정비 작업, 설비 이력과 수선비를<br />공장 업무 공간에서 함께 확인하세요.</p><div className="auth-intro-note"><span className="auth-dot" />승인된 공장 팀을 위한 업무 공간</div></section>
    <section className="auth-card">
      <span className="auth-eyebrow">WELCOME TO HDC PCE</span>
      <h2>{mode === 'signin' ? '업무 공간 로그인' : mode === 'signup' ? '계정 가입 요청' : '비밀번호 재설정'}</h2>
      <p>{mode === 'signin' ? '기존 아이디 또는 이메일로 로그인하세요.' : mode === 'signup' ? '실제 이메일로 가입한 뒤 관리자 승인을 받아 주세요.' : '가입할 때 등록한 실제 이메일로 재설정 링크를 요청하세요.'}</p>
      <form onSubmit={submit}>
        {mode === 'signup' && <label>이름<input autoComplete="name" required maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="사용자 이름" disabled={busy} /></label>}
        <label>{mode === 'signin' ? '아이디 또는 이메일' : '이메일'}<input type={mode === 'signin' ? 'text' : 'email'} autoComplete={mode === 'signin' ? 'username' : 'email'} required maxLength={254} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={mode === 'signin' ? '기존 아이디 또는 name@company.com' : 'name@company.com'} disabled={busy} /></label>
        {mode !== 'reset' && <label>비밀번호<input type="password" required autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? '8자 이상 입력' : '비밀번호 입력'} disabled={busy} /></label>}
        {mode === 'reset' && <p className="auth-fine">기존 아이디형 계정(@hdc-pce.netlify.app)은 메일을 받을 수 없습니다. 로그인 후 내 계정 설정에서 변경하거나 운영자에게 문의하세요.</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-success" role="status">{notice}</p>}
        <button className="auth-primary auth-full" disabled={busy}>{busy ? '처리 중…' : mode === 'signin' ? '로그인' : mode === 'signup' ? '가입 요청' : '재설정 메일 요청'}</button>
      </form>
      {mode === 'signin' && <button type="button" className="auth-text-button auth-forgot-password" disabled={busy} onClick={() => switchMode('reset')}>비밀번호를 잊으셨나요?</button>}
      <div className="auth-switch">{mode === 'signin' ? '처음 사용하시나요?' : '이미 계정이 있나요?'}<button type="button" disabled={busy} onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>{mode === 'signin' ? '가입 요청' : '로그인으로 돌아가기'}</button></div>
      <p className="auth-fine">회사 기준자료와 운영 기록은 로그인·승인 후 표시됩니다.</p>
    </section>
  </main>;
}



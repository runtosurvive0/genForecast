import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProcessingOrb } from '@/components/ProcessingOrb';
import { AccountProvider, checkedPrivateWorkspace, type PrivateWorkspace } from '@/lib/account-context';
import { authJson, bindAccount, clearAccountRequests, type Session } from '@/lib/auth-client';
import './auth.css';

export function PasswordChange({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <form className="gf-auth-form" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
    if (data.get('newPassword') !== data.get('confirm')) { setError('비밀번호 확인이 일치하지 않습니다.'); return; }
    setBusy(true); setError('');
    try { await authJson('/api/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) }); form.reset(); clearAccountRequests(); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : '비밀번호 변경 실패'); }
    finally { setBusy(false); }
  }}>
    <label>현재 또는 임시 비밀번호<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
    <label>새 비밀번호<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
    <label>새 비밀번호 확인<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
    <p>8~128자. 변경하면 모든 기기에서 로그아웃됩니다.</p>
    {error && <p role="alert">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</Button>
  </form>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const offline = location.protocol === 'file:';
  const [session, setSession] = useState<Session>({ user: null, scope: null });
  const [workspace, setWorkspace] = useState<PrivateWorkspace | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(!offline), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const [setup, setSetup] = useState(false), [tab, setTab] = useState('login'), [show, setShow] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const refresh = useCallback(async () => {
    const ticket = ++epoch.current;
    setError(''); setChecking(true);
    try {
      const next = await authJson<Session>('/api/auth/session');
      if (ticket !== epoch.current) return;
      bindAccount(next.user?.id ?? null);
      let data: PrivateWorkspace | null = null;
      if (next.scope === 'full' && next.user) {
        data = checkedPrivateWorkspace(await authJson<PrivateWorkspace>('/api/me/vessel-workspace'));
      }
      const bootstrap = await authJson<{ setupRequired: boolean }>('/api/auth/bootstrap-status');
      if (ticket !== epoch.current) return;
      setWorkspace(data);
      setSession(next);
      setSetup(bootstrap.setupRequired);
    } catch { if (ticket === epoch.current) { setSession({ user: null, scope: null }); setWorkspace(null); setError('인증 서버에 연결하지 못했습니다. 서버 실행 상태를 확인해 주세요.'); } }
    finally { if (ticket === epoch.current) setChecking(false); }
  }, []);
  // Session polling never silently activates a pending session; approval requires a new login.
  useEffect(() => {
    if (offline) return;
    let alive = true, activity = false;
    void refresh();
    const invalidate = () => { epoch.current++; clearAccountRequests(); setChecking(false); setWorkspace(null); setSession({ user: null, scope: null }); setNotice('세션이 만료되었거나 계정 상태가 변경되었습니다. 다시 로그인해 주세요.'); };
    const markActivity = () => { activity = true; };
    const timer = setInterval(async () => {
      const ticket = epoch.current;
      try {
        const next = await authJson<Session>('/api/auth/session', { headers: activity ? { 'X-User-Activity': '1' } : {} });
        activity = false;
        if (alive && ticket === epoch.current) setSession(previous => {
          if (previous.user && (!next.user || next.user.id !== previous.user.id || next.user.version !== previous.user.version)) {
            queueMicrotask(invalidate);
          }
          return previous;
        });
      } catch { /* Existing API requests still fail closed when their session is not valid. */ }
    }, 30000);
    window.addEventListener('genforecast-session-invalid', invalidate);
    window.addEventListener('pointerdown', markActivity); window.addEventListener('keydown', markActivity);
    return () => { alive = false; epoch.current++; clearInterval(timer); window.removeEventListener('genforecast-session-invalid', invalidate);
      window.removeEventListener('pointerdown', markActivity); window.removeEventListener('keydown', markActivity); };
  }, [offline, refresh]);
  async function logout() {
    await authJson('/api/auth/logout', { method: 'POST' });
    epoch.current++; clearAccountRequests(); setSession({ user: null, scope: null }); setWorkspace(null); setNotice('로그아웃되었습니다.');
  }
  if (offline) return <>{children}</>;
  if (session.user && session.scope === 'full' && workspace)
    return <AccountProvider key={`${session.user.id}:${session.user.version}`} user={session.user} initial={workspace} logout={logout}>{children}</AccountProvider>;
  const switchTheme = () => { const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'; setTheme(next); document.documentElement.classList.toggle('dark', next === 'dark'); try { localStorage.setItem('ewp-theme', next); } catch {} };
  return <main className="gf-auth-page">
    <div className="gf-auth-top"><span>genForecast</span><Button variant="ghost" size="icon" aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} onClick={switchTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button></div>
    <section className="gf-auth-card" aria-labelledby="auth-title">
      <span className="gf-auth-eyebrow">발전 운영 · 선박 추적</span>
      <h1 id="auth-title">팀의 다음 항해를 함께 준비하세요</h1>
      <p>관리자가 승인한 계정으로 접속합니다. 관심 선박은 계정별로 관리합니다.</p>
      {checking ? <ProcessingOrb theme={theme} state="connecting" label="계정 확인 중" size={32} /> : session.scope === 'pending' ? <div className="gf-auth-pending">
        <h2>관리자 승인 대기 중</h2><p>{session.user?.displayName}님의 가입 신청을 접수했습니다. 승인 후 다시 로그인해 주세요.</p>
        <Button variant="outline" onClick={() => void logout().catch(e => setError(String(e.message)))}>로그아웃</Button>
      </div> : session.scope === 'password_change' ? <><h2>새 비밀번호를 설정해 주세요</h2><PasswordChange onDone={() => { setSession({ user: null, scope: null }); setNotice('비밀번호를 변경했습니다. 다시 로그인해 주세요.'); }} /></> : <>
        <div className="gf-auth-tabs" role="tablist" aria-label="계정 접속">
          {['login', 'register'].map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setError(''); setNotice(''); }}>{t === 'login' ? '로그인' : '회원가입'}</button>)}
        </div>
        <form key={tab} className="gf-auth-form" onSubmit={async e => {
          e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
          if (tab === 'register' && data.get('password') !== data.get('confirm')) { setError('비밀번호 확인이 일치하지 않습니다.'); return; }
          setBusy(true); setError(''); setNotice('');
          try {
            const credentials = { username: data.get('username'), password: data.get('password'), ...(tab === 'register' ? { displayName: data.get('displayName') } : {}) };
            await authJson(`/api/auth/${tab === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(credentials) });
            form.reset();
            if (tab === 'register') { setTab('login'); setNotice('가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.'); }
            else { clearAccountRequests(); await refresh(); }
          } catch (e) { setError(e instanceof Error ? e.message : '요청에 실패했습니다.'); }
          finally { setBusy(false); }
        }}>
          {tab === 'register' && <label>이름<input name="displayName" autoComplete="name" required maxLength={50} /></label>}
          <label>아이디<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} required placeholder="영문·숫자·점·밑줄·하이픈" /></label>
          <label>비밀번호<div className="gf-auth-password"><input name="password" type={show ? 'text' : 'password'} autoComplete={tab === 'register' ? 'new-password' : 'current-password'} minLength={tab === 'register' ? 8 : undefined} maxLength={128} required /><button type="button" aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'} onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          {tab === 'register' && <><label>비밀번호 확인<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><p>비밀번호는 8~128자입니다. 공백과 붙여넣기를 사용할 수 있습니다.</p></>}
          <Button type="submit" disabled={busy}>{busy ? '처리 중…' : tab === 'register' ? '가입 신청' : '로그인'}</Button>
        </form>
      </>}
      {notice && <p role="status" className="gf-auth-notice">{notice}</p>}
      {error && <div role="alert" className="gf-auth-error">{error}{error.includes('인증 서버') && <Button variant="ghost" onClick={() => void refresh()}>연결 다시 확인</Button>}</div>}
      {setup && <aside className="gf-auth-setup">최초 관리자 설정이 필요합니다. 서버에서 <code>python -m midterm admin init</code>을 실행해 주세요.</aside>}
      <small>비밀번호를 잊었다면 서버 관리자에게 복구를 요청해 주세요.</small>
    </section>
  </main>;
}

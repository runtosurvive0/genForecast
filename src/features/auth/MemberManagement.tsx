import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccount } from '@/lib/account-context';
import { authJson, type Account } from '@/lib/auth-client';

const statuses = { pending: '승인 대기', active: '사용 중', rejected: '거절', suspended: '정지' };
export function MemberManagement() {
  const account = useAccount();
  const [status, setStatus] = useState('pending'), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [users, setUsers] = useState<Account[]>([]), [more, setMore] = useState(false), [revision, setRevision] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const [roleTarget, setRoleTarget] = useState<Account | null>(null);
  useEffect(() => {
    if (account?.user.role !== 'admin') return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setError('');
      void authJson<{ users: Account[]; hasMore: boolean }>(`/api/admin/users?status=${status}&q=${encodeURIComponent(query)}&page=${page}`, { signal: abort.signal })
        .then(v => { if (!abort.signal.aborted) { setUsers(v.users); setMore(v.hasMore); } })
        .catch(e => { if (!abort.signal.aborted) setError(e.message); });
    }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [account?.user.role, status, query, page, revision]);
  if (!account) return null;
  if (account.user.role !== 'admin') return <p className="gf-account-status">승인된 회원으로 접속 중입니다. 공용 원장 저장·서버 계산 실행·회원 관리는 관리자만 할 수 있습니다.</p>;
  async function action(user: Account, value: string, role?: string) {
    setBusy(user.id); setError(''); setNotice('');
    try { await authJson(`/api/admin/users/${user.id}/actions`, { method: 'POST', body: JSON.stringify({ action: value, version: user.version, ...(role ? { role } : {}) }) }); setNotice(`${user.displayName}님의 계정 변경을 반영했습니다.`); setRevision(v => v + 1); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '계정 변경 실패'); return false; }
    finally { setBusy(''); }
  }
  return <section className="gf-members" aria-label="회원 관리"><header><div><h2>회원 관리</h2><p>가입 신청을 검토하고 팀 접근 권한을 관리합니다.</p></div><Button variant="outline" size="sm" onClick={() => setRevision(v => v + 1)}>회원 목록 새로고침</Button></header>
    <div className="gf-auth-tabs" role="tablist" aria-label="회원 상태">{Object.entries(statuses).map(([value, label]) => <button key={value} role="tab" aria-selected={status === value} onClick={() => { setStatus(value); setPage(0); }}>{label}</button>)}</div>
    <label className="gf-member-search">이름·아이디 검색<input value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="gf-member-list">{users.map(user => <article key={user.id}><div><strong>{user.displayName}</strong><span>{user.username} · {user.role === 'admin' ? '관리자' : '회원'} · {statuses[user.status]}</span><small>신청 {new Date(user.createdAt * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</small></div>
      {user.id !== account.user.id && <div className="gf-member-actions">
        {user.status === 'pending' && <><Button size="sm" disabled={busy === user.id} onClick={() => void action(user, 'approve')}>승인</Button><Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => void action(user, 'reject')}>거절</Button></>}
        {user.status === 'active' && <><Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => void action(user, 'suspend')}>이용 정지</Button><Button size="sm" variant="ghost" onClick={() => setRoleTarget(user)}>{user.role === 'user' ? '관리자 승격' : '회원으로 변경'}</Button></>}
        {user.status === 'suspended' && <Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => void action(user, 'restore')}>정지 해제</Button>}
        {user.status === 'rejected' && <Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => void action(user, 'reopen')}>재심사</Button>}
      </div>}</article>)}</div>
    {!users.length && !error && <p>해당 상태의 회원이 없습니다.</p>}
    {(page > 0 || more) && <div className="gf-member-actions"><Button variant="ghost" disabled={!page} onClick={() => setPage(v => v - 1)}>이전</Button><span>{page + 1} 페이지</span><Button variant="ghost" disabled={!more} onClick={() => setPage(v => v + 1)}>다음</Button></div>}
    <Dialog open={!!roleTarget} onOpenChange={open => { if (!open) setRoleTarget(null); }}><DialogContent className="gf-auth-account"><DialogHeader><DialogTitle>역할 변경 확인</DialogTitle><DialogDescription>{roleTarget?.displayName}님의 역할을 변경하려면 관리자 본인의 비밀번호를 입력하세요.</DialogDescription></DialogHeader>
      <form className="gf-auth-form" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget; const password = new FormData(form).get('password');
        setBusy(roleTarget!.id); setError('');
        try { await authJson('/api/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password }) }); form.reset(); if (await action(roleTarget!, 'change-role', roleTarget!.role === 'admin' ? 'user' : 'admin')) setRoleTarget(null); }
        catch (e) { setError(e instanceof Error ? e.message : '비밀번호 확인 실패'); }
        finally { setBusy(''); }
      }}><label>관리자 비밀번호<input type="password" name="password" autoComplete="current-password" required maxLength={128} /></label>{error && <p role="alert">{error}</p>}<Button type="submit" disabled={!!busy}>역할 변경</Button></form>
    </DialogContent></Dialog>
  </section>;
}

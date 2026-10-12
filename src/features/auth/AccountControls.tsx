import { useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccount } from '@/lib/account-context';
import { parseWorkspace, mergeWorkspace } from '@/domain/vessel-workflow';
import { vesselCatalog } from '@/data/vessel-workflow';
import { PasswordChange } from './AuthGate';

export function AccountControls() {
  const account = useAccount();
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!account) return <div className="top-avatar" title="오프라인 합성 시연">OP</div>;
  return <><Button variant="ghost" size="icon" aria-label="내 계정" title={`${account.user.displayName} · ${account.user.role === 'admin' ? '관리자' : '회원'}`} onClick={() => setOpen(true)}><UserRound /></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="gf-auth-account"><DialogHeader><DialogTitle>내 계정</DialogTitle><DialogDescription>{account.user.displayName} · {account.user.username} · {account.user.role === 'admin' ? '관리자' : '회원'}</DialogDescription></DialogHeader>
      {account.saving || account.error ? <p>관심 목록에 미저장 변경이 있습니다. 로그아웃 전에 저장 상태를 확인해 주세요.</p> : null}
      <Button variant="outline" disabled={busy || account.saving || !!account.error} onClick={async () => { setBusy(true); try { await account.logout(); } catch (e) { setError(e instanceof Error ? e.message : '로그아웃 실패'); } finally { setBusy(false); } }}><LogOut size={14} />로그아웃</Button>
      {account.error && <Button variant="ghost" disabled={busy || account.saving} onClick={async () => { setBusy(true); try { await account.logout(); } catch (e) { setError(e instanceof Error ? e.message : '로그아웃 실패'); } finally { setBusy(false); } }}>미저장 변경을 버리고 로그아웃</Button>}
      {error && <p role="alert">{error}</p>}
      <details><summary>비밀번호 변경</summary><PasswordChange onDone={() => window.dispatchEvent(new Event('genforecast-session-invalid'))} /></details>
    </DialogContent></Dialog></>;
}

export function AccountWorkspaceStatus() {
  const account = useAccount();
  const [legacy] = useState(() => { try { const raw = localStorage.getItem('genforecast.vessel-workspace.v1'); return raw ? parseWorkspace(raw) : null; } catch { return null; } });
  const [dismissed, setDismissed] = useState(false), [error, setError] = useState('');
  if (!account) return null;
  return <div className="gf-account-status">
    {account.user.role === 'user' && <p>개인 관심 선박은 저장할 수 있습니다. 공용 원장·설정 저장과 서버 계산 실행은 관리자 권한이 필요합니다.</p>}
    {account.saving && <p role="status">관심 선박을 계정에 저장하는 중…</p>}
    {account.error && <div role="alert"><p>아직 서버에 저장되지 않았습니다. {account.error}</p><Button variant="outline" size="sm" onClick={account.retry}>저장 재시도</Button><Button variant="ghost" size="sm" onClick={() => void account.reload()}>미저장 변경을 버리고 서버 목록 불러오기</Button></div>}
    {!dismissed && legacy && legacy.watchlist.length > 0 && <aside>
      <span>이 브라우저에 기존 관심 선박 {legacy.watchlist.length}척이 있습니다. 공용 PC라면 본인의 목록인지 확인해 주세요.</span>
      <Button size="sm" variant="outline" disabled={account.saving} onClick={() => {
        try {
          const merged = mergeWorkspace(account.workspace, legacy, vesselCatalog);
          let old: Record<string, string> = {};
          try { old = JSON.parse(localStorage.getItem('genforecast.vessel-route-destinations.v1') || '{}'); } catch { /* Preserve the old raw value. */ }
          const imported = Object.fromEntries(Object.entries(old ?? {}).filter(([id, value]) => merged.watchlist.includes(id) && ['', 'ais', 'dangjin', 'boryeong', 'hadong', 'donghae'].includes(value)));
          const destinations = Object.fromEntries(Object.entries({ ...imported, ...account.destinations }).filter(([id]) => merged.watchlist.includes(id)));
          account.saveWorkspace(merged, destinations); setDismissed(true);
        }
        catch (e) { setError(e instanceof Error ? e.message : '가져오기 실패'); }
      }}>기존 관심 선박 가져오기</Button><Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>나중에</Button>
    </aside>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

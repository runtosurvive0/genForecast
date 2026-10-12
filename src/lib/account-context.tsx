import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { parseWorkspace, type VesselWorkspace } from '@/domain/vessel-workflow';
import { authJson, type Account } from './auth-client';

export interface PrivateWorkspace { revision: number; workspace: VesselWorkspace; destinations: Record<string, string> }
interface Context {
  user: Account;
  workspace: VesselWorkspace;
  destinations: Record<string, string>;
  saveWorkspace: (workspace: VesselWorkspace, destinations?: Record<string, string>) => void;
  saveDestinations: (destinations: Record<string, string>) => void;
  saving: boolean; error: string; retry: () => void; reload: () => Promise<void>;
  logout: () => Promise<void>;
}
const AccountContext = createContext<Context | null>(null);
export const useAccount = () => useContext(AccountContext);

export function checkedPrivateWorkspace(value: PrivateWorkspace): PrivateWorkspace {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !value.destinations || Array.isArray(value.destinations)
    || Object.entries(value.destinations).some(([k, v]) => !k || !['', 'ais', 'dangjin', 'boryeong', 'hadong', 'donghae'].includes(v)))
    throw new Error('계정 관심 목록 응답을 확인해 주세요.');
  return { ...value, workspace: parseWorkspace(JSON.stringify(value.workspace)) };
}

export function AccountProvider({ user, initial, logout, children }: { user: Account; initial: PrivateWorkspace; logout: () => Promise<void>; children: ReactNode }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(initial), revision = useRef(initial.revision), dirty = useRef(false), busy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function flush() {
    if (busy.current || !alive.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      while (dirty.current && alive.current) {
        const next = current.current;
        const saved = checkedPrivateWorkspace(await authJson<PrivateWorkspace>('/api/me/vessel-workspace', {
          method: 'PUT', body: JSON.stringify({ ...next, revision: revision.current }),
        }));
        if (!alive.current) return;
        revision.current = saved.revision;
        if (current.current === next) dirty.current = false;
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '서버에 저장하지 못했습니다.');
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }
  function update(value: Partial<PrivateWorkspace>) {
    current.current = { ...current.current, ...value }; dirty.current = true; setDraft(current.current);
    if (!error) void flush();
  }
  async function reload() {
    if (busy.current) return;
    setSaving(true);
    try {
      const next = checkedPrivateWorkspace(await authJson<PrivateWorkspace>('/api/me/vessel-workspace'));
      if (!alive.current) return;
      current.current = next; revision.current = next.revision; dirty.current = false; setDraft(next); setError('');
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '목록 조회 실패'); }
    finally { if (alive.current) setSaving(false); }
  }
  return <AccountContext.Provider value={{ user, workspace: draft.workspace, destinations: draft.destinations,
    saveWorkspace: (v, destinations) => update({ workspace: parseWorkspace(JSON.stringify(v)), ...(destinations ? { destinations } : {}) }), saveDestinations: destinations => update({ destinations }),
    saving, error, retry: () => void flush(), reload, logout }}>{children}</AccountContext.Provider>;
}

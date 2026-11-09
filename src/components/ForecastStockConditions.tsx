import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Warehouse } from 'lucide-react';
import type { PlanningSnapshot } from '../domain/planning';
import { useAccount } from '../lib/account-context';
import { ApiError, authJson } from '../lib/auth-client';
import { Button } from './ui/button';
import './forecast-stock-conditions.css';

const yards = [
  { id: 'g14', name: '1저탄장', units: '1~4호기' },
  { id: 'g58', name: '2저탄장', units: '5~8호기' },
  { id: 'g910', name: '3저탄장', units: '9~10호기' },
] as const;
const number = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 });

/** Run-specific starting conditions; never changes the operating stock ledger. */
export function ForecastStockConditions({ snapshot, onSaved }: {
  snapshot: PlanningSnapshot;
  onSaved: () => void;
}) {
  const canEdit = useAccount()?.user.role === 'admin';
  const lots = snapshot.inventory.initial_lots ?? [];
  const registered = lots.length > 0;
  const knownStock = snapshot.inventory.groups.every(group => group.stock !== null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current || !canEdit || registered) return;
    const form = new FormData(event.currentTarget);
    const high_cv = Number(form.get('high_cv')), low_cv = Number(form.get('low_cv'));
    const high_tonnes = Object.fromEntries(yards.map(yard => [yard.id, Number(form.get(`${yard.id}_high`))]));
    const low_tonnes = Object.fromEntries(yards.map(yard => [yard.id, Number(form.get(`${yard.id}_low`))]));
    setError(''); setConflict(false);
    if (![high_cv, low_cv].every(cv => Number.isFinite(cv) && cv >= 1000 && cv <= 10000) || high_cv <= low_cv) {
      setError('발열량은 1,000~10,000 kcal/kg 범위이며, 고열량탄이 저열량탄보다 높아야 합니다.'); return;
    }
    if (yards.some(yard => ![high_tonnes[yard.id], low_tonnes[yard.id]].every(t => Number.isFinite(t) && t >= 0) || high_tonnes[yard.id] + low_tonnes[yard.id] <= 0)) {
      setError('저탄장별 재고를 확인해 주세요. 물량은 0 이상, 각 저탄장 합계는 0보다 커야 합니다.'); return;
    }
    const request = new AbortController();
    controller.current = request; setBusy(true);
    try {
      await authJson('/api/supply/simulation-stock', {
        method: 'POST', body: JSON.stringify({ run_id: snapshot.run_id, high_cv, low_cv, high_tonnes, low_tonnes }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      });
      if (!request.signal.aborted) onSaved();
    } catch (e) {
      if (!request.signal.aborted) {
        const duplicate = e instanceof ApiError && e.status === 409;
        setConflict(duplicate);
        setError(duplicate ? '이 계획의 시작재고가 이미 저장되어 있습니다. 저장된 값을 다시 불러와 주세요.' : e instanceof Error ? e.message : '시작재고를 저장하지 못했습니다. 입력값을 유지했으니 다시 시도해 주세요.');
      }
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <section className="gf-stock-conditions" aria-label="전망 시작재고">
    <div className="gf-stock-conditions-heading">
      <Warehouse size={19} aria-hidden="true" />
      <div><h3>전망 시작재고</h3><p>{registered
        ? `${snapshot.run_start} 기준 · ${number(lots.reduce((sum, lot) => sum + lot.tonnes, 0))} t 저장됨`
        : knownStock ? 'DB 기준재고로 수급을 계산했습니다.' : '발전량은 계산됐습니다. 수급 전망에 사용할 시작재고를 설정하세요.'}</p></div>
      <Button type="button" variant="outline" disabled={busy} aria-expanded={open} aria-controls="forecast-stock-content" onClick={() => setOpen(!open)}>
        {registered ? '시작재고 확인' : '시작재고 설정'}<ChevronDown size={16} aria-hidden="true" className={open ? 'is-open' : ''} />
      </Button>
    </div>
    {open && <div id="forecast-stock-content" className="gf-stock-conditions-content">
      <div className="gf-stock-conditions-basis"><strong>{snapshot.run_start} 00:00 KST</strong><span>선택한 발전계획의 시작 시점입니다. 조회 시작일을 바꿔도 이 기준은 유지됩니다.</span></div>
      {registered ? <>
        <div className="gf-stock-conditions-yards">{yards.map(yard => <div className="gf-stock-conditions-yard" key={yard.id}>
          <h4>{yard.name}<span>{yard.units}</span></h4>
          <dl>{(['high', 'low'] as const).map(grade => {
            const lot = lots.find(item => item.group_id === yard.id && item.grade === grade);
            return <div key={grade}><dt>{grade === 'high' ? '고열량탄' : '저열량탄'}</dt><dd>{lot ? `${number(lot.tonnes)} t` : '미등록'}<small>{lot ? `${number(lot.cv)} kcal/kg` : ''}</small></dd></div>;
          })}</dl>
        </div>)}</div>
        <p className="gf-stock-conditions-note">저장된 시작 조건입니다. 이 화면에서는 기존 값을 덮어쓰지 않습니다.</p>
      </> : !canEdit ? <p className="gf-stock-conditions-note">시작재고 등록은 관리자 권한이 필요합니다. 저장된 조건과 수급 결과는 함께 조회할 수 있습니다.</p> : <form onSubmit={save}>
        <fieldset disabled={busy || conflict}>
          <legend className="sr-only">저탄장별 시작재고와 발열량</legend>
          <div className="gf-stock-conditions-yards">{yards.map(yard => <div className="gf-stock-conditions-yard" key={yard.id}>
            <h4>{yard.name}<span>{yard.units}</span></h4>
            <label>고열량탄 <span>t</span><input aria-label={`${yard.name} 고열량탄`} name={`${yard.id}_high`} type="number" min="0" step="any" required /></label>
            <label>저열량탄 <span>t</span><input aria-label={`${yard.name} 저열량탄`} name={`${yard.id}_low`} type="number" min="0" step="any" required /></label>
          </div>)}</div>
          <div className="gf-stock-conditions-quality">
            <div><h4>계산에 사용할 발열량</h4><p>세 저탄장에 공통 적용합니다. 고·저열량탄 물량으로 가중평균해 사용량을 계산합니다.</p></div>
            <label>고열량탄 <span>kcal/kg</span><input aria-label="고열량탄 발열량" name="high_cv" type="number" min="1000" max="10000" step="any" required /></label>
            <label>저열량탄 <span>kcal/kg</span><input aria-label="저열량탄 발열량" name="low_cv" type="number" min="1000" max="10000" step="any" required /></label>
          </div>
        </fieldset>
        {error && <div role="alert" className="gf-stock-conditions-error">{error}{conflict && <Button type="button" variant="outline" onClick={onSaved}>저장된 시작재고 불러오기</Button>}</div>}
        <div className="gf-stock-conditions-actions"><p>이 계획에만 저장합니다. 현재 운영재고와 발전량 계산 결과는 변경하지 않습니다.</p><Button type="submit" disabled={busy || conflict}>{busy ? '저장 중…' : '저장하고 수급 갱신'}</Button></div>
      </form>}
    </div>}
  </section>;
}

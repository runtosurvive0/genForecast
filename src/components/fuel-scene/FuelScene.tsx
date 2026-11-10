import { useEffect, useId, useRef, useState } from 'react';
import { Focus, Minus, Plus, RotateCcw, Orbit, Layers, Grid2X2 } from 'lucide-react';
import { canReceive, endpointForLot, referenceLots } from '../../domain/fuel-reference';
import { mountFuelScene } from './scene-runtime.js';
import { yardBaselineLots } from '../../domain/yard-baseline-lots.js';
import type { YardBaselineLot } from '../../domain/use-yard-baseline';
import './fuel-scene.css';

export interface FuelSceneProps {
  mode: 'yard' | 'berth' | 'blend';
  yard: 1 | 2 | 3;
  berth: 1 | 2 | 3;
  observedDockMask?: number;
  berthView?: 'route' | 'site';
  focusRequest?: number;
  onInspectBerth?: (id: 1 | 2 | 3) => void;
  theme: 'light' | 'dark';
  selectedLotId: string | null;
  onSelectLot: (id: string | null) => void;
  snapshot: unknown | null;
  baselineStock?: Record<string, number>;
  baselineDetails?: Record<string, {coal: string; voyage: string; days: number | null}>;
  baselineLots?: YardBaselineLot[];
  online: boolean;
  selectedUnitId?: number;
  onSelectUnit?: (id:number) => void;
}

type SceneController = ReturnType<typeof mountFuelScene>;
type ViewState = { zoom: number; roof: boolean; plant: boolean; plan: boolean; orbitTool: boolean; error: string | null };

/** Shared, source-labelled yard/berth scene with an instance-owned WebGL lifetime. */
export function FuelScene(props: FuelSceneProps) {
  const { mode, yard, berth, theme, selectedLotId, snapshot, online, selectedUnitId } = props;
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<SceneController | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const selectId = useId();
  const helpId = useId();
  const modelYard = mode === 'berth' ? null : yard;
  const [view, setView] = useState<ViewState>({ zoom: 1, roof: mode !== 'berth' && yard > 1, plant:false, plan:false, orbitTool:false, error: null });

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let mounted = true;
    try {
      const instance = mountFuelScene(node, latest.current, (id: string | null) => latest.current.onSelectLot(id), (next: ViewState) => {
        if (mounted) setView(previous => previous.zoom === next.zoom && previous.roof === next.roof && previous.plant === next.plant && previous.plan === next.plan && previous.orbitTool === next.orbitTool && previous.error === next.error ? previous : next);
      });
      controller.current = instance;
      return () => { mounted = false; controller.current = null; instance.dispose(); };
    } catch {
      setView({ zoom: 1, roof: false, plant:false, plan:false, orbitTool:false, error: '3D 표시를 사용할 수 없습니다. 원탄 선택과 재고 표를 이용하세요.' });
    }
    return () => { mounted = false; };
  }, [mode, modelYard, props.berthView, props.baselineLots]);

  useEffect(() => {
    controller.current?.update(latest.current);
  }, [mode, yard, berth, theme, selectedLotId, snapshot, online, selectedUnitId, props.observedDockMask, props.focusRequest, props.baselineStock, props.baselineDetails]);

  const lots = (props.baselineLots ? yardBaselineLots(props.baselineLots) : referenceLots).filter(lot => mode === 'berth' ? canReceive(berth,endpointForLot(lot)) : lot.yard === yard);
  return (
    <section className="fuel-scene" data-theme={theme} data-mode={mode} aria-label={mode === 'blend' ? '저탄장부터 보일러까지 상탄 계통 3D 장면' : mode === 'yard' ? `${yard}저탄장 3D 참고 장면` : `${berth}부두 이송설비 3D 참고 장면`}>
      <div className="fuel-scene__toolbar">
        <div className="fuel-scene__view-controls" aria-label="장면 보기">
          <button type="button" aria-label="축소" disabled={!!view.error || view.zoom <= 1} onClick={() => controller.current?.zoomBy(.8)}><Minus size={14} /></button>
          <output aria-label="장면 배율">{Math.round(view.zoom * 100)}%</output>
          <button type="button" aria-label="확대" disabled={!!view.error || view.zoom >= 12} onClick={() => controller.current?.zoomBy(1.25)}><Plus size={14} /></button>
          <button type="button" className="fuel-scene__orbit" aria-label="드래그 회전" title="드래그 회전" aria-pressed={!view.plan && view.orbitTool} disabled={!!view.error || view.plan} onClick={() => controller.current?.toggleOrbit()}><Orbit size={14}/>회전</button>
          <button type="button" aria-label="장면 원위치" disabled={!!view.error} onClick={() => controller.current?.reset()}><RotateCcw size={14} /></button>
          {mode === 'blend' && <>
            <button type="button" className="fuel-scene__text-button" aria-pressed={view.plant} disabled={!!view.error} onClick={() => controller.current?.togglePlant()}><Layers size={13} />발전동 투시</button>
          </>}
          {mode !== 'yard' && <button type="button" className="fuel-scene__text-button" aria-pressed={view.plan} disabled={!!view.error} onClick={() => controller.current?.togglePlan()}><Grid2X2 size={13} />평면</button>}
          {(mode === 'berth' || yard > 1) && <button type="button" className="fuel-scene__text-button" aria-pressed={view.roof} disabled={!!view.error} onClick={() => controller.current?.toggleRoof()}><Layers size={13} />지붕 투시</button>}
          {(mode !== 'berth' || selectedLotId) && <button type="button" aria-label="선택 원탄 확대" disabled={!selectedLotId || !!view.error} onClick={() => controller.current?.focusSelected()}><Focus size={14} /></button>}
        </div>
        {mode !== 'berth' && <label className="fuel-scene__lot-picker" htmlFor={selectId}><span>원탄</span>
          <select id={selectId} aria-label="원탄 선택" value={lots.some(lot => lot.id === selectedLotId) ? selectedLotId ?? '' : ''} onChange={event => props.onSelectLot(event.target.value || null)}>
            <option value="">선택 없음</option>
            {lots.map(lot => <option key={lot.id} value={lot.id}>{lot.pile ? `Pile ${lot.pile}` : `${lot.shed}${lot.cell}`} · {props.baselineDetails?.[lot.id]?.coal ?? lot.coal}{(props.baselineStock?.[lot.id] ?? lot.tons) === 0 ? ' · 소진' : ''}</option>)}
          </select>
        </label>}
      </div>
      <div className="fuel-scene__viewport" ref={host} tabIndex={0} role="group" aria-label="3D 장면 이동·확대" aria-describedby={helpId} />
      {view.error && <p className="fuel-scene__fallback" role="status">{view.error}</p>}
      <div className="fuel-scene__caption">
        <span>{online ? '운전 정보 수신' : snapshot ? '수신 끊김 · 마지막 값' : props.baselineStock ? '기준 재고' : '재고 미연결'} · {props.berthView==='route'?'해상 컨베이어 거리 축약':mode==='blend'?'주계통 개념 배치 · 보일러 형상 추정':mode==='berth'?'참고 배치 · 실측 아님':'형상·이격 추정'}</span>
        <span id={helpId}>{view.plan ? '드래그·방향키 이동' : view.orbitTool ? '드래그·방향키 회전' : '드래그·방향키 이동 · Shift와 함께 회전'} · 휠 확대 · Home 원위치</span>
      </div>
    </section>
  );
}

export default FuelScene;

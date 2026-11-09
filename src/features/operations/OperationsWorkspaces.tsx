import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  RefreshCw,
  Info,
  Radio,
  Database,
  Cable,
  ClipboardCheck,
} from "lucide-react";
import { PlanningWorkspace } from "@/components/PlanningWorkspace";
import type { PlanningState } from "@/domain/use-planning";
import type { PlanningSnapshot } from "@/domain/planning";
import type { FuelDemoCatalog, FuelDemoSnapshot, FuelDemoStatus } from "@/domain/fuel-demo/types";
import { completeTotal, reviewReceipt, reviewPileReceipt, reviewRouteSignals } from "./workspace-review";
import { useYardBaseline } from "@/domain/use-yard-baseline";
import { BerthRoutes } from "@/data/fuel-reference/berth-routes.js";
import { authJson } from "@/lib/auth-client";
import "./operations-workspaces.css";

const fmt = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const inputNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);
const demoStatus = (status: string) =>
  ({
    disabled: "연결 안 됨",
    connecting: "연결 중",
    online: "수신 중",
    stale: "수신 지연",
    disconnected: "연결 끊김",
  })[status] ?? "상태 미확정";
const totalGeneration = (s: PlanningSnapshot) =>
  completeTotal(
    s.daily.map((day) => day.generation_mwh),
    s.horizon_days,
  );
const totalFuel = (s: PlanningSnapshot) =>
  completeTotal(
    s.daily.map((day) => day.fuel_tonnes),
    s.horizon_days,
  );

function Workspace({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gf-operations-workspace">
      <header className="gf-ow-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: number | null;
  unit: string;
  note: string;
}) {
  return (
    <div className="gf-ow-metric">
      <span>{label}</span>
      <strong>
        {fmt(value, 1)}
        {value !== null && <small>{unit}</small>}
      </strong>
      <p>{note}</p>
    </div>
  );
}
function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`gf-ow-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </header>
      {children}
    </section>
  );
}
function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="gf-ow-link" type="button" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}
function ScrollTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="gf-ow-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table>{children}</table>
    </div>
  );
}

export function UnitsWorkspace({
  planning,
  snapshot,
  status,
  onNavigate,
}: {
  planning: PlanningState;
  snapshot: FuelDemoSnapshot | null;
  status: string;
  onNavigate: (page: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("dj-1");
  const demo = status !== "disabled" ? snapshot : null;
  return (
    <Workspace
      title="호기·연소"
      description="저장된 호기 계획과 운전 정보를 확인합니다."
      action={
        <LinkButton onClick={() => onNavigate("schedule")}>
          정지계획 확인
        </LinkButton>
      }
    >
      <div className="gf-ow-source-strip">
        <Radio size={16} />
        <strong>{demoStatus(status)}</strong>
        <span>
          {demo
            ? `발전 출력 ${fmt(
                completeTotal(
                  Object.values(demo.units).map((unit) => unit.mw),
                  10,
                ),
              )} MW · ${demo.playing ? "진행 중" : "일시정지"}`
            : "현재 운전 출력·실측 연료사용량은 미연결입니다."}
        </span>
        <LinkButton onClick={() => onNavigate("demo-control")}>
          조작반
        </LinkButton>
      </div>
      {status !== "disabled" && (
        <Panel
          title="호기별 출력"
          note={
            status === "online"
              ? "수신값"
              : "마지막 수신값"
          }
        >
          <div
            className="gf-ow-demo-units"
            aria-label="호기별 출력"
          >
            {Array.from({ length: 10 }, (_, index) => {
              const id = String(index + 1);
              const unit = demo?.units[id];
              return (
                <div key={id}>
                  <span>
                    {id}호기{" "}
                    <small>
                      {unit
                        ? { running: "운전", stopped: "정지", fault: "고장" }[
                            unit.status
                          ]
                        : "수신 전"}
                    </small>
                  </span>
                  <strong>
                    {fmt(unit?.mw, 1)}
                    {unit && <small>MW</small>}
                  </strong>
                </div>
              );
            })}
          </div>
          <p className="gf-ow-note">
            계획 조회와 운전 정보는 각각 확인할 수 있습니다.
          </p>
        </Panel>
      )}
      <PlanningWorkspace state={planning}>
        {(s) => {
          const selected =
            s.units.find((unit) => unit.unit_id === selectedId) ?? s.units[0];
          const generation = totalGeneration(s);
          const selectedDemo =
            demo?.units[selected?.unit_id.replace("dj-", "")];
          const outages = s.outages.filter(
            (item) => item.unit_id === selected?.unit_id,
          );
          return (
            <>
              <section className="gf-ow-metrics" aria-label="호기 계획 요약">
                <Metric
                  label="조회기간 평균 계획 출력"
                  value={
                    generation === null
                      ? null
                      : generation / (s.horizon_days * 24)
                  }
                  unit="MW"
                  note={`${s.horizon_days}일 평균 · 현재 출력 아님`}
                />
                <Metric
                  label="계획 발전량"
                  value={generation === null ? null : generation / 1000}
                  unit="GWh"
                  note={`${s.start} ~ ${s.end}`}
                />
                <Metric
                  label="구매계획용 연료량"
                  value={totalFuel(s)}
                  unit="t"
                  note={`${fmt(s.fuel.calorific_kcal_kg)} kcal/kg 기준`}
                />
                <Metric
                  label="실측 연료사용량"
                  value={null}
                  unit="t"
                  note="실측 계량 미연결"
                />
              </section>
              <div className="gf-ow-split">
                <Panel
                  title="호기별 운전 계획"
                  note="계획기간 기준 · 현재 운전과 구분"
                >
                  <ScrollTable label="호기별 계획 표">
                    <thead>
                      <tr>
                        <th>호기</th>
                        <th className="gf-ow-number">용량 MW</th>
                        <th className="gf-ow-number">평균 계획 MW</th>
                        <th className="gf-ow-number">계획 이용률</th>
                        <th className="gf-ow-number">연료계획 t</th>
                        <th className="gf-ow-number">출력 MW</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.units.map((unit) => (
                        <tr
                          key={unit.unit_id}
                          data-selected={unit.unit_id === selected?.unit_id}
                        >
                          <td>
                            <button
                              className="gf-ow-select"
                              type="button"
                              aria-pressed={unit.unit_id === selected?.unit_id}
                              onClick={() => setSelectedId(unit.unit_id)}
                            >
                              {unit.name}
                            </button>
                          </td>
                          <td className="gf-ow-number">
                            {fmt(unit.capacity_mw)}
                          </td>
                          <td className="gf-ow-number">
                            {fmt(
                              unit.generation_mwh === null
                                ? null
                                : unit.generation_mwh / (s.horizon_days * 24),
                              1,
                            )}
                          </td>
                          <td className="gf-ow-number">
                            {fmt(unit.capacity_factor_pct, 1)}
                            {unit.capacity_factor_pct === null ? "" : "%"}
                          </td>
                          <td className="gf-ow-number">
                            {fmt(unit.fuel_tonnes)}
                          </td>
                          <td className="gf-ow-number">
                            {demo
                              ? fmt(
                                  demo.units[unit.unit_id.replace("dj-", "")]
                                    ?.mw,
                                )
                              : "꺼짐"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </ScrollTable>
                </Panel>
                <Panel
                  title={`${selected?.name ?? "호기"} 상세`}
                  note="선택한 호기"
                  className="gf-ow-unit-detail"
                >
                  <dl className="gf-ow-facts">
                    <div>
                      <dt>계획 발전량</dt>
                      <dd>{fmt(selected?.generation_mwh)} MWh</dd>
                    </div>
                    <div>
                      <dt>계획 가동시간</dt>
                      <dd>{fmt(selected?.online_hours, 1)} h</dd>
                    </div>
                    <div>
                      <dt>운전 상태</dt>
                      <dd>
                        {selectedDemo
                          ? { running: "운전", stopped: "정지", fault: "고장" }[
                              selectedDemo.status
                            ]
                          : "수신값 없음"}
                      </dd>
                    </div>
                    <div>
                      <dt>현재 실제 출력</dt>
                      <dd>실적 미연결</dd>
                    </div>
                  </dl>
                  <h3>조회기간 정지계획</h3>
                  {outages.length ? (
                    <ul className="gf-ow-records">
                      {outages.map((outage, index) => (
                        <li key={`${outage.start_at}-${index}`}>
                          <b>
                            {outage.start_at.slice(0, 10)} ~{" "}
                            {outage.end_at.slice(0, 10)}
                          </b>
                          <span>{outage.note || "사유 미기재"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="gf-ow-note">
                      등록된 정지 일정 없음 · 무정비 확정을 의미하지 않습니다.
                    </p>
                  )}
                  <LinkButton onClick={() => onNavigate("schedule")}>
                    전체 정지계획 열기
                  </LinkButton>
                  <p className="gf-ow-note">
                    연소 성상·효율·배출 실측은 연결 전입니다. 저장 계획의 연료
                    환산 기준은 계산 출처를 확인하세요.
                  </p>
                </Panel>
              </div>
            </>
          );
        }}
      </PlanningWorkspace>
    </Workspace>
  );
}

export function AnalysisWorkspace({ planning }: { planning: PlanningState }) {
  const [measure, setMeasure] = useState<"fuel" | "generation">("fuel");
  return (
    <Workspace
      title="계획·실적 분석"
      description="저장 계획의 발전량·연료량과 자료 완전성을 검토합니다."
    >
      <PlanningWorkspace state={planning}>
        {(s) => {
          const generation = totalGeneration(s),
            fuel = totalFuel(s);
          const values = s.daily.map((day) =>
            measure === "fuel" ? day.fuel_tonnes : day.generation_mwh,
          );
          const maximum = Math.max(
            1,
            ...values.filter((value): value is number => value !== null),
          );
          return (
            <>
              <section className="gf-ow-metrics" aria-label="계획 분석 요약">
                <Metric
                  label="계획 발전량"
                  value={generation === null ? null : generation / 1000}
                  unit="GWh"
                  note="선택 조회기간 합계"
                />
                <Metric
                  label="계획 연료사용량"
                  value={fuel}
                  unit="t"
                  note="누락일이 있으면 합계 미확정"
                />
                <Metric
                  label="실제 연료사용량"
                  value={null}
                  unit="t"
                  note="계량 실적 미연결"
                />
                <Metric
                  label="계획 대비 실적 차이"
                  value={null}
                  unit="t"
                  note="같은 기간의 실적 연결 후 비교"
                />
              </section>
              <div className="gf-ow-source-strip">
                <Info size={16} />
                <span>
                  금액·회계 비용은 제공되지 않습니다. 구매계획용 연료량과 혼합
                  열량 기준 재고 소모량은 서로 다른 기준입니다.
                </span>
              </div>
              <Panel
                title="일별 계획 추이"
                note={`${s.start} ~ ${s.end} · KST`}
              >
                <div className="gf-ow-chart-toolbar">
                  <div
                    className="gf-ow-switch"
                    role="group"
                    aria-label="분석 지표"
                  >
                    <button
                      type="button"
                      aria-pressed={measure === "fuel"}
                      onClick={() => setMeasure("fuel")}
                    >
                      연료사용량
                    </button>
                    <button
                      type="button"
                      aria-pressed={measure === "generation"}
                      onClick={() => setMeasure("generation")}
                    >
                      발전량
                    </button>
                  </div>
                  <span>
                    {measure === "fuel" ? "t/일" : "MWh/일"} · 값 누락은 막대
                    미표시
                  </span>
                </div>
                <div
                  className="gf-ow-bars"
                  role="img"
                  aria-label={`${measure === "fuel" ? "연료사용" : "발전"} 계획 일별 막대그래프. 정확한 수치는 아래 일별 표에 있습니다.`}
                >
                  {s.daily.map((day, index) => (
                    <div
                      key={day.date}
                      title={`${day.date}: ${fmt(values[index])} ${measure === "fuel" ? "t" : "MWh"}`}
                    >
                      <i
                        style={{
                          height: `${values[index] === null ? 0 : (Math.max(0, values[index]!) / maximum) * 100}%`,
                        }}
                      />
                      <span>
                        {index === 0 ||
                        index === s.daily.length - 1 ||
                        index % Math.max(1, Math.ceil(s.daily.length / 8)) === 0
                          ? day.date.slice(5)
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
              <div className="gf-ow-even">
                <Panel
                  title="일별 계획과 실적"
                  note="실적 공백은 0으로 대체하지 않음"
                >
                  <ScrollTable label="계획 실적 비교 표">
                    <thead>
                      <tr>
                        <th>일자 KST</th>
                        <th className="gf-ow-number">계획 MWh</th>
                        <th className="gf-ow-number">계획 연료 t</th>
                        <th>연료 실적</th>
                        <th>차이</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.daily.map((day) => (
                        <tr key={day.date}>
                          <td>{day.date}</td>
                          <td className="gf-ow-number">
                            {fmt(day.generation_mwh)}
                          </td>
                          <td className="gf-ow-number">
                            {fmt(day.fuel_tonnes)}
                          </td>
                          <td>미연결</td>
                          <td>미확정</td>
                        </tr>
                      ))}
                    </tbody>
                  </ScrollTable>
                </Panel>
                <Panel
                  title="월별 계획 완전성"
                  note="전체 저장 계산기간의 월 합계"
                >
                  <ScrollTable label="월별 연료계획 표">
                    <thead>
                      <tr>
                        <th>월</th>
                        <th>계획 확보</th>
                        <th className="gf-ow-number">예정량 t</th>
                        <th>판독</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.monthly.map((month) => (
                        <tr key={month.month}>
                          <td>{month.month}</td>
                          <td>
                            {month.complete_days}/{month.expected_days}일
                          </td>
                          <td className="gf-ow-number">
                            {fmt(month.fuel_tonnes)}
                          </td>
                          <td>
                            {month.fuel_tonnes === null
                              ? "월 자료 부족"
                              : "월 합계 확보"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </ScrollTable>
                  <p className="gf-ow-note">
                    조회한 일부 날짜를 온전한 월 합계로 환산하지 않습니다. 저장
                    계산의 발열량은 {fmt(s.fuel.calorific_kcal_kg)} kcal/kg
                    {s.fuel.is_assumption ? " · 가정값" : ""}입니다.
                  </p>
                </Panel>
              </div>
            </>
          );
        }}
      </PlanningWorkspace>
    </Workspace>
  );
}

type ReceiptPlan = { name: string; runId: string; forecastStart: string; forecastHorizon: string; groupId: string; arrival: string; quantity: string; capacity: string; leadDays: string; storageDays: string; berth: string; endpoint: string; pileCapacity: string; projectedStock: string; useStart: string; dailyUse: string };
type SavedReceiptPlan = { id: string; revision: number; plan: ReceiptPlan; updated_at: string; actor: string };

function ReceiptReview({ snapshot: s, demoSnapshot, demoStatus, demoCatalog }: { snapshot: PlanningSnapshot; demoSnapshot: FuelDemoSnapshot | null; demoStatus: FuelDemoStatus; demoCatalog: FuelDemoCatalog | null }) {
  const [groupId, setGroupId] = useState("g14");
  const [arrival, setArrival] = useState("");
  const [quantity, setQuantity] = useState("");
  const [capacity, setCapacity] = useState("");
  const [leadDays, setLeadDays] = useState("");
  const [storageDays, setStorageDays] = useState("");
  const [berth, setBerth] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [pileCapacity, setPileCapacity] = useState("");
  const [projectedStock, setProjectedStock] = useState("");
  const [useStart, setUseStart] = useState("");
  const [dailyUse, setDailyUse] = useState("");
  const [planName, setPlanName] = useState("");
  const [plans, setPlans] = useState<SavedReceiptPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SavedReceiptPlan | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const [planError, setPlanError] = useState("");
  const touched = useRef(false);
  const applyPlan = (item: ReceiptPlan) => {
    setPlanName(item.name); setGroupId(item.groupId); setArrival(item.arrival);
    setQuantity(item.quantity); setCapacity(item.capacity); setLeadDays(item.leadDays);
    setStorageDays(item.storageDays); setBerth(item.berth); setEndpoint(item.endpoint);
    setPileCapacity(item.pileCapacity); setProjectedStock(item.projectedStock);
    setUseStart(item.useStart); setDailyUse(item.dailyUse);
  };
  useEffect(() => {
    const controller = new AbortController();
    authJson<{plans: SavedReceiptPlan[]}>('/api/voyage-registry/receipt-plans', { signal: controller.signal })
      .then(result => {
        setPlans(result.plans);
        if (result.plans[0] && !touched.current) { setSelectedPlan(result.plans[0]); applyPlan(result.plans[0].plan); }
      })
      .catch(error => { if (!controller.signal.aborted) setPlanError(`계획을 불러오지 못했습니다. ${error.message}`); })
      .finally(() => { if (!controller.signal.aborted) setPlansLoading(false); });
    return () => controller.abort();
  }, []);
  const baseline = useYardBaseline();
  const group =
    s.inventory.groups.find((item) => item.id === groupId) ??
    s.inventory.groups[0];
  const arrivalDay = arrival || s.start;
  const currentPlan: ReceiptPlan = {name:planName, runId:s.run_id, forecastStart:s.start, forecastHorizon:String(s.horizon_days), groupId, arrival:arrivalDay, quantity, capacity, leadDays, storageDays, berth, endpoint, pileCapacity, projectedStock, useStart, dailyUse};
  const dirty = selectedPlan ? JSON.stringify(currentPlan) !== JSON.stringify(selectedPlan.plan) : touched.current;
  const switchPlan = (id: string) => {
    if (dirty && !window.confirm('저장하지 않은 입력이 있습니다. 다른 계획으로 이동할까요?')) return;
    const selected = plans.find(item => item.id === id) ?? null;
    setSelectedPlan(selected); setPlanError(''); setPlanMessage(''); touched.current = false;
    applyPlan(selected?.plan ?? {name:'',runId:s.run_id,forecastStart:s.start,forecastHorizon:String(s.horizon_days),groupId:'g14',arrival:'',quantity:'',capacity:'',leadDays:'',storageDays:'',berth:'',endpoint:'',pileCapacity:'',projectedStock:'',useStart:'',dailyUse:''});
  };
  const savePlan = async (asNew = false) => {
    if (!planName.trim()) { setPlanError('계획명을 입력하세요.'); return; }
    setSaving(true); setPlanError(''); setPlanMessage('');
    try {
      const saved = await authJson<SavedReceiptPlan>('/api/voyage-registry/receipt-plans', {
        method:'POST', body:JSON.stringify({id:asNew ? null : selectedPlan?.id ?? null, revision:asNew ? 0 : selectedPlan?.revision ?? 0, plan:currentPlan}),
      });
      setPlans(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
      setSelectedPlan(saved); applyPlan(saved.plan); touched.current = false;
      setPlanMessage('계획을 공용으로 저장했습니다.');
    } catch (error) { setPlanError(error instanceof Error ? error.message : '계획을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };
  const routeSignals = reviewRouteSignals(demoStatus, demoSnapshot, demoCatalog, berth ? Number(berth) : null, endpoint);
  const rows = s.inventory.daily.map((row) => ({
    day: row.day,
    stock: row.groups[group.id]?.stock ?? null,
    days: row.groups[group.id]?.days ?? null,
  }));
  const review = reviewReceipt(rows, {
    start: s.start,
    arrival: arrivalDay,
    quantity: inputNumber(quantity),
    capacity: inputNumber(capacity),
    leadDays: inputNumber(leadDays),
    storageDays: inputNumber(storageDays),
  });
  const pileReview = reviewPileReceipt({
    berth: berth ? Number(berth) : null, endpoint, arrival: arrivalDay,
    quantity: inputNumber(quantity), capacity: inputNumber(pileCapacity),
    projectedStock: inputNumber(projectedStock), storageDays: inputNumber(storageDays),
    useStart, dailyUse: inputNumber(dailyUse),
  });
  const pileLocation = endpoint.startsWith('pile-') ? `P${endpoint.slice(5)}` : null;
  const shedPrefix = endpoint === 'shed-a' ? 'A' : endpoint === 'shed-b' ? 'B' : null;
  const baselineLots = baseline.data?.lots.filter(lot =>
    pileLocation ? lot.location === pileLocation
      : shedPrefix ? new RegExp(`^${shedPrefix}(?:[1-9]|10)$`).test(lot.location) : false,
  );
  const baselineStock = baselineLots?.length && baselineLots.every(lot => Number.isFinite(lot.tonnes) && lot.tonnes >= 0)
    ? baselineLots.reduce((total, lot) => total + lot.tonnes, 0) : null;
  return (
    <fieldset className="gf-ow-receipt-workspace" disabled={saving} onChangeCapture={() => { touched.current = true; }} onClickCapture={event => { if ((event.target as HTMLElement).closest('.gf-ow-select')) touched.current = true; }}>
      <Panel title="저장된 반입 검토" note="승인된 팀원 공용 · 입력 계획">
        <div className="gf-ow-plan-controls">
          <label>저장된 계획<select aria-label="저장된 계획" value={selectedPlan?.id ?? ''} disabled={plansLoading || saving} onChange={event => switchPlan(event.target.value)}>
            <option value="">새 계획</option>{plans.map(item => <option value={item.id} key={item.id}>{item.plan.name}</option>)}
          </select></label>
          <label>계획명<input aria-label="계획명" value={planName} maxLength={120} onChange={event => setPlanName(event.target.value)} placeholder="계획 이름 입력" /></label>
          <button type="button" className="gf-ow-action" disabled={plansLoading || saving} onClick={() => void savePlan()}>{saving ? '저장 중' : selectedPlan ? '계획 저장' : '새 계획 저장'}</button>
          {selectedPlan && <button type="button" className="gf-ow-link" disabled={saving} onClick={() => void savePlan(true)}>별도 계획으로 저장</button>}
        </div>
        {plansLoading && <p className="gf-ow-note" role="status">저장된 계획을 불러오는 중입니다.</p>}
        {selectedPlan && (selectedPlan.plan.runId !== s.run_id || selectedPlan.plan.forecastStart !== s.start || selectedPlan.plan.forecastHorizon !== String(s.horizon_days)) && <p className="gf-ow-error" role="status">이 계획의 저장 당시 전망 기준은 {selectedPlan.plan.runId} · {selectedPlan.plan.forecastStart} · {selectedPlan.plan.forecastHorizon}일입니다. 현재 선택한 전망과 다르므로 비교 기준을 확인하세요.</p>}
        {dirty && <p className="gf-ow-note">저장되지 않은 변경이 있습니다.</p>}
        {planMessage && <p className="gf-ow-note" role="status">{planMessage}</p>}
        {planError && <p className="gf-ow-error" role="alert">{planError}</p>}
      </Panel>
      <div className="gf-ow-even">
        <Panel
          title="월별 연료 구매계획 기준"
          note="저장 계산 결과 · 발주량 아님"
        >
          <ScrollTable label="구매검토 월별 연료계획">
            <thead>
              <tr>
                <th>월</th>
                <th>계획 확보</th>
                <th className="gf-ow-number">예정량 t</th>
              </tr>
            </thead>
            <tbody>
              {s.monthly.map((month) => (
                <tr key={month.month}>
                  <td>{month.month}</td>
                  <td>
                    {month.complete_days}/{month.expected_days}일
                  </td>
                  <td className="gf-ow-number">{fmt(month.fuel_tonnes)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="gf-ow-note">
            단가·운임·계약 최소 물량이 연결되지 않아 구매 금액과 권장 발주량은
            산출하지 않습니다.
          </p>
        </Panel>
        <Panel title="처별 재고와 공급 여유" note="Python 공통 수급 결과">
          <ScrollTable label="구매검토 처별 재고">
            <thead>
              <tr>
                <th>발전처</th>
                <th className="gf-ow-number">기준 재고 t</th>
                <th className="gf-ow-number">최저 재고일수</th>
                <th className="gf-ow-number">계획 입고 t</th>
              </tr>
            </thead>
            <tbody>
              {s.inventory.groups.map((item) => (
                <tr key={item.id} data-selected={item.id === group.id}>
                  <td>
                    <button
                      className="gf-ow-select"
                      type="button"
                      aria-pressed={item.id === group.id}
                      onClick={() => setGroupId(item.id)}
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="gf-ow-number">{fmt(item.stock)}</td>
                  <td className="gf-ow-number">{fmt(item.min_days, 1)}</td>
                  <td className="gf-ow-number">
                    {fmt(item.expected_receipts)}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="gf-ow-note">
            미등록 기준재고는 미확정입니다. 음수 전망은 저장 계획상의
            부족량입니다.
          </p>
        </Panel>
      </div>
      <Panel
        title="반입 조건 검토"
        note="입력 계획 · 원장과 전망을 변경하지 않음"
      >
        <div className="gf-ow-assumptions">
          <label>
            검토 발전처
            <select
              value={group.id}
              onChange={(event) => setGroupId(event.target.value)}
            >
              {s.inventory.groups.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            반입 검토일 · KST
            <input
              type="date"
              value={arrivalDay}
              min={s.start}
              onChange={(event) => setArrival(event.target.value)}
            />
          </label>
          <label>
            검토 물량 · t
            <input
              type="number"
              min="0"
              step="100"
              placeholder="가정 입력"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            가정 저장한도 · t
            <input
              type="number"
              min="1"
              step="100"
              placeholder="미제공"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </label>
          <label>
            조달 리드타임 · 일
            <input
              type="number"
              min="0"
              max="3650"
              step="1"
              placeholder="미제공"
              value={leadDays}
              onChange={(event) => setLeadDays(event.target.value)}
            />
          </label>
          <label>
            적정 저장기간 · 일
            <input
              type="number"
              min="0"
              max="3650"
              step="1"
              placeholder="미제공"
              value={storageDays}
              onChange={(event) => setStorageDays(event.target.value)}
            />
          </label>
        </div>
        <div className="gf-ow-review" aria-live="polite">
          <dl className="gf-ow-facts">
            <div>
              <dt>검토일 기존 재고전망</dt>
              <dd>{fmt(review.stock)} t</dd>
            </div>
            <div>
              <dt>가정 한도 내 빈 공간</dt>
              <dd>{fmt(review.headroom)} t</dd>
            </div>
            <div>
              <dt>조회 시작 + 리드타임</dt>
              <dd>{review.earliestArrival ?? "리드타임 미입력"}</dd>
            </div>
            <div>
              <dt>관찰 종료일</dt>
              <dd>{review.storageEnd ?? "관찰기간 미입력"}</dd>
            </div>
            <div>
              <dt>처음 공간 확보 · 일말 기준</dt>
              <dd>{review.firstAvailable ?? ({'missing-input':'물량·한도·리드타임 필요','outside-horizon':'조회기간 밖','incomplete':'재고 자료 미확정','not-found':'조회기간 내 없음','found':'미확정'}[review.spaceStatus])}</dd>
            </div>
          </dl>
          <ul className="gf-ow-review-findings">
            <li>
              {!review.valid
                ? "날짜와 0 이상의 물량·정수 일수를 확인하세요."
                : review.shortage
                  ? "선택일의 기존 전망에 부족량이 있습니다. 추가 반입 후 전망은 수급 엔진에서 별도 검토해야 합니다."
                  : review.stock === null
                    ? "선택일 재고 자료가 없어 반입 여유를 판단할 수 없습니다."
                    : "선택일의 저장된 재고전망을 확인했습니다."}
            </li>
            <li>
              {review.overCapacity === null
                ? "물량과 저장한도를 입력하면 공간 제약을 비교합니다."
                : review.overCapacity
                  ? "검토 물량이 가정 저장한도의 빈 공간을 초과합니다."
                  : "검토 물량은 가정 저장한도의 빈 공간 이내입니다."}
            </li>
            <li>
              {review.tooEarly === null
                ? "조달 리드타임은 미확정입니다."
                : review.tooEarly
                  ? "검토일이 가정 리드타임보다 빠릅니다."
                  : "검토일이 가정 리드타임 이후입니다."}
            </li>
            <li>
              {review.storageWindowCovered === null
                ? "장기 적치 검토를 위해 관찰기간을 입력하세요."
                : review.storageWindowCovered
                  ? "관찰기간의 기존 재고전망이 있습니다. 새 화물의 소진·혼합 순서는 별도 확인이 필요합니다."
                  : "관찰기간 전체의 재고전망이 없어 장기 적치 판단을 보류합니다."}
            </li>
          </ul>
        </div>
        <p className="gf-ow-note">
          기존 계획의 재고·소모·입고는 그대로 유지합니다. 이 결과는 저장공간과
          일정 조건의 비교이며 구매 권고나 수정 재고전망이 아닙니다.
        </p>
        <p className="gf-ow-note">발전처 합계 기준 공간 비교입니다. 조회 시작일 발주를 가정하며 실제 Pile 접근·사용 가능 여부와 소진 순서는 별도 확인이 필요합니다.</p>
      </Panel>
      <Panel title="Pile별 반입·소진 검토" note="입력한 계획 기준 · 재고 변경 없음">
        <p className="gf-ow-note">위에서 선택한 반입일과 물량, 적정 저장기간을 사용합니다. 미래 잔량과 해당 화물의 사용량은 계획값으로 입력하세요.</p>
        <div className="gf-ow-assumptions">
          <label>반입 부두
            <select value={berth} onChange={event => setBerth(event.target.value)}>
              <option value="">선택</option>
              {[1,2,3].map(value => <option key={value} value={value}>{value}부두</option>)}
            </select>
          </label>
          <label>반입 구역
            <select value={endpoint} onChange={event => { setEndpoint(event.target.value); setPileCapacity(''); setProjectedStock(''); }}>
              <option value="">선택</option>
              {BerthRoutes.endpoints.map(item => <option key={item.id} value={item.id}>{item.yard}저탄장 · {item.label}</option>)}
            </select>
          </label>
          <label>구역 사용 한도 · t
            <input type="number" min="1" step="any" placeholder="계획 입력" value={pileCapacity} onChange={event => setPileCapacity(event.target.value)} />
          </label>
          <label>반입일 예상 잔량 · t
            <input type="number" min="0" step="any" placeholder="계획 입력" value={projectedStock} onChange={event => setProjectedStock(event.target.value)} />
          </label>
          <label>이 화물 사용 시작일 · KST
            <input type="date" value={useStart} onChange={event => setUseStart(event.target.value)} />
          </label>
          <label>이 화물 사용 계획 · t/일
            <input type="number" min="0" step="any" placeholder="계획 입력" value={dailyUse} onChange={event => setDailyUse(event.target.value)} />
          </label>
        </div>
        <div className="gf-ow-review" aria-live="polite">
          <dl className="gf-ow-facts">
            <div><dt>부두 연결</dt><dd>{({unknown:'부두·구역 선택', reachable:'계통 연결', blocked:'연결 불가'})[pileReview.route]}</dd></div>
            <div><dt>입력 한도와 물량 비교</dt><dd>{({unknown:'계획값 필요', sufficient:'입력 한도 이내', insufficient:'입력 한도 초과'})[pileReview.space]}</dd></div>
            <div><dt>적정 저장기한 · KST</dt><dd>{pileReview.storageEnd ?? '기간 미입력'}</dd></div>
            <div><dt>저장기한 내 사용 계획</dt><dd>{({unknown:'계획값 필요', complete:'전량 사용 계획', insufficient:'잔량 예상'})[pileReview.usage]}</dd></div>
            <div><dt>기한 내 예상 잔량</dt><dd>{pileReview.remaining === null ? '미확정' : `${fmt(pileReview.remaining, 1)} t`}</dd></div>
          </dl>
          <ul className="gf-ow-review-findings">
            <li>{!endpoint ? '구역을 선택하면 등록된 기준재고를 확인할 수 있습니다.' : baseline.error ? '기준재고를 불러오지 못했습니다.' : !baseline.data ? '기준재고를 불러오는 중입니다.' : baselineStock !== null ? `기준재고 ${fmt(baselineStock)} t · ${baseline.data.as_of ?? '기준일 미확인'} 기준` : '선택 구역의 기준재고가 없거나 확인되지 않았습니다.'}</li>
            <li>계통 연결은 설비 운전 가능 상태가 아닙니다. 설비 신호와 인접 더미 상부 이격거리는 별도 확인이 필요합니다.</li>
            <li>실제 설비 운전 신호: 미연결</li>
            <li>{routeSignals.state === 'connected' ? `운전 정보 ${routeSignals.playing ? '수신 중' : '일시정지'} · ${routeSignals.signals.map((signal,index) => `설비 ${index+1}번 ${({running:'운전',stopped:'정지',fault:'고장',unknown:'미확인'} as Record<string,string>)[signal.status]}${signal.flow !== null ? ` ${fmt(signal.flow, 1)} t/h` : ''}`).join(' · ')}` : '운전 신호: 미연결 또는 선택 경로 없음'}</li>
            <li>저장기한 내 사용량은 입하 다음 날부터 기한일까지 입력한 일일 사용량이 일정하다고 가정합니다. 다른 화물의 사용량은 포함하지 않습니다.</li>
          </ul>
        </div>
      </Panel>
      <Panel
        title={`${group.name} 일별 재고전망`}
        note="저장 결과 · 가정 반입 미반영"
      >
        <ScrollTable label="반입 검토일별 재고전망">
          <thead>
            <tr>
              <th>일자 KST</th>
              <th className="gf-ow-number">재고 t</th>
              <th className="gf-ow-number">재고일수</th>
              <th>검토 기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.day} data-selected={row.day === arrivalDay}>
                <td>{row.day}</td>
                <td className="gf-ow-number">{fmt(row.stock)}</td>
                <td className="gf-ow-number">{fmt(row.days, 1)}</td>
                <td>
                  {row.day === arrivalDay
                    ? "반입 검토일"
                    : row.stock === null
                      ? "미확정"
                      : row.stock < 0
                        ? "계획상 부족"
                        : "저장 계획"}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </Panel>
    </fieldset>
  );
}
export function ProcurementWorkspace({
  planning,
  demoSnapshot,
  demoStatus,
  demoCatalog,
}: {
  planning: PlanningState;
  demoSnapshot: FuelDemoSnapshot | null;
  demoStatus: FuelDemoStatus;
  demoCatalog: FuelDemoCatalog | null;
}) {
  return (
    <Workspace
      title="구매 검토"
      description="연료 계획·재고 전망과 조달 일정·저장공간의 조건을 함께 확인합니다."
    >
      <PlanningWorkspace state={planning}>
        {(snapshot) => (
          <ReceiptReview
            key={`${snapshot.run_id}-${snapshot.start}-${snapshot.horizon_days}`}
            snapshot={snapshot}
            demoSnapshot={demoSnapshot} demoStatus={demoStatus} demoCatalog={demoCatalog}
          />
        )}
      </PlanningWorkspace>
    </Workspace>
  );
}

export function ConnectionsWorkspace({
  planning,
  status,
  receivedAt,
  onNavigate,
}: {
  planning: PlanningState;
  status: string;
  receivedAt: number | null;
  onNavigate: (page: string) => void;
}) {
  const snapshot = planning.current;
  const apiState = planning.failed
    ? "조회 실패"
    : planning.listLoading || planning.loading
      ? "조회 중"
      : snapshot
        ? "조회 완료"
        : "저장 결과 없음";
  const received =
    receivedAt === null || !Number.isFinite(receivedAt) || receivedAt <= 0
      ? "수신 기록 없음"
      : new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          dateStyle: "short",
          timeStyle: "medium",
        }).format(new Date(receivedAt)) + " KST";
  return (
    <Workspace
      title="연결·수집"
      description="현재 앱에서 확인한 응답과 자료 출처를 확인합니다."
      action={
        <button
          className="gf-ow-action"
          type="button"
          onClick={planning.refresh}
          disabled={planning.listLoading || planning.loading}
        >
          <RefreshCw size={15} />
          계획 다시 조회
        </button>
      }
    >
      <div className="gf-ow-even">
        <Panel title="ZGX 공용 계획 API" note={apiState}>
          <div className="gf-ow-connection-title">
            <Database size={22} />
            <strong>{snapshot ? snapshot.name : apiState}</strong>
          </div>
          <dl className="gf-ow-facts">
            <div>
              <dt>연결 범위</dt>
              <dd>계정·저장 계획·공통 수급 원장</dd>
            </div>
            <div>
              <dt>선택 계산</dt>
              <dd>{snapshot?.run_id ?? planning.query?.runId ?? "미선택"}</dd>
            </div>
            <div>
              <dt>선택 조회기간</dt>
              <dd>
                {snapshot ? `${snapshot.start} ~ ${snapshot.end}` : "미확정"}
              </dd>
            </div>
            <div>
              <dt>계산 저장시각</dt>
              <dd>
                {snapshot?.generated_at?.slice(0, 16).replace("T", " ") ??
                  "미확정"}
                {snapshot ? " KST" : ""}
              </dd>
            </div>
          </dl>
          {planning.failed && (
            <p className="gf-ow-error" role="alert">
              {planning.failed}
            </p>
          )}
          <p className="gf-ow-note">
            조회 완료는 선택한 API 응답을 받은 상태입니다. 서버의 전체 상태나
            실제 설비 연결을 의미하지 않습니다.
          </p>
          <LinkButton onClick={() => onNavigate("data")}>
            데이터·원장 열기
          </LinkButton>
        </Panel>
        <Panel title="로컬 운전 데모" note={demoStatus(status)}>
          <div className="gf-ow-connection-title">
            <Radio size={22} />
            <strong>{demoStatus(status)}</strong>
          </div>
          <dl className="gf-ow-facts">
            <div>
              <dt>신호 출처</dt>
              <dd>별도 WebSocket 모사 서버</dd>
            </div>
            <div>
              <dt>마지막 수신</dt>
              <dd>{received}</dd>
            </div>
            <div>
              <dt>운영 DB 영향</dt>
              <dd>쓰기 없음</dd>
            </div>
            <div>
              <dt>연결 끊김 동작</dt>
              <dd>마지막 값 유지 · 장면 정지</dd>
            </div>
          </dl>
          <p className="gf-ow-note">
            참고 재고에서 시작하는 시연입니다. 실제 ZGX 설비 신호와
            구분합니다.
          </p>
          <LinkButton onClick={() => onNavigate("demo-control")}>
            데모 조작반 열기
          </LinkButton>
        </Panel>
      </div>
      <Panel title="자료별 연결 범위" note="앱에서 제공하는 자료 기준">
        <ScrollTable label="자료 연결 상태 표">
          <thead>
            <tr>
              <th>자료</th>
              <th>현재 범위</th>
              <th>확인 위치</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>발전·연료 계획</td>
              <td>{snapshot ? "저장 계산 조회 가능" : "선택 결과 미확정"}</td>
              <td>
                <LinkButton onClick={() => onNavigate("models")}>
                  모델·계획
                </LinkButton>
              </td>
            </tr>
            <tr>
              <td>공용 재고·입하 원장</td>
              <td>선택 계산과 연계된 DB 수급</td>
              <td>
                <LinkButton onClick={() => onNavigate("fuel-ledger")}>
                  수급 원장
                </LinkButton>
              </td>
            </tr>
            <tr>
              <td>실제 AIS·기상</td>
              <td>관심 선박별 수신 시각·출처 확인</td>
              <td>
                <LinkButton onClick={() => onNavigate("vessels")}>
                  항차·화물
                </LinkButton>
              </td>
            </tr>
            <tr>
              <td>실제 발전 출력·상탄 계량</td>
              <td>실측 연결 전</td>
              <td>실적 미확정</td>
            </tr>
            <tr>
              <td>Pile 온도·CO</td>
              <td>센서 미연결</td>
              <td>위험 실측 미확정</td>
            </tr>
          </tbody>
        </ScrollTable>
      </Panel>
      <div className="gf-ow-source-strip">
        <Cable size={17} />
        <span>
          ZGX 연결에 실패하면 운영 자료를 시연 자료로 자동 대체하지
          않습니다.
        </span>
        <ClipboardCheck size={17} />
      </div>
    </Workspace>
  );
}

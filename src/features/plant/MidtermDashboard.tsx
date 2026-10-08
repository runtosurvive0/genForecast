import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, CalendarClock, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TowerChart } from "../../components/TowerChart";
import {
  addDays,
  loadPlanningRuns,
  loadPlanningSnapshot,
  type PlanningRun,
  type PlanningSnapshot,
} from "../../domain/planning";
import "./midterm.css";

const fmt = (value: number | null, digits = 0) =>
  value === null
    ? "—"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const sum = (values: (number | null)[]) =>
  values.length && values.every((v) => v !== null)
    ? values.reduce<number>((s, v) => s + v!, 0)
    : null;
const axis = (name: string) => ({
  type: "value",
  name,
  splitLine: { lineStyle: { color: "#88888818" } },
});
const line = (name: string, data: (number | null)[], extra = {}) => ({
  name,
  type: "line",
  showSymbol: false,
  connectNulls: false,
  data,
  ...extra,
});
const initialQuery = (run: PlanningRun) => ({
  runId: run.id,
  start: run.start,
  horizon: addDays(run.start, 29) <= run.end ? 30 : 7,
});
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="tower-section">
      <header>
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <div className="tower-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{note}</p>
    </div>
  );
}

function Outages({ snapshot: s }: { snapshot: PlanningSnapshot }) {
  const first = Date.parse(s.start + "T00:00:00+09:00");
  const last = Date.parse(addDays(s.end, 1) + "T00:00:00+09:00");
  const visible = s.outages.filter(
    (o) => Date.parse(o.end_at) > first && Date.parse(o.start_at) < last,
  );
  return (
    <Section
      title="호기별 계획정지 일정"
      note={`${s.start} ~ ${s.end} · 선택한 MILP 계산에 반영된 일정 · 종료시각 제외`}
    >
      <div className="midterm-outage-axis">
        <span>{s.start}</span>
        <span>{s.end}</span>
      </div>
      <div className="midterm-outages">
        {s.units.map((u) => (
          <div className="midterm-outage-row" key={u.unit_id}>
            <span>{u.name}</span>
            <div className="midterm-outage-track">
              {visible
                .filter((o) => o.unit_id === u.unit_id)
                .map((o, i) => {
                  const left = Math.max(first, Date.parse(o.start_at));
                  const end = Math.min(last, Date.parse(o.end_at));
                  return (
                    <span
                      className="midterm-outage-bar"
                      key={i}
                      title={`${o.name}: ${o.start_at} ~ ${o.end_at} · ${o.note}`}
                      style={{
                        left: `${((left - first) / (last - first)) * 100}%`,
                        width: `${((end - left) / (last - first)) * 100}%`,
                      }}
                    />
                  );
                })}
              {!visible.some((o) => o.unit_id === u.unit_id) && (
                <small>등록 일정 없음</small>
              )}
            </div>
          </div>
        ))}
      </div>
      {visible.length ? (
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>호기</th>
                <th>정지 시작 KST</th>
                <th>재가동 시각 KST</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o, i) => (
                <tr key={i}>
                  <td>{o.name}</td>
                  <td>{o.start_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{o.end_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{o.note || "계획정지"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="tower-footnote">
          이 기간에 등록된 당진 정지 일정이 없습니다. 계획정지 자료의 등록
          여부를 확인하세요.
        </p>
      )}
    </Section>
  );
}

function Models({
  snapshot: s,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  const dates = s.models.map((d) => d.day.slice(5));
  return (
    <div className="tower-two">
      <Section
        title="전국 일평균·최대 전력수요"
        note="Python 시간별 수요 예측의 KST 일별 집계 · 당진 발전소 수요와 구분"
      >
        <TowerChart
          theme={theme}
          label="전국 일평균 및 최대 전력수요 MW"
          option={{
            xAxis: { type: "category", data: dates },
            yAxis: axis("MW"),
            series: [
              line(
                "일평균 수요",
                s.models.map((d) => d.demand_mw),
              ),
              line(
                "최대 수요",
                s.models.map((d) => d.demand_peak_mw),
              ),
            ].filter((entry) => entry.data.some((value) => value !== null)),
          }}
        />
      </Section>
      <Section
        title="전국 석탄 목표·가용용량·MILP"
        note="필요발전량은 ML 예측, 가용용량은 설비·계획정지에서 산출"
      >
        <TowerChart
          theme={theme}
          label="전국 석탄 ML 필요발전량 보정 목표 가용용량 및 MILP 결과 MW"
          height={265}
          option={{
            grid: { left: 60, right: 15, top: 65, bottom: 35 },
            xAxis: { type: "category", data: dates },
            yAxis: axis("MW"),
            series: [
              line(
                "ML 필요발전량",
                s.models.map((d) => d.coal_ml_mw),
              ),
              line(
                "보정 목표",
                s.models.map((d) => d.coal_target_mw),
              ),
              line(
                "MILP 발전량",
                s.models.map((d) => d.coal_mip_mw),
              ),
              line(
                "가용용량",
                s.models.map((d) => d.coal_available_mw),
                { lineStyle: { type: "dashed" } },
              ),
            ].filter((entry) => entry.data.some((value) => value !== null)),
          }}
        />
        {s.models.some((d) => d.coal_available_mw === null) && (
          <p className="tower-footnote">
            가용용량 시계열 미보존 · 이 결과에서는 표시 보류
          </p>
        )}
      </Section>
    </div>
  );
}

function Inventory({
  snapshot: s,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  return (
    <Section
      title="처별 연료 수급전망"
      note="DB 기준재고 + 입하·이탄 − 계획 소비량 · 재고 부족은 발전계획을 자동 변경하지 않습니다."
    >
      <div className="midterm-inventory-cards">
        {s.inventory.groups.map((g) => (
          <div key={g.id}>
            <span>{g.name}</span>
            <strong>
              {g.stock === null ? "기준재고 미등록" : `${fmt(g.stock)} t`}
            </strong>
            <p>
              재고일수 {g.days === null ? "미확정" : `${fmt(g.days, 1)}일`} ·
              입하예정 {fmt(g.expected_receipts)} t
            </p>
            <small>
              {{
                unknown: "위험도 미확정",
                danger: "위험",
                caution: "주의",
                normal: "정상",
              }[g.risk] ?? "위험도 미확정"}
              {(g.stale || s.inventory.plan_stale) && " · 자료 갱신 확인 필요"}
            </small>
          </div>
        ))}
      </div>
      {s.inventory.daily.some((d) =>
        Object.values(d.groups).some((g) => g.stock !== null),
      ) ? (
        <TowerChart
          theme={theme}
          label="처별 일말 예상 석탄 재고 톤"
          option={{
            xAxis: {
              type: "category",
              data: s.inventory.daily.map((d) => d.day.slice(5)),
            },
            yAxis: axis("일말 재고 · t"),
            series: s.inventory.groups.map((g) =>
              line(
                g.name,
                s.inventory.daily.map((d) => d.groups[g.id].stock),
              ),
            ),
          }}
        />
      ) : (
        <div className="midterm-empty">
          DB 기준재고를 등록하면 처별 재고와 부족 예상일을 표시합니다.
        </div>
      )}
      <p className="tower-footnote">
        일말 재고 ÷ 다음 7일 평균 사용량. 추가 7일 계획이 없거나 소비가 0이면
        일수를 표시하지 않습니다. 이 전망은 저탄장 혼합 발열량을 사용합니다.
      </p>
    </Section>
  );
}

function Results({
  snapshot: s,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  const mwh = sum(s.units.map((u) => u.generation_mwh));
  const fuel = sum(s.units.map((u) => u.fuel_tonnes));
  const capacity = s.units.reduce((t, u) => t + u.capacity_mw, 0);
  return (
    <>
      <div className="tower-kpis midterm-kpis">
        <Metric
          label="당진 계획 발전량"
          value={fmt(mwh === null ? null : mwh / 1000, 1)}
          unit="GWh"
          note={`${s.horizon_days}일 · MILP 계획`}
        />
        <Metric
          label="석탄 사용 예정량"
          value={fmt(fuel)}
          unit="t"
          note={`${fmt(s.fuel.calorific_kcal_kg)} kcal/kg · ${s.fuel.is_assumption ? "임시 가정" : "등록 기준"}`}
        />
        <Metric
          label="기간 이용률"
          value={fmt(
            mwh === null
              ? null
              : (mwh / (capacity * s.horizon_days * 24)) * 100,
            1,
          )}
          unit="%"
          note={`당진 10개 호기 · ${fmt(capacity)} MW`}
        />
        <Metric
          label="DB 기준 보유 재고"
          value={
            s.inventory.kpis.stock === null
              ? "미등록"
              : fmt(s.inventory.kpis.stock)
          }
          unit={s.inventory.kpis.stock === null ? undefined : "t"}
          note="입력 기준재고와 원장으로 계산"
        />
        <Metric
          label="기간 최소 재고일수"
          value={
            s.inventory.kpis.min_days === null
              ? "미확정"
              : fmt(s.inventory.kpis.min_days, 1)
          }
          unit={s.inventory.kpis.min_days === null ? undefined : "일"}
          note="처별 전망 중 최소 · 최신성 확인 필요"
        />
        <Metric
          label="입력된 당진 계획정지"
          value={String(s.outages.length)}
          unit="건"
          note="선택한 전체 계산에 등록된 일정"
        />
      </div>
      <Section
        title="일별 발전·석탄 사용계획"
        note={`${s.start} ~ ${s.end} · KST 00~24시 · 고정 기준 발열량으로 구매계획 환산`}
      >
        <TowerChart
          theme={theme}
          label="당진 일별 석탄 사용 예정량 톤 및 발전량 MWh"
          option={{
            grid: { left: 65, right: 70, top: 45, bottom: 35 },
            xAxis: {
              type: "category",
              data: s.daily.map((d) => d.date.slice(5)),
            },
            yAxis: [
              axis("석탄 · t"),
              { ...axis("발전량 · MWh"), position: "right" },
            ],
            series: [
              {
                name: "석탄 사용 예정량",
                type: "bar",
                data: s.daily.map((d) => d.fuel_tonnes),
                itemStyle: { borderRadius: [3, 3, 0, 0] },
              },
              line(
                "계획 발전량",
                s.daily.map((d) => d.generation_mwh),
                { yAxisIndex: 1 },
              ),
            ],
          }}
          height={280}
        />
      </Section>
      <div className="tower-two">
        <Section
          title="월별 석탄 사용 예정량"
          note="선택한 계산의 전체 기간 · 온전한 월 계획이 있을 때 월 합계 표시"
        >
          <TowerChart
            theme={theme}
            label="당진 월별 석탄 사용 예정량 톤"
            option={{
              xAxis: {
                type: "category",
                data: s.monthly.map((m) => m.month.slice(2)),
              },
              yAxis: axis("t"),
              series: [
                {
                  name: "월별 예정량",
                  type: "bar",
                  data: s.monthly.map((m) => m.fuel_tonnes),
                },
              ],
            }}
          />
          <div className="tower-table-wrap">
            <table className="tower-table">
              <thead>
                <tr>
                  <th>월</th>
                  <th>사용 예정량 t</th>
                  <th>계획 일수</th>
                </tr>
              </thead>
              <tbody>
                {s.monthly.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{fmt(m.fuel_tonnes)}</td>
                    <td>
                      {m.complete_days}/{m.expected_days}
                      {m.complete_days < m.expected_days ? " · 일부 기간" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section
          title="호기별 기간 이용률"
          note="전체 조회시간의 설비용량을 분모로 산출 · 계획정지 포함"
        >
          <TowerChart
            theme={theme}
            label="당진 1호기부터 10호기 기간 이용률 퍼센트"
            option={{
              xAxis: {
                type: "category",
                data: s.units.map((u) => u.unit_id.replace("dj-", "") + "호"),
              },
              yAxis: { ...axis("%"), max: 100 },
              series: [
                {
                  name: "이용률",
                  type: "bar",
                  data: s.units.map((u) => u.capacity_factor_pct),
                },
              ],
            }}
          />
          <div className="tower-table-wrap">
            <table className="tower-table">
              <thead>
                <tr>
                  <th>호기</th>
                  <th>MW</th>
                  <th>이용률 %</th>
                  <th>발전량 MWh</th>
                  <th>석탄 t</th>
                </tr>
              </thead>
              <tbody>
                {s.units.map((u) => (
                  <tr key={u.unit_id} data-unit-id={u.unit_id}>
                    <td>{u.name}</td>
                    <td>{fmt(u.capacity_mw)}</td>
                    <td>{fmt(u.capacity_factor_pct, 1)}</td>
                    <td>{fmt(u.generation_mwh)}</td>
                    <td>{fmt(u.fuel_tonnes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
      <Models snapshot={s} theme={theme} />
      <Outages snapshot={s} />
      <Inventory snapshot={s} theme={theme} />
    </>
  );
}

export function MidtermDashboard({ theme }: { theme: string }) {
  const [runs, setRuns] = useState<PlanningRun[]>([]);
  const [query, setQuery] = useState<{
    runId: string;
    start: string;
    horizon: number;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    loadPlanningRuns(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setRuns(rows);
        setQuery((current) =>
          current && rows.some((r) => r.id === current.runId)
            ? current
            : rows[0]
              ? initialQuery(rows[0])
              : null,
        );
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setListError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSnapshot(null);
    loadPlanningSnapshot(
      query.runId,
      query.start,
      query.horizon,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);
  const selected = runs.find((r) => r.id === query?.runId);
  const current =
    snapshot &&
    query &&
    snapshot.run_id === query.runId &&
    snapshot.start === query.start &&
    snapshot.horizon_days === query.horizon
      ? snapshot
      : null;
  const failed = listError || error;
  return (
    <div className="tower-page midterm-page">
      <div className="midterm-controls">
        <label>
          저장된 MILP 계산
          <select
            aria-label="저장된 MILP 계산"
            value={query?.runId ?? ""}
            disabled={listLoading || !runs.length}
            onChange={(e) => {
              const r = runs.find((x) => x.id === e.target.value)!;
              setQuery(initialQuery(r));
            }}
          >
            {!runs.length && <option value="">계산 목록 없음</option>}
            {runs.map((r) => (
              <option value={r.id} key={r.id}>
                {r.name} · {r.period}
              </option>
            ))}
          </select>
        </label>
        <label>
          조회 시작일 · KST
          <input
            aria-label="MILP 조회 시작일"
            type="date"
            value={query?.start ?? ""}
            min={selected?.start}
            max={
              selected && query
                ? addDays(selected.end, 1 - query.horizon)
                : undefined
            }
            disabled={!query || listLoading}
            onChange={(e) => {
              if (query && e.target.value)
                setQuery({ ...query, start: e.target.value });
            }}
          />
        </label>
        <div
          className="horizon-control"
          role="group"
          aria-label="MILP 조회 기간"
        >
          {[7, 30, 60, 90].map((days) => (
            <button
              key={days}
              aria-pressed={query?.horizon === days}
              className={query?.horizon === days ? "selected" : ""}
              disabled={
                !query ||
                !selected ||
                addDays(query.start, days - 1) > selected.end
              }
              onClick={() => query && setQuery({ ...query, horizon: days })}
            >
              {days}일
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRevision((n) => n + 1)}
          disabled={loading || listLoading}
        >
          <RefreshCw size={14} />
          새로고침
        </Button>
      </div>
      {failed ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>MILP 결과를 불러오지 못했습니다.</strong>
            <p>{failed}</p>
            <p>Python 서버와 선택한 계산 기간을 확인한 뒤 새로고침하세요.</p>
          </div>
        </div>
      ) : listLoading || loading || (query && !current) ? (
        <div className="midterm-empty" role="status">
          저장된 MILP 결과를 불러오는 중입니다…
        </div>
      ) : !current ? (
        <div className="midterm-empty">
          저장된 MILP 계산이 없습니다. Python 백엔드에 계산 결과를 등록하세요.
        </div>
      ) : (
        <>
          <div className="tower-context midterm-source">
            <div>
              <span className="tower-tag">
                {current.classification === "functional_demo"
                  ? "동작 확인용 MILP"
                  : "저장된 MILP 전망"}
              </span>
              <span>당진 1~10호기</span>
            </div>
            <span>
              {current.start} ~ {current.end} · KST
            </span>
          </div>
          <p className="midterm-provenance">
            계산 ID {current.run_id} · 결과 저장{" "}
            {current.generated_at.slice(0, 16).replace("T", " ")} KST
          </p>
          {current.classification_note && (
            <p className="midterm-notice">{current.classification_note}</p>
          )}
          <Results snapshot={current} theme={theme} />
          <Section title="자료 확인사항">
            <ul className="midterm-issues">
              {current.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
            <p className="tower-footnote">{current.fuel_method}</p>
          </Section>
          <div className="midterm-footer">
            <CalendarClock size={14} /> 저장된 계획 조회 · 현재 운전 실적과 구분
            · 모든 패널은 같은 계산 결과를 사용합니다.
          </div>
        </>
      )}
    </div>
  );
}

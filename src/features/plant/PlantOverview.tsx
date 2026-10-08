import { useMemo } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TowerChart } from "@/components/TowerChart";
import { inventoryStatus, type TowerSummary } from "@/domain/control-tower";
import { type ModelRuns } from "@/domain/models";
import { BASE_TIME, type Plant } from "@/domain/operations";
import { number as n, date as fmtDate } from "@/lib/format";
import { Section, Metric } from "@/components/tower/primitives";
import { axis, line, labelDay } from "@/components/tower/chart-options";
import { ModelCard } from "@/components/tower/ModelCard";
import "./plant.css";

export function PlantOverview({
  summary,
  plants,
  models,
  theme,
  onSchedule,
  onScenario,
  onPlant,
}: {
  summary: TowerSummary;
  plants: Plant[];
  models: ModelRuns;
  theme: string;
  onSchedule: () => void;
  onScenario: () => void;
  onPlant: (id: string) => void;
}) {
  const s = summary;
  const outages = plants
    .flatMap((p) =>
      p.units.flatMap((u) => u.outages.map((o) => ({ ...o, unit: u.name }))),
    )
    .filter((o) => Date.parse(o.endAt) > Date.parse(BASE_TIME))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const next = outages.find(
    (o) => Date.parse(o.startAt) > Date.parse(BASE_TIME),
  );
  const monthly = Object.values(
    s.daily.reduce<
      Record<
        string,
        { month: string; inbound: number; fuel: number; stock: number }
      >
    >((acc, d) => {
      const month = d.date.slice(0, 7);
      const row = acc[month] ?? { month, inbound: 0, fuel: 0, stock: 0 };
      row.inbound += d.inbound;
      row.fuel += d.fuel;
      row.stock = d.stock;
      acc[month] = row;
      return acc;
    }, {}),
  );
  const chart = useMemo(
    () => ({
      xAxis: {
        type: "category",
        data: s.daily.map((d) =>
          labelDay(
            new Date(Date.parse(d.date) + 86400000).toISOString().slice(0, 10),
          ),
        ),
        boundaryGap: false,
      },
      yAxis: [axis("재고 · t"), { ...axis("일별 · t"), position: "right" }],
      series: [
        line(
          "예상 재고",
          s.daily.map((d) => d.stock),
          { areaStyle: { opacity: 0.06 } },
        ),
        {
          name: "입하량",
          type: "bar",
          yAxisIndex: 1,
          data: s.daily.map((d) => d.inbound),
          barMaxWidth: 12,
        },
        line(
          "예상 연료사용",
          s.daily.map((d) => d.requestedFuel),
          { yAxisIndex: 1, lineStyle: { width: 1.5, type: "dashed" } },
        ),
      ],
      grid: { left: 64, right: 60, top: 45, bottom: 32 },
    }),
    [s],
  );
  return (
    <div className="tower-page">
      <div className="tower-context">
        <span>
          <i />
          SYNTHETIC DATA · 기준 {fmtDate(BASE_TIME, true)}
        </span>
        <div>
          <Button variant="outline" size="sm" onClick={onSchedule}>
            <CalendarClock size={14} />
            정지계획
          </Button>
        </div>
      </div>
      <div className="tower-kpis">
        <Metric
          label="현재 재고"
          value={n(s.currentStock)}
          unit="t"
          note="저탄장 Pile 합계"
        />
        <Metric
          label="현재 재고일수"
          value={s.coverageDays === null ? "—" : n(s.coverageDays, 1)}
          unit="일"
          note={inventoryStatus(s.coverageDays) + " · 첫날 예상 사용량 기준"}
        />
        <Metric
          label="기간 내 입하 예정"
          value={n(s.incomingTons)}
          unit="t"
          note="취소 제외 · 하역 완료 기준"
        />
        <Metric
          label="재고 가중평균 열량"
          value={n(s.currentCv ?? 0)}
          unit="kcal/kg"
          note="Pile별 중량 가중"
        />
        <Metric
          label="입하탄 가중평균 열량"
          value={s.incomingCv === null ? "—" : n(s.incomingCv)}
          unit="kcal/kg"
          note="선택 기간 내 화물 기준"
        />
        <Metric
          label="현재 평균 이용률"
          value={n(s.currentUtilization, 1)}
          unit="%"
          note="호기 평균 · 정지 호기 포함"
        />
        <Metric
          label="7일 예상 평균 이용률"
          value={n(s.futureUtilization, 1)}
          unit="%"
          note="가동 가능 시간 기준 · 모델 연계"
        />
        <Metric
          label="일일 예상 연료사용량"
          value={n(s.dailyFuel)}
          unit="t/day"
          note="첫날 계획 발전량 → 연료 환산"
        />
        <Metric
          label="최저 예상 재고일수"
          value={s.minimum ? n(s.minimum.inventoryDays!, 1) : "—"}
          unit="일"
          note={
            s.minimum
              ? `${new Date(Date.parse(s.minimum.date) + 86400000).toISOString().slice(0, 10)} 09:00 · 이후 7일 기준`
              : "소비 계획 없음"
          }
        />
      </div>
      <div className="tower-signal">
        <div>
          <span>현재 재고로 발전 가능</span>
          <strong>
            {n(s.forecast.availableEnergyGwh, 1)} <small>GWh</small>
          </strong>
        </div>
        <div>
          <span>첫 연료 부족 예상</span>
          <strong>
            {s.forecast.firstShortageAt
              ? fmtDate(s.forecast.firstShortageAt, true)
              : "기간 내 없음"}
          </strong>
        </div>
        <div>
          <span>다음 계획정지</span>
          <strong>
            {next
              ? `${next.unit} · ${fmtDate(next.startAt, true)}`
              : "기간 내 없음"}
          </strong>
        </div>
      </div>
      <Section
        title="연료 수급 전망"
        note="가로축: 다음날 09:00 KST 기말 재고 · 입하/사용: 직전 24시간 집계 · 재고 = 전일 재고 + 하역 완료량 − 실제 사용량"
      >
        <TowerChart
          option={chart}
          theme={theme}
          label="선택 기간의 예상 재고, 입하량, 일별 계획 연료사용량"
          height={290}
        />
        <p className="tower-footnote">
          재고가 소진되면 실제 발전과 사용량은 제한됩니다. 점선은 공급 부족과
          무관한 계획 연료수요입니다.
        </p>
      </Section>
      <div className="tower-two">
        <Section
          title="발전소별 재고"
          note="발전소 간 재고를 공유하지 않습니다"
        >
          <div className="tower-table-wrap">
            <table className="tower-table">
              <thead>
                <tr>
                  <th>발전소</th>
                  <th>재고 · t</th>
                  <th>입하 · t</th>
                  <th>재고일수</th>
                </tr>
              </thead>
              <tbody>
                {s.forecast.byPlant.map((p) => {
                  const incoming = s.daily.length
                    ? s.forecast.byPlant
                        .find((x) => x.plantId === p.plantId)!
                        .daily.reduce((a, d) => a + d.inboundTons, 0)
                    : 0;
                  const days = p.daily[0]?.requestedFuelTons
                    ? p.inventoryTons / p.daily[0].requestedFuelTons
                    : null;
                  return (
                    <tr key={p.plantId}>
                      <td>
                        <button onClick={() => onPlant(p.plantId)}>
                          {p.name}
                          <ArrowRight size={12} />
                        </button>
                      </td>
                      <td>{n(p.inventoryTons)}</td>
                      <td>{n(incoming)}</td>
                      <td>
                        <span
                          className={`tower-status ${inventoryStatus(days) === "위험" ? "risk" : ""}`}
                        >
                          {days === null ? "—" : n(days, 1) + "일"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
        <Section
          title="호기별 이용률"
          note="현재 / 향후 7일 · 정비 시간 제외 후 예측 이용률 산정"
        >
          <TowerChart
            theme={theme}
            label="호기별 현재 및 7일 예측 이용률 비교"
            option={{
              grid: { left: 82, right: 28, top: 30, bottom: 25 },
              xAxis: { ...axis("%"), max: 100 },
              yAxis: {
                type: "category",
                data: s.units.map((u) => u.name),
                axisLabel: { fontSize: 10 },
              },
              series: [
                {
                  name: "현재",
                  type: "bar",
                  data: s.units.map((u) => u.currentUtilization),
                  barMaxWidth: 7,
                },
                {
                  name: "7일 예측",
                  type: "bar",
                  data: s.units.map((u) => u.futureUtilization),
                  barMaxWidth: 7,
                },
              ],
            }}
          />
        </Section>
      </div>
      <Section
        title="월별 수급 집계"
        note="선택한 전망 기간에 포함된 일자만 합산 · 월 경계는 일별 구간 시작일 기준"
      >
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>월</th>
                <th>입하량 · t</th>
                <th>실제 사용량 · t</th>
                <th>기간 말 재고 · t</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{n(m.inbound)}</td>
                  <td>{n(m.fuel)}</td>
                  <td>{n(m.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title="호기별 발전·연료 계획"
        note="향후 7일 계획값 · 정비 반영 / 연료 부족 전 계획수요"
      >
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>호기</th>
                <th>현재 발전 · MW</th>
                <th>7일 발전 · MWh</th>
                <th>7일 연료수요 · t</th>
                <th>가동 가능 · h</th>
              </tr>
            </thead>
            <tbody>
              {s.units.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{n(u.currentGenerationMw)}</td>
                  <td>{n(u.forecastGenerationMwh)}</td>
                  <td>{n(u.forecastFuelTons)}</td>
                  <td>{u.availableHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="tower-two">
        <ModelCard model={models.demand} theme={theme} />
        <ModelCard model={models.capacity} theme={theme} />
      </div>
    </div>
  );
}

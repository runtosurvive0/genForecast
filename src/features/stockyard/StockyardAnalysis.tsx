import { TowerChart } from "@/components/TowerChart";
import { Section } from "@/components/tower/primitives";
import { axis } from "@/components/tower/chart-options";
import type { Stockpile } from "@/data/control-tower";
import { pileRisk } from "@/domain/control-tower";
import { number as n } from "@/lib/format";
import type { pileBlend, StockGroup } from "./stockyard-domain";

export type AnalysisTab = "blend" | "mix" | "risk";
const TABS: { id: AnalysisTab; label: string }[] = [
  { id: "blend", label: "혼탄 요약" },
  { id: "mix", label: "탄종 구성" },
  { id: "risk", label: "적치·위험" },
];

/** 분석: 주간 소진·혼탄 요약 / 탄종 구성 / 적치일수×위험 산점도. */
export function StockyardAnalysis({
  theme,
  tab,
  onTab,
  blend,
  groups,
  piles,
  onSelectPile,
}: {
  theme: string;
  tab: AnalysisTab;
  onTab: (tab: AnalysisTab) => void;
  blend: ReturnType<typeof pileBlend>;
  groups: StockGroup[];
  piles: Stockpile[];
  onSelectPile: (id: string) => void;
}) {
  const mix = Object.entries(
    piles.reduce<Record<string, number>>((acc, p) => {
      acc[p.coal_type] = (acc[p.coal_type] ?? 0) + p.on_hand_t;
      return acc;
    }, {}),
  );
  const burnBy = groups.map((g) => ({
    label: g.label,
    burned: blend.rows
      .filter((r) => g.piles.some((p) => p.stockpile_id === r.stockpile_id))
      .reduce((s, r) => s + r.burnedTons, 0),
  }));
  const top = [...blend.rows]
    .filter((r) => r.burnedTons > 0)
    .sort((a, b) => b.burnedTons - a.burnedTons)
    .slice(0, 10);
  return (
    <Section
      title="분석"
      note="현재 부하 표본 기준 · 운영 지시가 아닙니다"
      action={<span className="tower-tag">SIMULATED</span>}
    >
      <div className="stockyard-tabs" role="tablist" aria-label="분석 보기">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`analysis-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="analysis-panel"
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="analysis-panel" role="tabpanel" aria-labelledby={`analysis-tab-${tab}`}>
        {tab === "blend" && (
          <>
            <h3 className="stockyard-subhead">주간 소진 · 혼탄 시뮬레이션</h3>
            <div className="stockyard-blend-summary">
              <span>
                주간 소비 <strong>{n(blend.burnTotal)} t</strong>
              </span>
              <span>
                소진 전 가중열량 <strong>{blend.beforeCv ? n(blend.beforeCv) : "-"} kcal/kg</strong>
              </span>
              <span>
                소진 후 가중열량 <strong>{blend.afterCv ? n(blend.afterCv) : "-"} kcal/kg</strong>
              </span>
            </div>
            <div className="stockyard-blend-grid">
              <TowerChart
                theme={theme}
                height={220}
                label="처·발전소별 주간 소진량"
                option={{
                  tooltip: { trigger: "axis" },
                  grid: { top: 16, right: 16, bottom: 28, left: 56 },
                  xAxis: { type: "category", data: burnBy.map((b) => b.label) },
                  yAxis: axis("t"),
                  series: [
                    {
                      name: "주간 소진",
                      type: "bar",
                      barMaxWidth: 26,
                      data: burnBy.map((b) => Math.round(b.burned)),
                    },
                  ],
                }}
              />
              <div>
                <strong className="stockyard-list-title">소진 상위 Pile</strong>
                <ol className="stockyard-top-list">
                  {top.map((r) => (
                    <li key={r.stockpile_id}>
                      <button onClick={() => onSelectPile(r.stockpile_id)}>{r.stockpile_id}</button>
                      <span>
                        {n(r.burnedTons)} t → 잔량 {n(r.afterTons)} t
                      </span>
                    </li>
                  ))}
                  {!top.length && <li>소진 배분 대상이 없습니다</li>}
                </ol>
              </div>
            </div>
            <p className="tower-footnote">
              7일 계획 연료를 투입 가능 호기 기준으로 Pile에 배분했습니다. Pile별 소진·잔량은 아래 원장 열에 있습니다.
            </p>
          </>
        )}
        {tab === "mix" && (
          <TowerChart
            theme={theme}
            label="탄종별 재고 중량 비율"
            option={{
              tooltip: { trigger: "item", formatter: "{b}: {c} t ({d}%)" },
              legend: { bottom: 0, top: "auto" },
              series: [
                {
                  type: "pie",
                  radius: ["46%", "72%"],
                  center: ["50%", "43%"],
                  label: { show: false },
                  data: mix.map(([name, value]) => ({ name, value })),
                },
              ],
            }}
          />
        )}
        {tab === "risk" && (
          <>
            <TowerChart
              theme={theme}
              label="Pile 적치일수와 위험 점수 산점도"
              option={{
                tooltip: {
                  trigger: "item",
                  formatter: (p: any) => `${p.name} · ${p.value[0]}일 · ${p.value[1]}점`,
                },
                xAxis: { ...axis("적치일"), max: 90 },
                yAxis: { ...axis("점수"), max: 100 },
                series: [
                  {
                    type: "scatter",
                    data: piles.map((p) => ({
                      name: p.stockpile_id,
                      value: [pileRisk(p).age, pileRisk(p).score, p.on_hand_t],
                    })),
                    symbolSize: (v: number[]) => Math.max(8, Math.sqrt(v[2]) / 12),
                  },
                ],
              }}
            />
            <p className="tower-footnote">
              점의 크기 = 재고량. 센서가 없는 Pile은 적치일·탄종만 쓴 모의 점수입니다.
            </p>
          </>
        )}
      </div>
    </Section>
  );
}

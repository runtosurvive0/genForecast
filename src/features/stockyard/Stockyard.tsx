import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { TowerChart } from "@/components/TowerChart";
import { stockpiles } from "@/data/control-tower";
import { pileRisk, weightedCalorific } from "@/domain/control-tower";
import { type Plant } from "@/domain/operations";
import { number as n, date as fmtDate } from "@/lib/format";
import { Section, Metric } from "@/components/tower/primitives";
import { axis } from "@/components/tower/chart-options";
import "./stockyard.css";

export function Stockyard({
  plants,
  theme,
}: {
  plants: Plant[];
  theme: string;
}) {
  const piles = stockpiles.filter((p) =>
    plants.some((x) => x.id === p.plant_id),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active = piles.find((p) => p.stockpile_id === selected) ?? piles[0];
  const total = piles.reduce((s, p) => s + p.on_hand_t, 0);
  const mix = Object.entries(
    piles.reduce<Record<string, number>>(
      (acc, p) => ({
        ...acc,
        [p.coal_type]: (acc[p.coal_type] ?? 0) + p.on_hand_t,
      }),
      {},
    ),
  );
  return (
    <div className="tower-page">
      <div className="tower-kpis tower-kpis-six">
        <Metric label="총 저탄량" value={n(total)} unit="t" />
        <Metric label="운영 Pile" value={piles.length} unit="개" />
        <Metric
          label="가중평균 열량"
          value={n(
            weightedCalorific(
              piles.map((p) => ({
                tons: p.on_hand_t,
                cv: p.calorific_value_kcal_kg,
              })),
            ) ?? 0,
          )}
          unit="kcal/kg"
        />
        <Metric
          label="최장 적치"
          value={Math.max(...piles.map((p) => pileRisk(p).age))}
          unit="일"
        />
        <Metric
          label="고위험 Pile"
          value={piles.filter((p) => pileRisk(p).score >= 70).length}
          unit="개"
          note="모의 위험도"
        />
        <Metric
          label="탄종 구성"
          value={mix.length}
          unit="종"
          note="재고 중량 기준"
        />
      </div>
      <Section
        title="저탄장 배치"
        note="면적은 재고량 비례 · Pile을 선택하면 탄질과 투입 가능 호기를 확인할 수 있습니다"
        action={<span className="tower-tag">SIMULATED RISK</span>}
      >
        <div className="yard-flow">
          {[
            "연료부두",
            "컨베이어",
            "스태커",
            "저탄 Pile",
            "리클레이머",
            "발전호기",
          ].map((x, i) => (
            <span key={x}>
              {x}
              {i < 5 && <ArrowRight size={14} />}
            </span>
          ))}
        </div>
        <div className="yard-map">
          {plants.map((p) => (
            <div key={p.id} className="yard-plant">
              <span>{p.name}</span>
              <div className="yard-piles">
                {piles
                  .filter((x) => x.plant_id === p.id)
                  .map((pile) => {
                    const risk = pileRisk(pile);
                    return (
                      <button
                        key={pile.stockpile_id}
                        onClick={() => setSelected(pile.stockpile_id)}
                        aria-pressed={
                          active?.stockpile_id === pile.stockpile_id
                        }
                        className={`yard-pile risk-${risk.label === "높음" ? "high" : risk.label === "관찰" ? "medium" : "low"}`}
                        style={{ flexGrow: pile.on_hand_t, flexBasis: 0 }}
                      >
                        <strong>{pile.stockpile_id}</strong>
                        <span>{n(pile.on_hand_t)} t</span>
                        <small>
                          {risk.age}일 · {risk.label}
                        </small>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
        <p className="tower-footnote">
          위험도는 적치기간과 탄종으로 계산한 모의 점수입니다. 온도·CO 센서
          데이터는 연결되지 않았습니다.
        </p>
      </Section>
      {active && (
        <Section
          title={`${active.stockpile_id} · ${active.coal_type}`}
          note={`적치일 ${fmtDate(active.stacked_at)} · ${pileRisk(active).age}일 경과`}
        >
          <dl className="tower-details">
            {[
              ["재고", n(active.on_hand_t) + " t"],
              ["발열량", n(active.calorific_value_kcal_kg) + " kcal/kg"],
              ["수분", active.moisture_pct + " %"],
              ["회분", active.ash_pct + " %"],
              ["황분", active.sulfur_pct + " %"],
              ["위험도", pileRisk(active).score + "/100 · SIMULATED"],
              ["온도", "미연결"],
              ["CO", "미연결"],
              [
                "투입 가능 호기",
                plants
                  .flatMap((p) => p.units)
                  .filter((u) => active.eligible_unit_ids.includes(u.id))
                  .map((u) => u.name)
                  .join(", "),
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <div className="tower-two">
        <Section title="탄종별 재고 구성">
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
        </Section>
        <Section
          title="적치기간과 모의 위험도"
          note="점의 크기 = 재고량 · 온도 센서 기반 위험 예측이 아닙니다"
        >
          <TowerChart
            theme={theme}
            label="Pile 적치일수와 위험 점수 산점도"
            option={{
              tooltip: {
                trigger: "item",
                formatter: (p: any) =>
                  `${p.name} · ${p.value[0]}일 · ${p.value[1]}점`,
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
                  symbolSize: (v: number[]) =>
                    Math.max(8, Math.sqrt(v[2]) / 12),
                },
              ],
            }}
          />
        </Section>
      </div>
      <Section title="전체 Pile 원장">
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                {[
                  "Pile / 발전소",
                  "탄종",
                  "재고 · t",
                  "열량 · kcal/kg",
                  "수분 / 회분 / 황분 · %",
                  "적치 · 일",
                  "위험도",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {piles.map((p) => (
                <tr key={p.stockpile_id}>
                  <td>
                    <button onClick={() => setSelected(p.stockpile_id)}>
                      {p.stockpile_id} /{" "}
                      {plants.find((x) => x.id === p.plant_id)?.name}
                    </button>
                  </td>
                  <td>{p.coal_type}</td>
                  <td>{n(p.on_hand_t)}</td>
                  <td>{n(p.calorific_value_kcal_kg)}</td>
                  <td>
                    {p.moisture_pct} / {p.ash_pct} / {p.sulfur_pct}
                  </td>
                  <td>{pileRisk(p).age}</td>
                  <td>
                    {pileRisk(p).label} · {pileRisk(p).score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

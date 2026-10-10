import type { Stockpile } from "@/data/control-tower";
import { pileRisk } from "@/domain/control-tower";
import { date as fmtDate, number as n } from "@/lib/format";
import { PileHistory } from "./PileButton";
import type { HistoryEntry } from "./stockyard-domain";

/** Pile 탄질·센서·투입 호기·하역 이력. 패널과 단독 섹션이 함께 쓴다. */
export function PileDetail({
  pile,
  entries,
  eligibleNames,
  compact = false,
}: {
  pile: Stockpile;
  entries: HistoryEntry[];
  eligibleNames: string;
  compact?: boolean;
}) {
  const risk = pileRisk(pile);
  const sensor = (value: number | null, unit: string) =>
    value === null ? "미연결" : `${n(value, 1)} ${unit} · 측정`;
  return (
    <div className={`pile-detail${compact ? " is-compact" : ""}`}>
      <dl className="tower-details">
        {[
          ["재고", n(pile.on_hand_t) + " t"],
          ["발열량", n(pile.calorific_value_kcal_kg) + " kcal/kg"],
          ["적치", `${fmtDate(pile.stacked_at)} · ${risk.age}일`],
          ["수분", pile.moisture_pct + " %"],
          ["회분", pile.ash_pct + " %"],
          ["황분", pile.sulfur_pct + " %"],
          [
            "위험도",
            `${risk.score}/100 · ${risk.label} · ${risk.source === "SENSOR" ? "센서 반영" : "SIMULATED"}`,
          ],
          ["온도", sensor(pile.temperature_c, "℃")],
          ["CO", sensor(pile.co_ppm, "ppm")],
          [
            "부두 / 발전처",
            `${pile.berth_id ?? "-"} / ${pile.plant_yard ?? "-"}${pile.indoor ? " · 옥내" : ""}`,
          ],
          ["투입 가능 호기", eligibleNames || "없음"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="stockyard-history">
        <strong>하역 이력·예정 (조회 기간, 역순)</strong>
        <PileHistory entries={entries} />
      </div>
    </div>
  );
}

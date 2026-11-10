// 적치 추천안 표시. 선박 목록(펼침)과 부두 화면(한 줄)이 같이 쓴다. 계산은 백엔드 결과 그대로다.
import { placementLabel, type StackingPlacement, type StackingResult } from "@/domain/stacking";
import { number as n } from "@/lib/format";
import "./stacking.css";

function Places({ items, onOpenYard }: { items: StackingPlacement[]; onOpenYard?: (p: StackingPlacement) => void }) {
  return (
    <ul className="gf-stk-places">
      {items.map(p => (
        <li key={`${p.target}-${p.from_m}`}>
          <strong>{p.yard}저탄장 {placementLabel(p)}</strong> <span>{n(p.tonnes, 0)} t</span>
          {onOpenYard && <button type="button" className="gf-stk-link" onClick={() => onOpenYard(p)}>저탄장에서 보기</button>}
        </li>
      ))}
    </ul>
  );
}

export function StackingOptions({ result, onOpenYard, compact = false }: {
  result: StackingResult; onOpenYard?: (p: StackingPlacement) => void; compact?: boolean;
}) {
  if (result.blocked) return <p className="gf-stk-note gf-stk-blocked">적치 추천 불가: {result.blocked}</p>;
  if (!result.options.length) {
    const largest = result.no_fit?.largest;
    return (
      <div className="gf-stk">
        <p className="gf-stk-note gf-stk-blocked">{result.no_fit?.message ?? "들어갈 빈 곳 없음"}</p>
        {largest && <p className="gf-stk-note">가장 큰 빈 곳: {largest.yard}저탄장 {placementLabel(largest)} · {n(largest.tonnes, 0)} t</p>}
        {result.gaps.length > 0 && <p className="gf-stk-note">{result.gaps.join(" · ")}</p>}
      </div>
    );
  }
  if (compact) {
    const top = result.options[0];
    return (
      <p className="gf-stk-line">
        <span className="gf-stk-tag">적치 추천</span>
        {top.placements.map(p => `${p.yard}저탄장 ${placementLabel(p)}`).join(" + ")}
        {top.placements.length === 1 && onOpenYard && (
          <button type="button" className="gf-stk-link" onClick={() => onOpenYard(top.placements[0])}>저탄장에서 보기</button>
        )}
      </p>
    );
  }
  return (
    <div className="gf-stk">
      <ol className="gf-stk-options">
        {result.options.map(o => (
          <li key={o.rank} className="gf-stk-option">
            <span className="gf-stk-rank">{o.rank}안</span>
            <div className="gf-stk-body">
              <Places items={o.placements} onOpenYard={onOpenYard} />
              {o.reasons.length > 0 && <p className="gf-stk-reasons">{o.reasons.join(" · ")}</p>}
              {o.warnings.length > 0 && <p className="gf-stk-warn">주의: {o.warnings.join(" · ")}</p>}
              {o.assumptions.length > 0 && <p className="gf-stk-assume">모의 값 사용: {o.assumptions.join(" · ")}</p>}
            </div>
          </li>
        ))}
      </ol>
      {result.gaps.length > 0 && <p className="gf-stk-note">{result.gaps.join(" · ")}</p>}
      {result.as_of && <p className="gf-stk-note">기준재고 {result.as_of} 기준</p>}
    </div>
  );
}

import { useId } from "react";

/** 약도용 삽화 (SIMULATED). 실측·실사 이미지가 아니다. */

const HATCHES = [0, 1, 2, 3, 4, 5, 6];

/** 벌크선 평면도. 선수는 오른쪽, 접안 시 위쪽 현이 안벽에 붙는다. */
export function ShipGlyph({
  mode,
}: {
  mode: "moored" | "anchored";
}) {
  const moored = mode === "moored";
  return (
    <svg viewBox="0 0 240 46" className="ship-glyph" aria-hidden="true">
      <ellipse cx="122" cy="41" rx="118" ry="4" className="ship-shadow" />
      {moored && (
        <path d="M14 6 6 -8M226 12 236 -8M70 6 64 -8" className="ship-line" />
      )}
      <path
        d="M8 6H190C212 6 228 14 236 23 228 32 212 40 190 40H8C5 40 3 38 3 35V11C3 8 5 6 8 6Z"
        className="ship-hull"
      />
      <path
        d="M12 10H189C207 10 220 16 227 23 220 30 207 36 189 36H12Z"
        className="ship-deck"
      />
      {HATCHES.map((i) => (
        <rect
          key={i}
          x={58 + i * 19}
          y="13"
          width="15"
          height="20"
          rx="1.5"
          className={
            moored && (i === 1 || i === 4) ? "ship-hatch is-open" : "ship-hatch"
          }
        />
      ))}
      <rect x="14" y="11" width="32" height="24" rx="2" className="ship-bridge" />
      <rect x="21" y="17" width="10" height="12" rx="1" className="ship-funnel" />
      <circle cx="213" cy="23" r="2.2" className="ship-mast" />
      {moored &&
        [1, 4].map((i) => (
          <g key={i} className="ship-unloader">
            <rect x={62 + i * 19} y="-14" width="7" height="38" rx="1" />
            <rect x={60 + i * 19} y="20" width="11" height="7" rx="1.5" />
          </g>
        ))}
    </svg>
  );
}

/**
 * 발전소: 저탄 벙커 → 보일러동, 터빈동, 굴뚝. 상탄 컨베이어 수직 낙하부는
 * 바깥(CSS)에서 x=41.5에 맞춰 이어진다.
 */
export function PlantGlyph() {
  return (
    <svg
      viewBox="0 -50 120 242"
      preserveAspectRatio="xMidYMax meet"
      className="plant-glyph"
      aria-hidden="true"
    >
      <rect x="89" y="-50" width="11" height="236" className="plant-stack" />
      <rect x="89" y="-46" width="11" height="5" className="plant-stack-band" />
      <rect x="89" y="-35" width="11" height="5" className="plant-stack-band" />
      <rect x="104" y="-18" width="9" height="204" className="plant-stack" />
      <rect x="104" y="-14" width="9" height="4" className="plant-stack-band" />
      <rect x="104" y="-5" width="9" height="4" className="plant-stack-band" />
      <rect x="72" y="90" width="44" height="52" className="plant-esp" />
      <path d="M78 102h32M78 114h32M78 126h32" className="plant-lines" />
      <path d="M41.5 -50V2" className="plant-gallery" />
      <path d="M41.5 -50V2" className="plant-gallery-flow" />
      <rect x="20" y="0" width="44" height="22" className="plant-bunker" />
      <rect x="14" y="22" width="56" height="164" className="plant-boiler" />
      <path
        d="M20 38h44M20 54h44M20 70h44M20 86h44M20 102h44M20 118h44"
        className="plant-lines"
      />
      <rect x="4" y="140" width="112" height="46" rx="1" className="plant-turbine" />
      <path d="M4 148h112" className="plant-lines" />
      <rect x="0" y="186" width="120" height="6" className="plant-ground" />
    </svg>
  );
}

/** 해수면 물결·등심선 질감. */
export function SeaTexture() {
  const id = `sea-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="harbor-waves" aria-hidden="true">
      <defs>
        <pattern id={id} width="56" height="18" patternUnits="userSpaceOnUse">
          <path d="M2 9q7-4 14 0t14 0" className="harbor-wave" />
          <path d="M30 17q7-4 14 0" className="harbor-wave" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M0 58C22 52 40 66 62 58S92 46 100 52" className="harbor-contour" />
        <path d="M0 86C26 78 46 92 70 84S94 74 100 78" className="harbor-contour" />
      </svg>
    </svg>
  );
}

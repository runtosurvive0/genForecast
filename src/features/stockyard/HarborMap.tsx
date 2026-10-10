import type { Voyage } from "@/data/control-tower";

/** SIMULATED schematic slots (SVG units, not surveyed coordinates). */
const BERTH_SLOTS: Record<string, { x: number; y: number }> = {
  "BD-1": { x: 120, y: 228 },
  "BD-2": { x: 200, y: 228 },
  "BD-3": { x: 280, y: 228 },
};

export function HarborMap({
  waiting,
  unloading,
  assignedBerths,
  selectedId,
  onSelect,
  theme,
}: {
  waiting: Voyage[];
  unloading: Voyage[];
  assignedBerths: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: string;
}) {
  const berthOf = (voyage: Voyage) =>
    assignedBerths[voyage.voyage_id] ?? voyage.berth_id ?? "BD-1";
  const ships = [
    ...unloading.map((voyage, i) => ({
      voyage,
      state: "unloading" as const,
      x: (BERTH_SLOTS[berthOf(voyage)] ?? BERTH_SLOTS["BD-1"]).x + i * 4,
      y: 196,
    })),
    ...[...waiting]
      .filter((v) => !unloading.some((u) => u.voyage_id === v.voyage_id))
      .sort((a, b) => Date.parse(a.ais_eta) - Date.parse(b.ais_eta))
      .map((voyage, i) => ({
        voyage,
        state: "waiting" as const,
        x: 60 + i * 52,
        y: 96 + (i % 2) * 28,
      })),
  ];
  const occupied = new Set([
    ...unloading.map((v) => berthOf(v)),
    ...Object.values(assignedBerths),
  ]);
  return (
    <div className="harbor-mapwrap" data-map-theme={theme}>
      <svg
        className="harbor-chart"
        viewBox="0 0 400 300"
        role="group"
        aria-label="당진항 약도: 부두 3개와 대기·하역 선박"
      >
        <rect x="0" y="0" width="400" height="300" className="harbor-sea" />
        <polyline
          points="16,36 16,210 96,268 200,268"
          className="harbor-breakwater"
        />
        <text x="30" y="24" className="harbor-chart-note">
          당진항 앞바다 (SIMULATED)
        </text>
        {Object.entries(BERTH_SLOTS).map(([id, slot]) => (
          <g key={id}>
            <rect
              x={slot.x - 26}
              y={slot.y - 10}
              width="52"
              height="20"
              className={`harbor-chart-berth${
                occupied.has(id) ? " is-occupied" : ""
              }`}
            />
            <text
              x={slot.x}
              y={slot.y + 26}
              textAnchor="middle"
              className="harbor-chart-label"
            >
              {id}
            </text>
          </g>
        ))}
        {ships.map(({ voyage, state, x, y }) => {
          const active = selectedId === voyage.voyage_id;
          return (
            <g
              key={`chart-${voyage.voyage_id}`}
              onClick={() => onSelect(voyage.voyage_id)}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`${voyage.vessel_name}, ${state === "waiting" ? "대기중" : "하역중"}, 선택`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(voyage.voyage_id);
                }
              }}
              className={`harbor-chart-ship is-${state}${
                active ? " is-selected" : ""
              }`}
            >
              <title>{`${voyage.vessel_name} · ${state === "waiting" ? "대기중" : "하역중"} · SIMULATED`}</title>
              <circle cx={x} cy={y} r="11" className="harbor-chart-halo" />
              <circle cx={x} cy={y} r="7" className="harbor-chart-body" />
              <path
                d={`M${x - 3.5} ${y} L${x} ${y - 4.2} L${x + 3.5} ${y} L${x + 2.1} ${y + 3.5} L${x - 2.1} ${y + 3.5} Z`}
                className="harbor-chart-vessel"
              />
              <text x={x} y={y - 14} textAnchor="middle" className="harbor-chart-label">
                {voyage.vessel_name}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="harbor-map-note">
        SIMULATED 약도 — 고정 화면, 선택은 옆 테이블과 동기화
      </p>
    </div>
  );
}

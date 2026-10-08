import { useEffect, useId, useRef, useState } from "react";
import { BASE_TIME, type Forecast, type Plant } from "../domain/operations";
import "./operations-charts.css";

const DAY_MS = 86_400_000;
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const nonnegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;
const dateLabel = (value: string | number) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        timeZone: "Asia/Seoul",
      }).format(date)
    : String(value).slice(5, 10).replace("-", "/");
};
const dailyStart = (date: string) =>
  new Date(`${date.slice(0, 10)}T09:00:00+09:00`).getTime();
const dailyEnd = (date: string) => dailyStart(date) + DAY_MS;
const dailyEndLabel = (date: string) =>
  `${dateLabel(dailyEnd(date))} 09:00 KST`;
const dailyPeriodLabel = (date: string) =>
  `${dateLabel(dailyStart(date))} 09:00 ~ ${dateLabel(dailyEnd(date))} 09:00 KST`;

export function InventoryChart({
  forecast,
  comparison,
  safetyStockTons,
}: {
  forecast: Forecast;
  comparison?: Forecast;
  safetyStockTons: number;
}) {
  const id = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(700);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const daily = forecast.daily;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => {
      const style = getComputedStyle(element);
      setChartWidth(
        Math.max(
          240,
          element.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
        ),
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [daily.length]);
  if (!daily.length)
    return (
      <div className="operations-chart-empty" role="status">
        선택한 기간의 재고 전망이 없습니다.
      </div>
    );

  const width = chartWidth;
  const height = 230;
  const left = 48;
  const right = width - 14;
  const top = 21;
  const bottom = height - 34;
  const safety = nonnegative(safetyStockTons);
  const baseline = new Map(
    comparison?.daily.map((day) => [
      day.date.slice(0, 10),
      nonnegative(day.stockTons),
    ]) ?? [],
  );
  const greatest = Math.max(
    safety,
    ...daily.map((day) => nonnegative(day.stockTons)),
    ...baseline.values(),
    10000,
  );
  const magnitude = 10 ** Math.floor(Math.log10(greatest));
  const max = Math.ceil((greatest * 1.1) / (magnitude / 2)) * (magnitude / 2);
  const x = (index: number) =>
    daily.length === 1
      ? (left + right) / 2
      : left + (index / (daily.length - 1)) * (right - left);
  const y = (stock: number) =>
    bottom - (nonnegative(stock) / max) * (bottom - top);
  const points = daily.map((day, index) => `${x(index)},${y(day.stockTons)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${x(daily.length - 1)},${bottom} L ${x(0)},${bottom} Z`;
  let baselinePath = "";
  let continuing = false;
  daily.forEach((day, index) => {
    const stock = baseline.get(day.date.slice(0, 10));
    if (stock === undefined) {
      continuing = false;
      return;
    }
    baselinePath += ` ${continuing ? "L" : "M"} ${x(index)},${y(stock)}`;
    continuing = true;
  });
  const selectedIndex =
    activeIndex === null ? 0 : Math.min(activeIndex, daily.length - 1);
  const selected = daily[selectedIndex];
  const ticks = Array.from(
    new Set([
      0,
      Math.round((daily.length - 1) / 3),
      Math.round(((daily.length - 1) * 2) / 3),
      daily.length - 1,
    ]),
  );
  const summary = `${dailyEndLabel(daily[0].date)}부터 ${dailyEndLabel(daily[daily.length - 1].date)}까지 기말 재고 전망. 첫 집계 종료 시점 ${number.format(daily[0].stockTons)}톤, 마지막 집계 종료 시점 ${number.format(daily[daily.length - 1].stockTons)}톤. 안전재고 ${number.format(safety)}톤. 발전량과 하역 완료 물량은 각 표시 시각 이전 24시간 집계입니다.`;

  return (
    <div className="inventory-chart" ref={container}>
      <div className="operations-chart-legend" aria-label="재고 그래프 범례">
        <span>
          <i className="chart-key chart-key-teal" />
          예상 재고
        </span>
        {comparison && (
          <span>
            <i className="chart-key chart-key-comparison" />
            기준 시나리오
          </span>
        )}
        <span>
          <i className="chart-key chart-key-amber" />
          안전재고 {number.format(safety / 10000)}만 t
        </span>
        <span>
          <i className="chart-key chart-key-inbound" />
          하역 완료
        </span>
      </div>
      <svg
        className="inventory-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>연료 재고 전망</title>
        <desc id={`${id}-description`}>{summary}</desc>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-teal)" stopOpacity=".2" />
            <stop
              offset="100%"
              stopColor="var(--chart-teal)"
              stopOpacity=".015"
            />
          </linearGradient>
        </defs>
        <text
          className="chart-axis-label"
          x={left - 10}
          y={12}
          textAnchor="end"
        >
          만 t
        </text>
        {[0, 1, 2, 3, 4].map((tick) => {
          const stock = (max * tick) / 4;
          return (
            <g key={tick}>
              <line
                className="chart-grid-line"
                x1={left}
                x2={right}
                y1={y(stock)}
                y2={y(stock)}
              />
              <text
                className="chart-axis-label"
                x={left - 10}
                y={y(stock) + 4}
                textAnchor="end"
              >
                {number.format(stock / 10000)}
              </text>
            </g>
          );
        })}
        <path d={area} fill={`url(#${id}-fill)`} />
        {baselinePath && (
          <path className="chart-comparison-line" d={baselinePath} />
        )}
        <line
          className="chart-safety-line"
          x1={left}
          x2={right}
          y1={y(safety)}
          y2={y(safety)}
        />
        <path className="chart-stock-line" d={line} />
        {daily.length === 1 && (
          <circle
            className="chart-active-dot"
            cx={x(0)}
            cy={y(daily[0].stockTons)}
            r={4}
          />
        )}
        {daily.map(
          (day, index) =>
            day.inboundTons > 0 && (
              <g key={`inbound-${day.date}`}>
                <circle
                  className="chart-inbound-dot"
                  cx={x(index)}
                  cy={y(day.stockTons)}
                  r={4}
                >
                  <title>
                    {dailyPeriodLabel(day.date)} 구간 하역 완료{" "}
                    {number.format(day.inboundTons)}톤
                  </title>
                </circle>
              </g>
            ),
        )}
        {activeIndex !== null && (
          <g>
            <line
              className="chart-active-line"
              x1={x(selectedIndex)}
              x2={x(selectedIndex)}
              y1={top}
              y2={bottom}
            />
            <circle
              className="chart-active-dot"
              cx={x(selectedIndex)}
              cy={y(selected.stockTons)}
              r={5}
            />
          </g>
        )}
        {ticks.map((index) => (
          <text
            key={index}
            className="chart-axis-label"
            x={x(index)}
            y={height - 10}
            textAnchor={
              index === 0
                ? "start"
                : index === daily.length - 1
                  ? "end"
                  : "middle"
            }
          >
            {dateLabel(dailyEnd(daily[index].date))}
          </text>
        ))}
        {daily.map((day, index) => {
          const hitLeft =
            daily.length === 1
              ? left
              : Math.max(
                  left,
                  x(index) - (right - left) / (daily.length - 1) / 2,
                );
          const hitRight =
            daily.length === 1
              ? right
              : Math.min(
                  right,
                  x(index) + (right - left) / (daily.length - 1) / 2,
                );
          return (
            <rect
              key={`hover-${day.date}`}
              className="chart-hover-target"
              x={hitLeft}
              y={top}
              width={hitRight - hitLeft}
              height={bottom - top}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <title>
                {dailyEndLabel(day.date)} 재고 {number.format(day.stockTons)}톤.{" "}
                {dailyPeriodLabel(day.date)} 구간 하역 완료{" "}
                {number.format(day.inboundTons)}톤.
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="chart-day-detail" aria-live="polite" aria-atomic="true">
        <strong>{dailyEndLabel(selected.date)}</strong>
        <span>
          재고 <b>{number.format(selected.stockTons)} t</b>
        </span>
        <span>
          발전 <b>{number.format(selected.productionGwh)} GWh</b>
        </span>
        <span>
          하역 완료 <b>{number.format(selected.inboundTons)} t</b>
        </span>
        <span className="chart-period-note">
          전 24시간 집계: {dailyPeriodLabel(selected.date)}
        </span>
      </div>
      <label className="chart-scrubber-label" htmlFor={`${id}-scrubber`}>
        날짜별 수치 확인<span>← → 키로 이동</span>
      </label>
      <input
        id={`${id}-scrubber`}
        className="chart-scrubber"
        type="range"
        min={0}
        max={Math.max(0, daily.length - 1)}
        value={selectedIndex}
        disabled={daily.length === 1}
        onChange={(event) => setActiveIndex(Number(event.target.value))}
        onFocus={() => setActiveIndex(selectedIndex)}
        aria-valuetext={`${dailyEndLabel(selected.date)}, 재고 ${number.format(selected.stockTons)}톤. ${dailyPeriodLabel(selected.date)} 전 24시간 집계, 발전 ${number.format(selected.productionGwh)}기가와트시, 하역 완료 ${number.format(selected.inboundTons)}톤`}
      />
    </div>
  );
}

export function OutageTimeline({
  plants,
  days = 14,
  onSelect,
}: {
  plants: Plant[];
  days?: number;
  onSelect?: (plantId: string, unitId: string) => void;
}) {
  const durationDays = Number.isFinite(days)
    ? Math.max(1, Math.min(366, days))
    : 14;
  const start = new Date(BASE_TIME).getTime();
  const duration = durationDays * DAY_MS;
  const end = start + duration;
  const rows: { plant: Plant; unit: Plant["units"][number] }[] = [];
  const maxUnits = Math.max(0, ...plants.map((plant) => plant.units.length));
  for (
    let unitIndex = 0;
    unitIndex < maxUnits && rows.length < 8;
    unitIndex++
  ) {
    for (const plant of plants) {
      if (plant.units[unitIndex] && rows.length < 8)
        rows.push({ plant, unit: plant.units[unitIndex] });
    }
  }
  if (!rows.length)
    return (
      <div className="operations-chart-empty" role="status">
        표시할 발전기가 없습니다.
      </div>
    );
  const percent = (time: number) =>
    Math.max(0, Math.min(100, ((time - start) / duration) * 100));
  const tickDays = [0, durationDays / 2, durationDays];

  return (
    <div className="outage-timeline">
      <div className="timeline-axis" aria-hidden="true">
        <span>발전기 / 설비용량</span>
        <div>
          {tickDays.map((day, index) => (
            <span
              key={index}
              style={{ left: `${(day / durationDays) * 100}%` }}
            >
              {dateLabel(start + day * DAY_MS)}
            </span>
          ))}
        </div>
      </div>
      <div className="timeline-rows">
        {rows.map(({ plant, unit }) => {
          const outages = unit.outages
            .map((outage) => ({
              ...outage,
              from: new Date(outage.startAt).getTime(),
              to: new Date(outage.endAt).getTime(),
            }))
            .filter(
              (outage) =>
                Number.isFinite(outage.from) &&
                Number.isFinite(outage.to) &&
                outage.to > outage.from &&
                outage.from < end &&
                outage.to > start,
            )
            .sort((a, b) => a.from - b.from);
          const running = unit.loadPct > 0;
          const description = outages.length
            ? outages
                .map(
                  (outage) =>
                    `${outage.title}, ${dateLabel(outage.startAt)}부터 ${dateLabel(outage.endAt)}까지`,
                )
                .join("; ")
            : "선택 기간 내 계획정지 없음";
          return (
            <button
              type="button"
              className="timeline-row"
              key={`${plant.id}-${unit.id}`}
              onClick={() => onSelect?.(plant.id, unit.id)}
              aria-label={`${plant.name} ${unit.name}, ${number.format(unit.capacityMw)}메가와트, ${description}. 상세 보기`}
              title={description}
            >
              <span className="timeline-unit">
                <strong>
                  {unit.name.startsWith(plant.name)
                    ? unit.name
                    : `${plant.name} ${unit.name}`}
                </strong>
                <small>{number.format(unit.capacityMw)} MW</small>
              </span>
              <span
                className={`timeline-track${running ? " is-running" : ""}`}
                aria-hidden="true"
              >
                <span className="timeline-tick timeline-tick-middle" />
                {outages.map((outage) => (
                  <span
                    key={outage.id}
                    className="timeline-outage"
                    style={{
                      left: `${percent(outage.from)}%`,
                      width: `${percent(outage.to) - percent(outage.from)}%`,
                    }}
                    title={`${outage.title} · ${outage.reason}`}
                  >
                    <span>{outage.title}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="operations-chart-legend timeline-legend">
        <span>
          <i className="chart-key chart-key-block-teal" />
          운전
        </span>
        <span>
          <i className="chart-key chart-key-block-amber" />
          계획정지
        </span>
        <span>
          <i className="chart-key chart-key-block-idle" />
          미가동
        </span>
      </div>
      <p className="timeline-note">
        현재 부하와 입력된 계획정지 기준 · 연료부족 전망은 별도 표시
      </p>
    </div>
  );
}

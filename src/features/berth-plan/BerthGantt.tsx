// 접안 추천 간트(SVG). 부두별 줄에 선택한 안의 하역 막대를 그리고 현재 계획을 흐린 테두리로 겹친다.
// 응답에 있는 값만 그린다: 부두 줄은 응답의 전체 부두 목록(빈 줄 포함), 정비는 응답의 정비 구간,
// 시간 축은 기준시각·기간·배정 시각에서 정한다.
import { useEffect, useId, useRef, useState } from "react";
import type { BerthAssignment, BerthOption, BerthPlanResult } from "@/domain/berth-plan";

const HOUR = 3_600_000;
const LABEL_W = 64;
const HEAD_H = 26;
const ROW_H = 40;
const BAR_H = 22;

const KST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** ISO 시각을 KST "MM-DD HH:mm"으로. 값이 없으면 null. */
export function kstLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const parts = Object.fromEntries(KST_PARTS.formatToParts(new Date(time)).map(p => [p.type, p.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 저탄장 번호별 막대 색 클래스. 모르는 저탄장은 중립색. */
export function yardClass(yard: string | null): string {
  return yard === "1" || yard === "2" || yard === "3" ? `gf-bp-yard-${yard}` : "gf-bp-yard-x";
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const placed = (a: BerthAssignment) => a.berth_id !== null && Number.isFinite(ms(a.berth_at));

export function BerthGantt({ result, option, theme }: { result: BerthPlanResult; option: BerthOption; theme: "light" | "dark" }) {
  const uid = useId().replace(/:/g, "");
  // 가로 폭에 맞춰 시간 축을 늘린다. 좁은 화면은 시간당 최소 2px로 두고 가로 스크롤한다.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1280);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setAvail(Math.max(320, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const rows = option.assignments.filter(placed);
  const ghosts = option.id === "current" ? [] : (result.current?.assignments ?? []).filter(placed);
  // 전체 부두 목록을 줄로 쓰고, 목록에 없는 부두에 배정된 행이 있으면 뒤에 덧붙인다(숨기지 않음).
  const listed = result.berths.map(b => b.id);
  const extra = [...new Set([...rows, ...ghosts].map(a => a.berth_id as string))].filter(id => !listed.includes(id)).sort();
  const berths = [...listed, ...extra];
  const outages = result.outages.filter(o => berths.includes(o.berth) && Number.isFinite(ms(o.start)) && Number.isFinite(ms(o.end)) && ms(o.end) > ms(o.start));
  const unplaced = option.assignments.length - rows.length;

  const asOf = ms(result.as_of);
  const times = [...rows, ...ghosts].flatMap(a => [ms(a.berth_at), ms(a.unload_end), ms(a.eta)]).filter(Number.isFinite);
  // 정비 구간은 축을 늘리지 않고 축 안으로 잘라 그린다.
  const start = Math.floor(Math.min(asOf, ...times) / HOUR) * HOUR;
  const end = Math.ceil(Math.max(asOf + result.horizon_days * 24 * HOUR, ...times) / HOUR) * HOUR;
  const hours = Math.max(1, (end - start) / HOUR);
  const pxPerHour = Math.min(10, Math.max(2, (avail - LABEL_W - 8) / hours));
  const width = LABEL_W + hours * pxPerHour + 8;
  const height = HEAD_H + Math.max(1, berths.length) * ROW_H + 4;
  const x = (t: number) => LABEL_W + ((t - start) / HOUR) * pxPerHour;
  const rowY = (berth: string | null) => HEAD_H + berths.indexOf(berth as string) * ROW_H + (ROW_H - BAR_H) / 2;

  // 하루 경계(KST 자정) 눈금. KST는 UTC+9 고정이다.
  const ticks: number[] = [];
  const firstMidnight = Math.ceil((start + 9 * HOUR) / (24 * HOUR)) * 24 * HOUR - 9 * HOUR;
  for (let t = firstMidnight; t <= end; t += 24 * HOUR) ticks.push(t);
  const tickEvery = pxPerHour * 24 < 44 ? 2 : 1;

  const label = `접안 간트 · ${option.label}`;
  return (
    <div className="gf-bp-gantt-wrap" data-theme={theme}>
      <div className="gf-bp-gantt-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label={`${label} (가로 스크롤)`}>
        {berths.length === 0 ? (
          <p className="gf-bp-muted gf-bp-gantt-empty">부두 정보가 없습니다.</p>
        ) : (
          <svg className="gf-bp-gantt" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
            <defs>
              <pattern id={`${uid}-outage`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <rect width="6" height="6" className="gf-bp-outage-bg" />
                <line x1="0" y1="0" x2="0" y2="6" className="gf-bp-outage-line" strokeWidth="1.5" />
              </pattern>
              <pattern id={`${uid}-wait`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="gf-bp-wait-bg" />
                <line x1="0" y1="0" x2="0" y2="6" className="gf-bp-wait-line" strokeWidth="3" />
              </pattern>
            </defs>
            {berths.map((berth, i) => (
              <g key={berth}>
                <rect x={0} y={HEAD_H + i * ROW_H} width={width} height={ROW_H} className={i % 2 ? "gf-bp-row-alt" : "gf-bp-row"} />
                <text x={8} y={HEAD_H + i * ROW_H + ROW_H / 2 + 4} className="gf-bp-axis-label" data-berth={berth}>{berth}</text>
              </g>
            ))}
            {ticks.map((t, i) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={HEAD_H - 4} y2={height} className="gf-bp-tick" />
                {i % tickEvery === 0 && <text x={x(t) + 3} y={HEAD_H - 9} className="gf-bp-axis-label">{kstLabel(new Date(t).toISOString())?.slice(0, 5)}</text>}
              </g>
            ))}
            {outages.map(o => {
              const from = Math.max(start, ms(o.start));
              const to = Math.min(end, ms(o.end));
              if (to <= from) return null;
              const y = HEAD_H + berths.indexOf(o.berth) * ROW_H + 3;
              return (
                <g key={`outage-${o.berth}-${o.start}`}>
                  <title>{`${o.berth} 정비 · ${kstLabel(o.start)} ~ ${kstLabel(o.end)}`}</title>
                  <rect className="gf-bp-outage" data-on={o.berth} x={x(from)} y={y} width={Math.max(2, x(to) - x(from))} height={ROW_H - 6} fill={`url(#${uid}-outage)`} />
                  <rect className="gf-bp-outage-edge" x={x(from)} y={y} width={Math.max(2, x(to) - x(from))} height={ROW_H - 6} />
                </g>
              );
            })}
            <line x1={x(asOf)} x2={x(asOf)} y1={HEAD_H - 4} y2={height} className="gf-bp-now" />
            {ghosts.map(a => {
              const from = ms(a.berth_at);
              const to = Number.isFinite(ms(a.unload_end)) ? ms(a.unload_end) : end;
              return <rect key={`ghost-${a.voyage_no}`} className="gf-bp-ghost" x={x(from)} y={rowY(a.berth_id) - 3} width={Math.max(2, x(to) - x(from))} height={BAR_H + 6} rx={4} />;
            })}
            {rows.map(a => {
              const from = ms(a.berth_at);
              const to = Number.isFinite(ms(a.unload_end)) ? ms(a.unload_end) : end;
              const eta = ms(a.eta);
              const y = rowY(a.berth_id);
              const waiting = !a.fixed && Number.isFinite(eta) && eta < from;
              const name = a.voyage_number ?? a.voyage_no;
              const title = a.fixed
                ? `${name} · 고정 점유 · ${a.berth_id} · ${kstLabel(a.berth_at)} ~ ${kstLabel(a.unload_end) ?? "미확인"}`
                : `${name} · ${a.berth_id} · 접안 ${kstLabel(a.berth_at)} · 하역완료 ${kstLabel(a.unload_end) ?? "미확인"}${waiting ? ` · ETA ${kstLabel(a.eta)}` : ""}`;
              return (
                <g key={a.voyage_no}>
                  <title>{title}</title>
                  {waiting && <rect className="gf-bp-wait" x={x(eta)} y={y + 4} width={x(from) - x(eta)} height={BAR_H - 8} fill={`url(#${uid}-wait)`} />}
                  <rect data-on={a.berth_id ?? undefined} className={`gf-bp-bar ${a.fixed ? "gf-bp-bar-fixed" : yardClass(a.yard)}`} x={x(from)} y={y} width={Math.max(2, x(to) - x(from))} height={BAR_H} rx={4} />
                  {x(to) - x(from) > 46 && <text x={x(from) + 5} y={y + BAR_H / 2 + 4} className={`gf-bp-bar-label${a.fixed ? " gf-bp-bar-label-fixed" : ""}`}>{name}</text>}
                  {!a.fixed && Number.isFinite(eta) && <circle className="gf-bp-eta" cx={x(eta)} cy={y + BAR_H / 2} r={3.5} />}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <ul className="gf-bp-legend" aria-label="간트 범례">
        <li><i className="gf-bp-key gf-bp-yard-1" />1저탄장</li>
        <li><i className="gf-bp-key gf-bp-yard-2" />2저탄장</li>
        <li><i className="gf-bp-key gf-bp-yard-3" />3저탄장</li>
        <li><i className="gf-bp-key gf-bp-bar-fixed" />고정 점유</li>
        {ghosts.length > 0 && <li><i className="gf-bp-key gf-bp-key-ghost" />현재 계획</li>}
        <li><i className="gf-bp-key gf-bp-key-outage" />정비</li>
        <li><i className="gf-bp-key gf-bp-key-wait" />체선(ETA 후 대기)</li>
        <li><i className="gf-bp-key gf-bp-key-eta" />ETA</li>
        {unplaced > 0 && <li className="gf-bp-muted">부두 미배정 {unplaced}척은 표에서 확인</li>}
      </ul>
    </div>
  );
}

import { ArrowDown, RefreshCw, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { date as dateLabel } from "@/lib/format";
import { forecastLabels, type ForecastState } from "./vessel-weather";
import { metricText } from "./vessel-weather-layers";

const show = (n: number | null | undefined, unit: string) =>
  n == null ? "자료 없음" : `${n.toFixed(1)} ${unit}`;
const when = (at: string | null | undefined) =>
  at ? dateLabel(at, true) : "미제공";
export function WeatherCredits() {
  return (
    <span className="vessel-forecast-credits">
      예보:{" "}
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        Open-Meteo
      </a>{" "}
      ·{" "}
      <a href="https://www.dwd.de/" target="_blank" rel="noreferrer">
        DWD
      </a>{" "}
      및{" "}
      <a
        href="https://open-meteo.com/en/docs/marine-weather-api#data-sources"
        target="_blank"
        rel="noreferrer"
      >
        원자료 제공기관
      </a>{" "}
      ·{" "}
      <a
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noreferrer"
      >
        CC BY 4.0
      </a>{" "}
      · 격자 선택·통과 시각 매칭
    </span>
  );
}
export function VesselForecastPanel({
  state,
  busy,
  theme,
  enabled,
  setEnabled,
  index,
  setIndex,
  refresh,
}: {
  state: ForecastState;
  busy: boolean;
  theme: "light" | "dark";
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  index: number;
  setIndex: (v: number) => void;
  refresh: () => void;
}) {
  const points = state.data?.points ?? [];
  const selected = Math.min(index, Math.max(0, points.length - 1));
  const p = points[selected];
  return (
    <section className="vessel-forecast-panel" aria-label="실제 항로 기상 예보">
      <header>
        <div>
          <h3>
            <Waves size={15} /> 항로 통과 예보
          </h3>
          <span>{forecastLabels[state.status]} · 향후 최대 72시간 · KST</span>
        </div>
        <div className="vessel-workflow-actions">
          <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
            <RefreshCw size={13} /> 기상 갱신
          </Button>
          <Button
            size="sm"
            variant={enabled ? "secondary" : "outline"}
            aria-pressed={enabled}
            disabled={!points.length}
            onClick={() => setEnabled(!enabled)}
          >
            항로 예보 지도 표시
          </Button>
        </div>
      </header>
      {busy && (
        <ProcessingOrb
          theme={theme}
          state="connecting"
          label="관심 선박 예보 조회 중"
        />
      )}
      <p
        className="vessel-forecast-note"
        role={state.status === "error" ? "status" : undefined}
      >
        {state.reason}
      </p>
      {!!points.length && (
        <>
          <div
            className="vessel-forecast-timeline"
            role="group"
            aria-label="통과 시각별 파고와 바람"
          >
            {points.map((point, i) => (
              <button
                key={point.passageAt}
                type="button"
                className={i === selected ? "selected" : ""}
                aria-pressed={i === selected}
                aria-label={`${when(point.passageAt)} 통과 예보`}
                onClick={() => setIndex(i)}
              >
                <span>{when(point.passageAt)}</span>
                <span className="vessel-forecast-bars" aria-hidden="true">
                  <i
                    style={{
                      height:
                        point.waveM == null
                          ? 0
                          : `${Math.min(100, (point.waveM / 8) * 100)}%`,
                    }}
                  />
                  <i
                    style={{
                      height:
                        point.windKn == null
                          ? 0
                          : `${Math.min(100, (point.windKn / 50) * 100)}%`,
                    }}
                  />
                </span>
                <small>{show(point.waveM, "m")}</small>
                <small>{show(point.windKn, "kn")}</small>
              </button>
            ))}
          </div>
          <p className="vessel-forecast-note">
            막대: 파고 0–8m · 바람 0–50kn (상한 초과는 숫자 확인) · 자료 없음은
            빈 막대
          </p>
          <input
            aria-label="항로 예보 지점"
            type="range"
            min="0"
            max={Math.max(0, points.length - 1)}
            value={selected}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
          {p && (
            <>
              <div className="vessel-forecast-selected">
                통과 예정 {when(p.passageAt)} KST · 항로 표본{" "}
                {p.latitude.toFixed(2)}, {p.longitude.toFixed(2)}
              </div>
              <dl className="vessel-forecast-values">
                <div>
                  <dt>파고</dt>
                  <dd>{show(p.waveM, "m")}</dd>
                </div>
                <div>
                  <dt>바람</dt>
                  <dd>
                    {p.windFromDeg != null && (
                      <ArrowDown
                        size={17}
                        style={{ transform: `rotate(${p.windFromDeg}deg)` }}
                        aria-hidden="true"
                      />
                    )}
                    {show(p.windKn, "kn")}
                  </dd>
                </div>
                <div>
                  <dt>돌풍</dt>
                  <dd>{show(p.gustKn, "kn")}</dd>
                </div>
                <div>
                  <dt>시정</dt>
                  <dd>{metricText(p, "visibility")}</dd>
                </div>
                <div>
                  <dt>파주기</dt>
                  <dd>{show(p.wavePeriodS, "s")}</dd>
                </div>
              </dl>
              <p className="vessel-forecast-note">
                풍향 {show(p.windFromDeg, "°")} · 파향{" "}
                {show(p.waveFromDeg, "°")} (불어오는 방향). 화살표는 바람이
                향하는 방향입니다.
              </p>
              <p className="vessel-forecast-note">
                대기 예보 {when(p.airForecastAt)} · 해양 예보{" "}
                {when(p.marineForecastAt)} KST
                {p.airStatus === "stale" || p.marineStatus === "stale"
                  ? " · 이전 캐시 사용"
                  : ""}
              </p>
              <details>
                <summary>예보 기준과 조회 시각</summary>
                <p>
                  AIS 기준 {when(state.data?.observedAt)} · 대기 조회{" "}
                  {when(p.airFetchedAt)} · 해양 조회 {when(p.marineFetchedAt)}{" "}
                  KST. 공급자 발표시각은 미제공입니다. 가까운 시간별 예보를
                  연결하며 예보 범위 밖은 보간하지 않습니다.
                </p>
              </details>
            </>
          )}
        </>
      )}
      <footer>
        <WeatherCredits />
        <p>
          예상 항로·현재 속도 유지 기준의 격자 예보입니다. 실제 운항 계획·태풍
          경보가 아니며, 기상 보정 ETA는 도착 전망의 시연 모델에서 별도로
          비교합니다. 72시간 이후는 이번 조회 범위 밖입니다.
        </p>
      </footer>
    </section>
  );
}

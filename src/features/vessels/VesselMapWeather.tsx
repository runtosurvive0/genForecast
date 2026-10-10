import { Button } from "@/components/ui/button";
import { date } from "@/lib/format";
import type { ForecastState } from "./vessel-weather";
import {
  cycloneAt,
  metricText,
  type Cyclone,
  type CycloneSnapshot,
  type WeatherMetric,
} from "./vessel-weather-layers";

export function VesselMapWeather({
  state,
  metric,
  setMetric,
  index,
  setIndex,
  storms,
  cycloneData,
  cycloneError,
  cycloneBusy,
  cycloneOn,
  setCycloneOn,
  refresh,
}: {
  state: ForecastState;
  metric: WeatherMetric;
  setMetric: (v: WeatherMetric) => void;
  index: number;
  setIndex: (v: number) => void;
  storms: Cyclone[];
  cycloneData?: CycloneSnapshot;
  cycloneError: string;
  cycloneBusy: boolean;
  cycloneOn: boolean;
  setCycloneOn: (v: boolean) => void;
  refresh: () => void;
}) {
  const points = state.data?.points ?? [];
  const selected = Math.min(index, Math.max(0, points.length - 1));
  const p = points[selected];
  return (
    <section
      className="vessel-map-weather-panel"
      aria-label="지도 기상 레이어 설정"
    >
      <div className="vessel-map-weather-row">
        <div
          className="vessel-map-weather-switch"
          role="group"
          aria-label="기상 표시 항목"
        >
          {(
            [
              ["wave", "파고"],
              ["wind", "바람"],
              ["visibility", "시정"],
            ] as const
          ).map(([key, title]) => (
            <button
              type="button"
              key={key}
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {title}
            </button>
          ))}
        </div>
        <Button
          size="xs"
          variant={cycloneOn ? "secondary" : "ghost"}
          aria-pressed={cycloneOn}
          onClick={() => setCycloneOn(!cycloneOn)}
        >
          태풍
        </Button>
        <span className="vessel-map-weather-value">
          {p ? metricText(p, metric) : "예보 대기"}
        </span>
        <Button
          size="xs"
          variant="ghost"
          onClick={refresh}
          disabled={cycloneBusy}
        >
          갱신
        </Button>
      </div>
      {p ? (
        <div className="vessel-map-weather-time">
          <label htmlFor="vessel-map-passage">
            통과 예상 {date(p.passageAt, true)} KST
          </label>
          <input
            id="vessel-map-passage"
            aria-label="지도 통과 시각"
            type="range"
            min={0}
            max={points.length - 1}
            value={selected}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
          <span>◎ 예상 위치 · 현재 속도 유지</span>
        </div>
      ) : (
        <p>{state.reason}</p>
      )}
      <p>
        표본 강조:{" "}
        {metric === "wave"
          ? "파고 3m 이상"
          : metric === "wind"
            ? "바람 25kn 이상"
            : "시정 1km 미만"}{" "}
        · 시연용 표시 기준, 운항 제한 기준 아님 · 회색은 미확인
      </p>
      {cycloneOn && (
        <div className="vessel-map-cyclone-context" aria-live="polite">
          {cycloneBusy && <p>태풍 정보 조회 중</p>}
          {cycloneError && <p role="status">{cycloneError}</p>}
          {cycloneData && (
            <>
              <p>
                {cycloneData.reason} · 조회{" "}
                {cycloneData.fetchedAt
                  ? date(cycloneData.fetchedAt, true) + " KST"
                  : "미확인"}
              </p>
              {!storms.length && (
                <p>
                  {points.length
                    ? "조회 자료 중 통과 표본 주변 태풍 후보 없음 · 안전 판정 아님"
                    : "통과 예보가 준비되면 주변 태풍을 연결합니다."}
                </p>
              )}
            </>
          )}
          {storms.map((storm) => {
            const center = p
              ? cycloneAt(storm, Date.parse(p.passageAt))
              : undefined;
            return (
              <p key={storm.id}>
                <a href={storm.reportUrl} target="_blank" rel="noreferrer">
                  {storm.name}
                </a>{" "}
                · {storm.source} · 기준 {date(storm.advisoryAt, true)} KST
                <br />
                {center
                  ? `${center.forecast ? "예보" : "관측"} 중심 ${date(center.at, true)} KST · ${center.radii34Nm.some((n) => n != null && n > 0) ? "제공된 34kt 반경 표시" : "강풍 반경 자료 없음"}${center.radii34Nm.some((n) => n == null) ? " · 일부 방향 반경 미제공" : ""}`
                  : "선택 시각 ±3시간 내 태풍 위치 예보 없음"}
              </p>
            );
          })}
          <details>
            <summary>기상 레이어 출처와 해석</summary>
            <p>
              풍속·파고·시정: Open-Meteo 격자 예보. 지도 표본마다 해당 지점의
              통과 예상 시각을 사용하며 해역 전체의 면적 예보가 아닙니다.
            </p>
            <p>
              태풍:{" "}
              <a href="https://www.gdacs.org/" target="_blank" rel="noreferrer">
                GDACS
              </a>{" "}
              및 표시된 원기관. 점선은 중심 예상 경로, 음영은 방향별 34kt(약
              17.5m/s) 최대 풍속 반경으로 그린 부채꼴입니다. 모든 지점에 같은
              바람이 불거나 경로 불확실성을 나타내는 영역은 아닙니다.
            </p>
            <p>
              최근 24시간 이내 태풍 기준 자료에서 선박 통과 표본과 시각이 ±3시간
              이내이고 중심이 300nm 또는 최대 반경+100nm 이내인 후보를
              표시합니다. 이 검색 범위는 위험 반경이 아닙니다. 표본 사이의
              영향은 놓칠 수 있습니다. 제공 시각 사이의 반경을 보간하지
              않습니다.
            </p>
            <p>
              시정·태풍으로 지연 시간을 추가하지 않으며 입항 통제·도선 대기는
              별도 확인이 필요합니다.{" "}
              <a
                href="https://gdacs.org/About/termofuse.aspx"
                target="_blank"
                rel="noreferrer"
              >
                GDACS 이용 안내
              </a>
            </p>
          </details>
        </div>
      )}
    </section>
  );
}

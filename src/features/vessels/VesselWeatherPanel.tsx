import { Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sampleWeatherBase, sampleWeatherEndH } from "@/data/vessel-workflow";
import type { WeatherPoint } from "@/domain/vessel-workflow";
import { number as n, date as fmtDate } from "@/lib/format";

export function VesselWeatherPanel({
  enabled,
  setEnabled,
  hour,
  setHour,
  failed,
  setFailed,
  points,
}: {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  hour: number;
  setHour: (value: number) => void;
  failed: boolean;
  setFailed: (value: boolean) => void;
  points: WeatherPoint[];
}) {
  return (
    <div className="vessel-weather-panel">
      <div className="vessel-workflow-toolbar">
        <div>
          <strong>
            <Waves size={14} />
            항로 주변 기상
          </strong>
          <span>합성 예시 · 선택 시각의 파고·바람</span>
        </div>
        <Button
          variant={enabled ? "secondary" : "outline"}
          size="sm"
          aria-pressed={enabled}
          onClick={() => setEnabled(!enabled)}
        >
          기상 표본 표시
        </Button>
      </div>
      {enabled && (
        <>
          <label className="vessel-weather-time">
            기상 예보 시각 · KST{" "}
            <strong>
              {fmtDate(
                new Date(
                  Date.parse(sampleWeatherBase) + hour * 3600000,
                ).toISOString(),
                true,
              )}{" "}
              (+{hour}h)
            </strong>
            <input
              aria-label="기상 예보 시각"
              type="range"
              min="0"
              max="72"
              step="6"
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            />
          </label>
          <div className="vessel-weather-points">
            {points.map((p) => (
              <div key={p.id}>
                <span>{p.label}</span>
                <strong>
                  {n(p.waveM!, 1)} <small>m</small>
                </strong>
                <span>바람 {p.windKn} kn</span>
              </div>
            ))}
          </div>
          <p className="tower-footnote">
            {failed
              ? "기상 조회 실패 예시 · ETA 계산은 유지합니다."
              : hour > sampleWeatherEndH
                ? "예보 범위 밖 · 표본은 +48h까지 제공됩니다. 자료 없음을 안전으로 해석하지 않습니다."
                : !points.length
                  ? "이 항차의 기상 표본이 없습니다."
                  : "숫자는 파고(m)입니다. 통과 시각별 실제 예보와 태풍 경보는 아직 연결되지 않았습니다."}
          </p>
          <label className="vessel-weather-failure">
            <input
              type="checkbox"
              checked={failed}
              onChange={(e) => setFailed(e.target.checked)}
            />
            기상 연결 실패 시연
          </label>
        </>
      )}
    </div>
  );
}

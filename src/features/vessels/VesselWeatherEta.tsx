import { useState } from "react";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { date as dateLabel } from "@/lib/format";
import type { BasicEta } from "./vessel-basic-eta";
import type { ForecastState } from "./vessel-weather";
import { estimateWeatherEta } from "./vessel-weather-eta";

export function VesselWeatherEta({
  vessel,
  basic,
  forecast,
  now,
}: {
  vessel: TrackingVessel;
  basic: BasicEta;
  forecast?: ForecastState;
  now: number;
}) {
  const [sensitivity, setSensitivity] = useState(1);
  const result = estimateWeatherEta({
    vessel,
    basic,
    forecast: forecast?.data,
    now,
    sensitivity,
  });
  return (
    <section className="vessel-weather-eta" aria-label="기상 보정 ETA 비교">
      <div className="vessel-weather-eta-summary" aria-live="polite">
        <div>
          <span className="vessel-eta-label">
            {result.state === "partial"
              ? "부분 기상 보정 ETA"
              : "기상 보정 ETA"}{" "}
            · 시연 모델 · KST
          </span>
          <strong className="vessel-weather-eta-value">
            {result.eta ? dateLabel(result.eta, true) : "보정 보류"}
          </strong>
        </div>
        {result.delayH !== null && (
          <div>
            <span className="vessel-eta-label">기본 ETA 대비 추가 지연</span>
            <strong className="vessel-weather-eta-delay">
              +{result.delayH.toFixed(1)} h
            </strong>
          </div>
        )}
        {result.eta && (
          <div>
            <span className="vessel-eta-label">
              보정 / 미보정 구간 · 기본 소요시간
            </span>
            <strong>
              {result.coveredH.toFixed(1)} / {result.uncoveredH.toFixed(1)} h
            </strong>
          </div>
        )}
      </div>
      <p className="vessel-forecast-note">{result.reason}</p>
      <p className="vessel-forecast-note">
        실제 예보 + 미검증 감속 가정 · 기본 통과 시각의 예보를 고정한 1회
        계산입니다.
      </p>
      <details>
        <summary>보정 가정 및 구간별 영향</summary>
        <label className="vessel-weather-eta-sensitivity">
          감속 민감도 <output>{sensitivity.toFixed(1)}배</output>
          <input
            aria-label="기상 보정 민감도"
            type="range"
            min="0"
            max="1.5"
            step="0.5"
            value={sensitivity}
            onChange={(event) => setSensitivity(Number(event.target.value))}
          />
        </label>
        <p>
          0배는 감속 미적용, 1배는 기본 가정입니다. 설정은 현재 선택 화면에만
          적용됩니다.
        </p>
        <ul>
          <li>
            파고 1.5m 초과분: 1m당 4%p, 풍속 15kn 초과분: 1kn당 0.2%p를 감속
            부담으로 가정합니다. 실측에서 학습한 계수가 아닙니다.
          </li>
          <li>
            마주 오는 파도·바람에 100%, 옆·뒤에서 오는 경우 50%의 방향 가중치를
            적용합니다. 두 부담에 민감도를 곱하고 합계는 30%로 제한합니다.
          </li>
          <li>
            현재 지점의 부담을 기준으로 더 나빠지는 구간만 추가 감속합니다. 현재
            SOG를 무풍 속도로 간주하지 않으며, 기상 개선에 따른 가속은 계산하지
            않습니다.
          </li>
          <li>
            구간 양 끝의 부담을 평균합니다. 추가 감속률 r = max(0, (구간 부담 −
            현재 부담) ÷ (1 − 현재 부담)), 추가 시간 = 기본 구간 시간 × r ÷ (1 −
            r)입니다.
          </li>
          <li>
            파고 8m·풍속 50kn·돌풍 65kn 초과는 시연 모델 범위 밖으로 제외합니다.
            이는 항해 안전 기준이 아닙니다. 누락·오래된 예보와 72시간 이후도
            보정하지 않습니다.
          </li>
          <li>
            미보정 구간은 기본 SOG 유지 가정입니다.
            돌풍·파주기·해류·선체·적재량·우회·항만 대기는 지연 수치에 반영하지
            않습니다. 돌풍은 모델 범위 검사에만 사용합니다.
          </li>
        </ul>
        {!!result.segments.length && (
          <div className="vessel-weather-eta-table-scroll">
            <table>
              <caption>기본 통과 시각별 추가 영향 · KST</caption>
              <thead>
                <tr>
                  <th>구간</th>
                  <th>추가 감속</th>
                  <th>추가 소요</th>
                </tr>
              </thead>
              <tbody>
                {result.segments.map((segment) => (
                  <tr key={segment.from}>
                    <td>
                      {dateLabel(segment.from, true)} →{" "}
                      {dateLabel(segment.to, true)}
                    </td>
                    <td>{segment.slowdownPct.toFixed(1)}%</td>
                    <td>+{segment.delayH.toFixed(2)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          보정된 통과 시각으로 기상을 다시 조회하지 않으므로 긴 지연에서는
          오차가 커질 수 있습니다. 항차·접안·하역·재고 계획에는 자동 반영하지
          않습니다.
        </p>
      </details>
    </section>
  );
}

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TowerChart } from "@/components/TowerChart";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { fitModels, type ModelRuns } from "@/domain/models";
import { BASE_TIME } from "@/domain/operations";
import { Section } from "@/components/tower/primitives";
import { axis, line, labelDay } from "@/components/tower/chart-options";
import { ModelCard } from "@/components/tower/ModelCard";
import "./models.css";

export function ModelsPage({
  models,
  onModels,
  theme,
}: {
  models: ModelRuns;
  onModels: (models: ModelRuns) => void;
  theme: string;
}) {
  const [iterations, setIterations] = useState(120);
  const [busy, setBusy] = useState(false);
  async function train() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 350));
    try {
      onModels(fitModels(iterations));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tower-page">
      <Section
        title="예측 실험"
        note="고정 합성 시계열을 사용한 로컬 기준모델 · 실제 계통 예측 성능을 의미하지 않습니다"
      >
        <div className="model-controls">
          <label>
            학습 반복{" "}
            <select
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
            >
              <option value={30}>30회</option>
              <option value={120}>120회</option>
              <option value={300}>300회</option>
            </select>
          </label>
          <Button onClick={train} disabled={busy}>
            <FlaskConical size={15} />
            {busy ? "학습 중" : "재학습 · 전망에 적용"}
          </Button>
          {busy && (
            <ProcessingOrb
              theme={theme as "light" | "dark"}
              state="solving"
              label="학습 및 검증 계산 중…"
            />
          )}
        </div>
        <p className="tower-footnote">
          학습 데이터 150일과 검증 데이터 30일을 분리합니다. 예측 수요·공급용량
          비율을 호기 계획 발전량에 반영하고, 열량·효율을 통해 연료사용과 재고로
          연결합니다. 계획정지와 정격용량 상한도 적용됩니다.
        </p>
      </Section>
      <div className="tower-two">
        <ModelCard model={models.demand} theme={theme} />
        <ModelCard model={models.capacity} theme={theme} />
      </div>
      <ModelCard model={models.peak} theme={theme} />
      <Section
        title="90일 모델 출력"
        note="지역별 실측 모델이 아닌 합성 계통 시계열 · 발전소 선택은 발전량 배분에 적용"
      >
        <TowerChart
          theme={theme}
          label="90일 일평균 수요 및 공급가능 용량 예측 MW"
          height={290}
          option={{
            xAxis: {
              type: "category",
              data: models.demand.predictions
                .slice(0, 90)
                .map((_, i) =>
                  labelDay(
                    new Date(Date.parse(BASE_TIME) + i * 86400000)
                      .toISOString()
                      .slice(0, 10),
                  ),
                ),
            },
            yAxis: axis("MW"),
            series: [
              line("평균 전력수요", models.demand.predictions.slice(0, 90)),
              line("최대 전력수요", models.peak.predictions.slice(0, 90)),
              line("공급가능 용량", models.capacity.predictions.slice(0, 90)),
            ],
          }}
        />
      </Section>
      <p className="tower-footnote">
        현재 모델은 평균·최대 수요와 석탄가용 용량을 예측합니다. 첫 예측일은
        2026-10-06이며 최종 관측일 2026-10-05의 D+1입니다. Python/XGBoost 모델
        서비스 및 MILP 급전 최적화는 후속 연동 범위입니다.
      </p>
    </div>
  );
}

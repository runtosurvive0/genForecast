import { TowerChart } from "@/components/TowerChart";
import { type ModelRuns } from "@/domain/models";
import { number as n } from "@/lib/format";
import { Section } from "@/components/tower/primitives";
import { axis, line } from "@/components/tower/chart-options";


export function ModelCard({
  model,
  theme,
}: {
  model: ModelRuns["demand"];
  theme: string;
}) {
  return (
    <Section
      title={model.name + " 모델"}
      note={model.version + " · 합성 데이터 / 선형 회귀"}
      action={<span className="tower-tag">SYNTHETIC</span>}
    >
      <div className="model-metrics">
        <span>
          MAE <b>{n(model.metrics.mae, 1)} MW</b>
        </span>
        <span>
          RMSE <b>{n(model.metrics.rmse, 1)} MW</b>
        </span>
        <span>
          MAPE <b>{n(model.metrics.mape, 2)} %</b>
        </span>
      </div>
      <TowerChart
        theme={theme}
        label={model.name + " 학습 및 검증 손실 곡선"}
        height={170}
        option={{
          xAxis: {
            type: "category",
            data: model.losses.map((x) => x.iteration),
            name: "iteration",
          },
          yAxis: {
            ...axis("정규화 MSE"),
            axisLabel: { formatter: (v: number) => v.toFixed(2) },
          },
          series: [
            line(
              "학습",
              model.losses.map((x) => x.train),
            ),
            line(
              "검증",
              model.losses.map((x) => x.validation),
            ),
          ],
        }}
      />
      <p className="tower-footnote">
        학습 {model.trainStart} ~ {model.trainEnd} (150일)
        <br />
        검증 {model.validationStart} ~ {model.validationEnd} (30일)
      </p>
    </Section>
  );
}

export interface ModelResult {
  name: string;
  version: string;
  unit: string;
  source: "SYNTHETIC";
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  losses: { iteration: number; train: number; validation: number }[];
  metrics: { mae: number; rmse: number; mape: number };
  predictions: number[];
  reference: number;
}
export type ModelRuns = {
  demand: ModelResult;
  capacity: ModelResult;
  peak: ModelResult;
};
export function errorMetrics(actual: number[], predicted: number[]) {
  if (
    !actual.length ||
    actual.length !== predicted.length ||
    [...actual, ...predicted].some((v) => !Number.isFinite(v))
  )
    throw new Error("Invalid metric inputs");
  const delta = actual.map((v, i) => Math.abs(v - predicted[i]));
  const nonzero = actual
    .map((v, i) => (v ? delta[i] / Math.abs(v) : null))
    .filter((v): v is number => v !== null);
  return {
    mae: delta.reduce((s, v) => s + v, 0) / delta.length,
    rmse: Math.sqrt(delta.reduce((s, v) => s + v * v, 0) / delta.length),
    mape: nonzero.length
      ? (nonzero.reduce((s, v) => s + v, 0) / nonzero.length) * 100
      : 0,
  };
}
/** Deterministic synthetic regression; holdout rows never participate in fitting. */
export function fitModels(iterations = 120): ModelRuns {
  const fit = (kind: "demand" | "capacity" | "peak"): ModelResult => {
    const base = kind === "capacity" ? 50000 : kind === "peak" ? 96000 : 82000;
    const features = (i: number) => [
      1,
      Math.sin((i * 2 * Math.PI) / 7),
      Math.cos((i * 2 * Math.PI) / 30),
      Math.sin((i * 2 * Math.PI) / 365),
      i / 180,
    ];
    const target = (i: number) =>
      kind !== "capacity"
        ? 1 +
          0.075 * features(i)[1] +
          0.04 * features(i)[2] +
          0.06 * features(i)[3] +
          0.025 * features(i)[4] +
          0.008 * Math.sin(i * 1.71)
        : 1 +
          0.02 * features(i)[1] -
          0.035 * features(i)[2] +
          0.015 * features(i)[3] -
          0.01 * features(i)[4] +
          0.005 * Math.cos(i * 1.37);
    const weights = [0, 0, 0, 0, 0];
    const predict = (i: number) =>
      features(i).reduce((s, x, j) => s + x * weights[j], 0);
    const loss = (start: number, end: number) =>
      Array.from(
        { length: end - start },
        (_, n) => (predict(start + n) - target(start + n)) ** 2,
      ).reduce((s, v) => s + v, 0) /
      (end - start);
    const losses: ModelResult["losses"] = [];
    for (let step = 0; step <= iterations; step++) {
      losses.push({
        iteration: step,
        train: loss(0, 150),
        validation: loss(150, 180),
      });
      if (step === iterations) break;
      const gradient = weights.map(
        (_, j) =>
          Array.from(
            { length: 150 },
            (_, i) => (predict(i) - target(i)) * features(i)[j] * 2,
          ).reduce((s, v) => s + v, 0) / 150,
      );
      gradient.forEach((g, j) => (weights[j] -= 0.15 * g));
    }
    const actual = Array.from({ length: 30 }, (_, i) => target(i + 150) * base);
    const predicted = actual.map((_, i) => predict(i + 150) * base);
    return {
      name:
        kind === "demand"
          ? "일평균 전력수요"
          : kind === "peak"
            ? "일최대 전력수요"
            : "석탄가용 용량",
      version: `local-linear-v1/${iterations}`,
      unit: "MW",
      source: "SYNTHETIC",
      trainStart: "2026-04-09",
      trainEnd: "2026-09-05",
      validationStart: "2026-09-06",
      validationEnd: "2026-10-05",
      losses,
      metrics: errorMetrics(actual, predicted),
      predictions: Array.from({ length: 97 }, (_, i) =>
        Math.max(0, predict(180 + i) * base),
      ),
      reference: base,
    };
  };
  return {
    demand: fit("demand"),
    capacity: fit("capacity"),
    peak: fit("peak"),
  };
}

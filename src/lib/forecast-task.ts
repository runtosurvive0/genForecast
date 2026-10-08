import ForecastWorker from "../workers/forecast.worker?worker&inline";
import {
  simulate,
  type Plant,
  type Shipment,
  type Scenario,
  type Forecast,
} from "../domain/operations";

export function forecastTask(
  plants: Plant[],
  shipments: Shipment[],
  scenario: Scenario,
  horizonDays: number,
): Promise<Forecast> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let finished = false;
    const finish = (result?: Forecast, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker?.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const fallback = () => {
      try {
        finish(simulate(plants, shipments, scenario, horizonDays));
      } catch (error) {
        finish(undefined, error);
      }
    };
    const timeout = setTimeout(fallback, 5000);
    try {
      worker = new ForecastWorker();
      worker.onmessage = ({ data }) =>
        data.error
          ? finish(undefined, new Error(data.error))
          : finish(data.result);
      worker.onerror = fallback;
      worker.postMessage({ plants, shipments, scenario, horizonDays });
    } catch {
      fallback();
    }
  });
}

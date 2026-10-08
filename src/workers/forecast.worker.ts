import { simulate } from "../domain/operations";
self.onmessage = (event) => {
  try {
    const { plants, shipments, scenario, horizonDays } = event.data;
    self.postMessage({
      result: simulate(plants, shipments, scenario, horizonDays),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "계산하지 못했습니다.",
    });
  }
};

import { useEffect, useState } from "react";
import {
  addDays,
  loadPlanningRuns,
  loadPlanningSnapshot,
  type PlanningRun,
  type PlanningSnapshot,
} from "./planning";

export const initialPlanningQuery = (run: PlanningRun) => ({
  runId: run.id,
  start: run.start,
  horizon: addDays(run.start, 29) <= run.end ? 30 : 7,
});
export type PlanningQuery = ReturnType<typeof initialPlanningQuery>;

/** App owns this state so both supply screens keep the same query and result. */
export function usePlanning(enabled: boolean) {
  const [runs, setRuns] = useState<PlanningRun[]>([]);
  const [query, setQuery] = useState<PlanningQuery | null>(null);
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    loadPlanningRuns(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setRuns(rows);
        setQuery((current) =>
          current && rows.some((r) => r.id === current.runId)
            ? current
            : rows[0]
              ? initialPlanningQuery(rows[0])
              : null,
        );
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setListError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [enabled, revision]);

  useEffect(() => {
    if (!enabled || !query) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSnapshot(null);
    loadPlanningSnapshot(
      query.runId,
      query.start,
      query.horizon,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, query, revision]);

  const current =
    snapshot &&
    query &&
    snapshot.run_id === query.runId &&
    snapshot.start === query.start &&
    snapshot.horizon_days === query.horizon
      ? snapshot
      : null;
  return {
    runs,
    query,
    setQuery,
    current,
    listLoading,
    loading,
    failed: listError || error,
    refresh,
  };
}
export type PlanningState = ReturnType<typeof usePlanning>;

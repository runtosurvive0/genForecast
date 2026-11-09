import { useEffect, useState } from "react";
import {
  addDays,
  initialPlanningQuery,
  loadPlanningRuns,
  loadPlanningSnapshot,
  type PlanningRun,
  type PlanningSnapshot,
} from "./planning";
import { kstDay } from './operations-status';

export { initialPlanningQuery } from './planning';
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
        const today = kstDay(new Date());
        const preferred = rows.find(r => r.start <= today && addDays(today, 6) <= r.end) ?? rows[0];
        setQuery((current) =>
          current && rows.some((r) => r.id === current.runId)
            ? current
            : preferred
              ? initialPlanningQuery(preferred, today)
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

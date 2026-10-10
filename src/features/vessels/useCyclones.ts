import { useEffect, useState } from "react";
import { navigationJson } from "./vessel-navigation";
import { decodeCyclones, type CycloneSnapshot } from "./vessel-weather-layers";

export function useCyclones(enabled: boolean) {
  const [data, setData] = useState<CycloneSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || location.protocol === "file:") return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      setBusy(true);
      setError("");
      try {
        const result = decodeCyclones(
          await navigationJson(
            "cyclones",
            AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]),
          ),
        );
        if (!abort.signal.aborted) setData(result);
      } catch {
        if (!abort.signal.aborted) {
          setError("태풍 조회 실패 · 서버 연결과 재시작 여부를 확인해 주세요.");
          setData(undefined);
        }
      } finally {
        if (!abort.signal.aborted) {
          setBusy(false);
          timer = setTimeout(poll, 30 * 60000);
        }
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
      setBusy(false);
    };
  }, [enabled, revision]);
  return { data, busy, error, refresh: () => setRevision((v) => v + 1) };
}

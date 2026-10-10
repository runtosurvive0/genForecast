import { useState } from "react";
import { initialWatchlist, vesselCatalog } from "@/data/vessel-workflow";
import {
  mergeWorkspace,
  parseWorkspace,
  type VesselWorkspace,
} from "@/domain/vessel-workflow";

const KEY = "genforecast.vessel-workspace.v1";
const empty = (): VesselWorkspace => ({
  version: 1,
  watchlist: [],
  vessels: [],
  voyages: [],
});
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return {
      workspace:
        raw === null
          ? { ...empty(), watchlist: initialWatchlist }
          : mergeWorkspace(empty(), parseWorkspace(raw), vesselCatalog),
      error: "",
    };
  } catch {
    return {
      workspace: { ...empty(), watchlist: initialWatchlist },
      error:
        "저장된 관심 목록을 읽지 못했습니다. 기존 저장값은 보존했습니다. 내보내기로 현재 목록을 보관한 뒤 다시 시도해 주세요.",
    };
  }
}
export function useVesselWorkspace() {
  const [initial] = useState(load);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [error, setError] = useState(initial.error);
  function save(next: VesselWorkspace) {
    // Validate before replacing state; malformed imports cannot clear the list.
    const checked = parseWorkspace(JSON.stringify(next));
    try {
      localStorage.setItem(KEY, JSON.stringify(checked));
      setError("");
    } catch {
      setError(
        "브라우저 저장 공간을 사용할 수 없습니다. 이번 화면에서만 유지됩니다. 내보내기로 보관해 주세요.",
      );
    }
    setWorkspace(checked);
  }
  return { workspace, save, error, setError };
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createFuelDemoTransport, disabledDemoState } from "./transport";
import type { FuelDemoRole, FuelDemoValue } from "./types";
import { alignDemoToBaseline, type BaselineLotLike } from "./align-baseline";

const disabledValue: FuelDemoValue = {
  ...disabledDemoState,
  command: () => Promise.reject(new Error("데모 연결이 비활성 상태입니다.")),
};
const FuelDemoContext = createContext<FuelDemoValue>(disabledValue);

export function FuelDemoProvider({
  enabled,
  role = "viewer",
  baselineLots,
  children,
}: {
  enabled: boolean;
  role?: FuelDemoRole;
  /** 저장된 기준재고 원탄. 주면 데모 재고를 저탄장·등급별 기준재고 합계에 맞춰 모든 화면이 같은 값을 본다. */
  baselineLots?: BaselineLotLike[] | null;
  children: ReactNode;
}) {
  const transport = useMemo(() => createFuelDemoTransport({ role }), [role]);
  const state = useSyncExternalStore(
    transport.subscribe,
    transport.getSnapshot,
    () => disabledDemoState,
  );
  useEffect(() => {
    if (!enabled) {
      transport.stop();
      return;
    }
    return transport.start();
  }, [enabled, transport]);
  const value = useMemo<FuelDemoValue>(
    () => (enabled
      ? { ...state, snapshot: alignDemoToBaseline(state.snapshot, baselineLots), command: transport.command }
      : disabledValue),
    [enabled, state, transport, baselineLots],
  );
  return (
    <FuelDemoContext.Provider value={value}>
      {children}
    </FuelDemoContext.Provider>
  );
}
export function useFuelDemo() {
  return useContext(FuelDemoContext);
}

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

const disabledValue: FuelDemoValue = {
  ...disabledDemoState,
  command: () => Promise.reject(new Error("데모 연결이 비활성 상태입니다.")),
};
const FuelDemoContext = createContext<FuelDemoValue>(disabledValue);

export function FuelDemoProvider({
  enabled,
  role = "viewer",
  children,
}: {
  enabled: boolean;
  role?: FuelDemoRole;
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
    () => (enabled ? { ...state, command: transport.command } : disabledValue),
    [enabled, state, transport],
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

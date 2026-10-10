import { useCallback, useEffect, useState } from "react";
import type { VesselPosition } from "@/domain/ais";
import {
  normalizeAisPositions,
  normalizeSensorReadings,
  normalizeSupplyRecords,
  toSupplyTransfer,
  toSupplyVessel,
  type SensorReading,
  type SimTransfer,
  type SupplyTransferRecord,
  type SupplyVesselRecord,
} from "./stockyard-domain";
import type { Voyage } from "@/data/control-tower";

/**
 * 저탄장 외부 연계 클라이언트. 모두 같은 출처(`/api`)의 서버만 부르며 비밀키를 쓰지 않는다.
 * - `/api/supply/*`: backend/의 당진 연료수급 원장 (구현됨)
 * - `/api/v1/vessels`, `/api/v1/stockpiles/sensors`: SPEC §10·README §3.6 계약 (서버 미구현)
 * 실패하면 화면은 더미 표본으로 계속 동작한다.
 */

const TIMEOUT_MS = 3000;

export class IntegrationError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (typeof location !== "undefined" && location.protocol === "file:")
    throw new IntegrationError("오프라인 HTML · 서버 없음");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const detail =
        body && typeof body === "object" && "detail" in body
          ? String((body as { detail: unknown }).detail)
          : `HTTP ${res.status}`;
      throw new IntegrationError(detail);
    }
    if (body === null) throw new IntegrationError("응답 형식 오류");
    return body as T;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(
      controller.signal.aborted ? "응답 시간 초과" : "서버 연결 실패",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface SupplyRecords {
  transfers: SupplyTransferRecord[];
  vessels: SupplyVesselRecord[];
}

export const fetchSupplyRecords = async (): Promise<SupplyRecords> =>
  normalizeSupplyRecords(await request<unknown>("/api/supply/records"));

export const saveSupplyTransfer = (transfer: SimTransfer) =>
  request<{ id: number }>("/api/supply/transfers", {
    method: "POST",
    body: JSON.stringify(toSupplyTransfer(transfer)),
  });

export const registerSupplyVessel = (voyage: Voyage, berthId: string) =>
  request<{ id: number }>("/api/supply/vessels", {
    method: "POST",
    body: JSON.stringify(toSupplyVessel(voyage, berthId)),
  });

export const correctSupplyUnloading = (
  vessel: SupplyVesselRecord,
  at: string,
  cumulative: number,
) => {
  const last = [...vessel.points].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  )[vessel.points.length - 1];
  return request<{ id: number; cumulative: number }>(
    `/api/supply/vessels/${vessel.id}/unloading`,
    {
      method: "POST",
      body: JSON.stringify({
        at,
        cumulative,
        rate: last?.rate ?? 0,
        allocations: last?.allocations ?? { g14: 1, g58: 0, g910: 0 },
      }),
    },
  );
};

/** SPEC §10 `GET /api/v1/vessels?plant_id=` → 정규화된 VesselPosition 목록. */
export const fetchAisPositions = async (
  plantId: string,
): Promise<Omit<VesselPosition, "freshness">[]> =>
  normalizeAisPositions(
    await request<unknown>(`/api/v1/vessels?plant_id=${encodeURIComponent(plantId)}`),
  );

/** README §3.6 제안 `GET /api/v1/stockpiles/sensors[?plant_id=]`. 범위가 전체면 plant_id 없이. */
export const fetchSensorReadings = async (plantId?: string): Promise<SensorReading[]> =>
  normalizeSensorReadings(
    await request<unknown>(
      `/api/v1/stockpiles/sensors${plantId ? `?plant_id=${encodeURIComponent(plantId)}` : ""}`,
    ),
  );

export type LinkStatus = "checking" | "online" | "offline";

export interface LinkState<T> {
  status: LinkStatus;
  data: T | null;
  error: string;
  checkedAt: string | null;
}

/** 한 연계 지점의 상태(확인 중/연결/미연결)와 마지막 성공 값. 실패해도 이전 값은 유지. */
export function useLink<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<LinkState<T>>({
    status: "checking",
    data: null,
    error: "",
    checkedAt: null,
  });
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, status: "checking" }));
    try {
      const data = await load();
      setState({
        status: "online",
        data,
        error: "",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      setState((s) => ({
        ...s,
        status: "offline",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { ...state, refresh };
}

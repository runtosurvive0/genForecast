// 적치 추천 API 호출(ZGX). 실패를 합성 결과로 대신하지 않는다.
import { authJson } from '../lib/auth-client';
import type { CargoRequest, StackingResult, WaitingVoyage } from './stacking.ts';

export function fetchStacking(body: CargoRequest | { voyage_no: string }, signal?: AbortSignal): Promise<StackingResult> {
  return authJson<StackingResult>('/api/stacking/recommend', { method: 'POST', body: JSON.stringify(body), signal });
}

export function fetchWaitingVoyages(signal?: AbortSignal): Promise<{ as_of: string | null; items: WaitingVoyage[] }> {
  return authJson('/api/stacking/candidates', { signal });
}

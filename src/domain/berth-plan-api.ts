// 접안 추천 API 호출(ZGX). 실패를 합성 결과로 대신하지 않는다.
import { authJson } from '../lib/auth-client';
import { parseBerthPlan, type BerthPlanResult } from './berth-plan.ts';

/** 풀이가 안마다 최대 30초 걸릴 수 있으므로 호출하는 쪽이 signal을 넘겨 기본 15초 제한을 끈다. */
export async function fetchBerthPlan(
  body: { horizon_days?: number; penalty_usd?: number }, signal?: AbortSignal,
): Promise<BerthPlanResult> {
  return parseBerthPlan(await authJson<unknown>('/api/berth-plan/recommend', { method: 'POST', body: JSON.stringify(body), signal }));
}

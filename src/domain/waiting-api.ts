// 부두 대기 후보 조회·확인 답 저장(ZGX). 실패를 로컬·합성 후보로 대신하지 않는다.
import { ApiError, authJson } from '../lib/auth-client';
import type { WaitingFeed } from './waiting-candidates.ts';

export const WAITING_CONFLICT = '후보 상태가 바뀌었습니다.';

export function fetchWaiting(signal: AbortSignal): Promise<WaitingFeed> {
  return authJson<WaitingFeed>('/api/vessels/waiting-candidates', { signal });
}

export async function answerWaiting(mmsi: string, answer: 'yes' | 'no'): Promise<{ answeredAt: string }> {
  try {
    return await authJson<{ answeredAt: string }>(`/api/vessels/waiting-candidates/${mmsi}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new Error(WAITING_CONFLICT);
    throw error;
  }
}

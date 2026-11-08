import { useEffect, useState } from 'react';
import { authJson } from '@/lib/auth-client';

export interface YardBaselineLot {
  source_id?: string | null;
  location: string;
  coal_name: string;
  tonnes: number;
  voyage_number?: string | null;
  grade?: string | null;
  age_days?: number | null;
  start_m?: number | null;
  end_m?: number | null;
}
export interface YardBaseline { revision: number; as_of: string | null; total_t: number | null; lots: YardBaselineLot[] }

export function useYardBaseline() {
  const [data, setData] = useState<YardBaseline | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    authJson<YardBaseline>('/api/voyage-registry/inventory/baseline', { signal: controller.signal })
      .then(setData)
      .catch(() => { if (!controller.signal.aborted) setError('저탄장 기준재고를 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, []);
  return { data, error };
}

// 당진 부두 대기(체선) 후보: ZGX가 규칙으로 찾은 후보를 사람이 확인하도록 묻는 문장과 근거 칩.
// 공개 AIS만으로 화물·계약을 단정하지 않으므로 "후보"로만 묻고 화물 종류는 말하지 않는다.

export interface WaitingCandidate {
  mmsi: string;
  name: string;
  shipType: number | null;
  navStatus: number | null;
  sogKn: number | null;
  destination: string | null;
  position: { latitude: number; longitude: number; observedAt: string };
  dwellHours: number;
  distanceKm: number;
  stale: boolean;
  reasons: string[];
}

export interface WaitingFeed {
  updatedAt: string;
  lastReceivedAt: string | null;
  radiusKm: number;
  candidates: WaitingCandidate[];
  /** 내가 "네"로 확인한 배와 확인 시각 */
  confirmed: Record<string, string>;
}

export function waitingQuestion(c: WaitingCandidate): string {
  return `${c.name}이 당진 부두에서 ${c.distanceKm.toFixed(1)}km 떨어진 바다에서 ${Math.round(c.dwellHours)}시간째 멈춰 있습니다. 부두 대기(체선) 중인 배가 맞나요?`;
}

export function waitingChips(c: WaitingCandidate, now: number): string[] {
  const chips: string[] = [];
  if (c.navStatus === 1) chips.push('묘박');
  if (c.sogKn !== null) chips.push(`${c.sogKn.toFixed(1)}노트`);
  chips.push(c.destination ? `목적지 ${c.destination}` : '목적지 미기재');
  chips.push(c.shipType === null ? '선종 미상' : '화물선');
  const minutes = Math.max(0, Math.floor((now - Date.parse(c.position.observedAt)) / 60000));
  chips.push(minutes >= 60 ? `관측 ${Math.floor(minutes / 60)}시간 전` : `관측 ${minutes}분 전`);
  return chips;
}

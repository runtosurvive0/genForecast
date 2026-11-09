// 계획·입력 목록의 표시 이름. 같은 이름의 저장 항목도 번호와 실행 시각(KST)으로 구분한다.
const KST_MS = 9 * 3600000;
const pad = (value: number) => String(value).padStart(2, "0");

/** ISO 시각(시간대 포함)을 "MM-DD HH:mm KST"로. 날짜만 있거나 해석할 수 없으면 null. */
function recordedKst(value: string | undefined): string | null {
  if (!value || !/T\d{2}:\d{2}/.test(value)) return null;
  const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(ms)) return null;
  const at = new Date(ms + KST_MS);
  return `${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} KST`;
}

/** 계산 실행 식별자 앞의 YYYYMMDD-HHMMSS(서버 현지 KST)를 "MM-DD HH:mm KST"로. */
function runIdKst(runId: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}/.exec(runId ?? "");
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]} KST` : null;
}

export function planLabel(item: { name: string; id?: number; recorded_at?: string; run_id?: string; start: string; end: string }): string {
  const time = recordedKst(item.recorded_at) ?? runIdKst(item.run_id);
  return `${item.id != null ? `#${item.id} ` : ""}${item.name} · ${item.start} ~ ${item.end}${time ? ` · ${time}` : ""}`;
}

/** 실행 이력 한 줄: 제목은 입력 이름과 실행 시각, 내부 식별자는 보조 글자로 분리한다. */
export function runTitle(runId: string, name: string): { title: string; sub: string } {
  const time = runIdKst(runId);
  return { title: time ? `${name} · ${time}` : name, sub: runId };
}

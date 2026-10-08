export const number = (value: number, digits = 0) =>
  new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value);
export const date = (value: string | null, time = false) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        ...(time
          ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
          : {}),
      }).format(new Date(value))
    : "기간 내 없음";
export const shiftDate = (value: string, days: number) =>
  new Date(new Date(value).getTime() + days * 86400000).toISOString();

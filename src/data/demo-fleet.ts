/**
 * 시연용 모의 선박(가상). 접안·하역 화면, 선박 지도, 관심 선박이 모두 이 목록 하나를 본다.
 * 식별자(IMO·MMSI)와 위치는 모두 합성값이며 실제 AIS 관측이 아니다.
 * 입항 시각은 '오늘(KST)'을 기준으로 정해 시연 날짜가 바뀌어도 지난 일정이 다음 입항으로 보이지 않는다.
 */
export type DemoBerth = 1 | 2 | 3;
export interface DemoVoyage {
  id: string;
  vesselId: string;
  name: string;
  imo: string;
  mmsi: string;
  origin: string;
  tons: number;
  berth: DemoBerth | null;
  coal: string;
  discharged: number | null;
  arrivalAt: string;
  state: "arrived" | "underway" | "planned";
  position: { latitude: number; longitude: number; cogDeg: number; sogKn: number } | null;
}

const HOUR = 3_600_000;
const KST = 9 * HOUR;
/** 당진 연료부두 부근(합성 표시 위치). */
export const DEMO_DOCK = { latitude: 37.05, longitude: 126.51 };

function kstMidnight(now: number) {
  return Math.floor((now + KST) / (24 * HOUR)) * 24 * HOUR - KST;
}
function iso(ms: number) {
  return new Date(ms + KST).toISOString().replace(/\.\d{3}Z$/, "+09:00");
}
/** 다음 입항 선박의 항해 위치: 부두에서 남남서로 남은 시간 × 12노트만큼 떨어진 지점. */
function underwayPosition(hoursLeft: number) {
  const nm = Math.min(Math.max(hoursLeft, 1), 60) * 12;
  const bearing = (200 * Math.PI) / 180;
  const latitude = DEMO_DOCK.latitude + (nm * Math.cos(bearing)) / 60;
  const longitude =
    DEMO_DOCK.longitude + (nm * Math.sin(bearing)) / (60 * Math.cos((latitude * Math.PI) / 180));
  return { latitude: +latitude.toFixed(4), longitude: +longitude.toFixed(4), cogDeg: 20, sogKn: 12 };
}

export function demoFleet(now: number = Date.now()): DemoVoyage[] {
  const today = kstMidnight(now);
  let next = today + 24 * HOUR + 6 * HOUR;
  if (next - now < 6 * HOUR) next += 24 * HOUR;
  const base = {
    imo: "",
    discharged: null,
    position: null,
  };
  return [
    {
      ...base,
      id: "V-26041", vesselId: "demo-gen4cast-horizon", name: "GEN4CAST HORIZON",
      imo: "DEMO-26041", mmsi: "999026041",
      origin: "인도네시아 · Taboneo", tons: 75000, berth: 1, coal: "GN-A", discharged: 31200,
      arrivalAt: iso(today - 24 * HOUR + 2 * HOUR), state: "arrived",
      position: { latitude: 37.052, longitude: 126.505, cogDeg: 0, sogKn: 0 },
    },
    {
      ...base,
      id: "V-26042", vesselId: "demo-gen4cast-pacific", name: "GEN4CAST PACIFIC",
      imo: "DEMO-26042", mmsi: "999026042",
      origin: "호주 · Newcastle", tons: 82000, berth: 2, coal: "GN-B", discharged: 18600,
      arrivalAt: iso(today - 24 * HOUR + 5 * HOUR), state: "arrived",
      position: { latitude: 37.047, longitude: 126.515, cogDeg: 0, sogKn: 0 },
    },
    {
      ...base,
      id: "V-26043", vesselId: "demo-gen4cast-ocean", name: "GEN4CAST OCEAN",
      imo: "DEMO-26043", mmsi: "999026043",
      origin: "인도네시아 · Muara Jawa", tons: 70000, berth: 3, coal: "GN-C",
      arrivalAt: iso(next), state: "underway",
      position: underwayPosition((next - now) / HOUR),
    },
    {
      ...base,
      id: "V-26044", vesselId: "demo-gen4cast-dawn", name: "GEN4CAST DAWN",
      imo: "DEMO-26044", mmsi: "999026044",
      origin: "호주 · Gladstone", tons: 78000, berth: null, coal: "GN-D",
      arrivalAt: iso(next + 4 * 24 * HOUR + 8 * HOUR), state: "planned",
    },
    {
      ...base,
      id: "V-26045", vesselId: "demo-gen4cast-atlas", name: "GEN4CAST ATLAS",
      imo: "DEMO-26045", mmsi: "999026045",
      origin: "인도네시아 · Balikpapan", tons: 68000, berth: null, coal: "GN-E",
      arrivalAt: iso(next + 11 * 24 * HOUR + 2 * HOUR), state: "planned",
    },
  ];
}

/** 'MM.DD' / 'HH:mm' (KST) */
export function kstParts(isoText: string) {
  const d = new Date(Date.parse(isoText) + KST);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}
export const demoVesselIds = demoFleet(0).map((v) => v.vesselId);
/**
 * 데모 연결이 켜져 있으면 모의 선박을 관심 목록 맨 앞에 고정한다(저장하지 않음, ZGX 계정 자료 불변).
 * 꺼져 있으면 모의 선박을 목록에서 감춘다.
 */
export function withDemoWatchlist(watchlist: string[], demoOn: boolean): string[] {
  const rest = watchlist.filter((id) => !demoVesselIds.includes(id));
  return demoOn ? [...demoVesselIds, ...rest] : rest;
}

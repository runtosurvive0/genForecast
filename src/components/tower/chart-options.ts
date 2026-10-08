import { number as n } from "@/lib/format";

export const axis = (name: string) => ({
  type: "value",
  name,
  nameTextStyle: { fontSize: 10 },
  splitLine: { lineStyle: { color: "#88888818" } },
  axisLabel: {
    formatter: (v: number) =>
      Math.abs(v) >= 1000 ? `${n(v / 1000, 0)}k` : n(v, 0),
  },
});
export const line = (name: string, data: (number | null)[], extra = {}) => ({
  name,
  type: "line",
  data,
  showSymbol: false,
  lineStyle: { width: 2 },
  ...extra,
});
export const labelDay = (value: string) => value.slice(5).replace("-", "/");

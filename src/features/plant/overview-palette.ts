/** 발전·수급 전망 화면의 포인트색 데이터 팔레트. ECharts(SVG)는 CSS 변수를 못 읽어 hex로 둔다. */
export function overviewPalette(theme: string) {
  return theme === "dark"
    ? { c1: "#6b94ff", c2: "#a9beff", c3: "#4f76e6", muted: "#5d6574", ink: "#d5d9e0" }
    : { c1: "#2447c5", c2: "#8aa3ec", c3: "#14245f", muted: "#a3adbd", ink: "#34465f" };
}

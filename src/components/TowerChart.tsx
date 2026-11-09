import { useEffect, useRef } from "react";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { LineChart, BarChart, ScatterChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  MarkLineComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
use([
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  MarkLineComponent,
  SVGRenderer,
]);
export function TowerChart({
  option,
  label,
  theme,
  height = 240,
}: {
  option: EChartsCoreOption;
  label: string;
  theme: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const dark = theme === "dark";
    const chart = init(ref.current, undefined, { renderer: "svg" });
    chart.setOption({
      animation: false,
      color: [getComputedStyle(ref.current).getPropertyValue("--data-blue").trim(), "#49a28f", "#c08e52", "#85919e"],
      textStyle: {
        fontFamily: "Pretendard, sans-serif",
        color: dark ? "#a5a7b1" : "#646874",
        fontSize: 11,
      },
      aria: { enabled: true },
      tooltip: { trigger: "axis", confine: true },
      grid: { left: 58, right: 20, top: 36, bottom: 36 },
      legend: {
        top: 0,
        textStyle: { color: dark ? "#a5a7b1" : "#646874", fontSize: 11 },
      },
      ...option,
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option, theme]);
  return (
    <div
      ref={ref}
      className="tower-chart"
      role="img"
      aria-label={label}
      style={{ height }}
    />
  );
}

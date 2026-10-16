import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { NAMES } from "./presentation.mjs";
echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
]);
export default function CompareChart({ rows }) {
  const node = useRef(null);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const chart = echarts.init(el);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    chart.setOption({
      animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      color: ["#0c806e", "#557daa", "#a57b40", "#8b6ab2"],
      aria: {
        enabled: true,
        description:
          "所选模型在同一综合评分样本内的各榜排名分。缺失数据不显示条形。",
      },
      legend: {
        bottom: 0,
        type: "scroll",
        textStyle: { fontSize: 11, color: "#516879" },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        renderMode: "richText",
        valueFormatter: (v) =>
          v == null ? "未参与该榜评分" : Number(v).toFixed(1),
      },
      grid: { top: 20, left: 110, right: 25, bottom: 65 },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: "#718592" },
        splitLine: { lineStyle: { color: "#edf1f4" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: Object.values(NAMES),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: "#516879" },
      },
      series: rows.map((r) => ({
        name: r.name,
        type: "bar",
        barMaxWidth: 22,
        itemStyle: { borderRadius: [0, 3, 3, 0] },
        data: Object.keys(NAMES).map((s) => r.percentiles[s] ?? null),
      })),
    });
    const wheel = (e) => e.stopPropagation();
    el.addEventListener("wheel", wheel, {
      capture: true,
      passive: true,
    });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel, { capture: true });
      chart.dispose();
    };
  }, [rows]);
  return (
    <div role="img" aria-label="各榜排名分对比图">
      <div ref={node} className="comparison-chart" />
    </div>
  );
}

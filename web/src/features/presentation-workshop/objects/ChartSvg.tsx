import { useMemo } from "react";
import { init, use as registerCharts } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import {
  BarChart,
  LineChart,
  ScatterChart,
  PieChart,
  RadarChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
} from "echarts/components";
import type { SlideElement } from "../types";

registerCharts([
  SVGRenderer,
  BarChart,
  LineChart,
  ScatterChart,
  PieChart,
  RadarChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
]);

export default function ChartSvg({ element }: { element: SlideElement }) {
  const svg = useMemo(() => {
    const data = element.chart;
    if (!data) return "";
    const circular = data.type === "pie" || data.type === "ring";
    const radar = data.type === "radar";
    const axis = {
      axisLabel: { color: data.axis_color },
      axisLine: { lineStyle: { color: data.axis_color } },
      splitLine: { lineStyle: { color: data.grid_color } },
    };
    const series = circular
      ? [
          {
            type: "pie",
            radius: data.type === "ring" ? ["40%", "70%"] : "70%",
            data: data.categories.map((name, i) => ({
              name,
              value: data.series[0].values[i],
            })),
          },
        ]
      : radar
        ? [
            {
              type: "radar",
              data: data.series.map((series) => ({
                name: series.name,
                value: series.values,
              })),
            },
          ]
        : data.series.map((series) => ({
            type:
              data.type === "column" || data.type === "bar"
                ? "bar"
                : data.type === "scatter"
                  ? "scatter"
                  : "line",
            name: series.name,
            data:
              data.type === "scatter"
                ? series.values.map((y, i) => [Number(data.categories[i]), y])
                : series.values,
            ...(data.type === "area" ? { areaStyle: {} } : {}),
            ...(data.stacked ? { stack: "total" } : {}),
            smooth: data.smooth,
          }));
    const chart = init(null, undefined, {
      renderer: "svg",
      ssr: true,
      width: element.width,
      height: element.height,
    });
    try {
      chart.setOption({
        animation: false,
        color: data.colors,
        textStyle: { fontFamily: "Microsoft YaHei, Arial, sans-serif" },
        legend: { bottom: 0, textStyle: { color: data.axis_color } },
        ...(!circular && !radar
          ? {
              grid: { left: 45, right: 20, top: 20, bottom: 45 },
              xAxis: {
                ...axis,
                type:
                  data.type === "bar"
                    ? "value"
                    : data.type === "scatter"
                      ? "value"
                      : "category",
                data: data.type === "bar" ? undefined : data.categories,
              },
              yAxis: {
                ...axis,
                type: data.type === "bar" ? "category" : "value",
                data: data.type === "bar" ? data.categories : undefined,
              },
            }
          : {}),
        ...(radar
          ? {
              radar: {
                indicator: data.categories.map((name, i) => ({
                  name,
                  max:
                    Math.max(1, ...data.series.map((s) => s.values[i])) * 1.1,
                })),
                axisName: { color: data.axis_color },
                splitLine: { lineStyle: { color: data.grid_color } },
              },
            }
          : {}),
        series,
      });
      return chart.renderToSVGString();
    } finally {
      chart.dispose();
    }
  }, [element.chart, element.width, element.height]);
  return (
    <div
      role="img"
      aria-label={`${element.name || "图表"}，${element.chart?.categories.join("、")}`}
      style={{ width: "100%", height: "100%", opacity: element.opacity }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type DifferenceItem = {
  name: string;
  color: string;
  value: number;
};

type Props = {
  data: DifferenceItem[];
  total: number;
  onClick: () => void;
};

export function DifferenceStructureChart({ data, total, onClick }: Props) {
  const host = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const chart = echarts.init(element);
    chart.setOption({
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const params = raw as { name?: string; value?: unknown; percent?: number };
          const value = Number(params.value ?? 0);
          return `${params.name ?? ""}<br/>${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元（${params.percent ?? 0}%）`;
        },
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "78%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#fff", borderWidth: 3 },
          label: { show: false },
          data: data.map((item) => ({ value: item.value, name: item.name, itemStyle: { color: item.color } })),
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "42%",
          style: {
            text: `${(total / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}万`,
            fill: "#17233d",
            font: "700 18px Microsoft YaHei",
          },
        },
        {
          type: "text",
          left: "center",
          top: "57%",
          style: { text: "未解决差额合计", fill: "#73839a", font: "11px Microsoft YaHei" },
        },
      ],
    });

    const resize = () => chart.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    chart.on("click", onClick);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [data, onClick, total]);

  return <button className="difference-chart" aria-label="查看未解决差额明细" onClick={onClick} ref={host} />;
}

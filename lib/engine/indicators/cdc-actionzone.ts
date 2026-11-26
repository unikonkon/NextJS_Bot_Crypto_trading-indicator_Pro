import { defineIndicator } from "../types";
import { cdcActionZone } from "@/lib/indicators";
import { fromBuySell, COLORS } from "../math";

const ZONE_COLORS: Record<string, string> = {
  green: "#10b981",
  red: "#ef4444",
  blue: "#3b82f6",
  lightblue: "#67e8f9",
  orange: "#f97316",
  yellow: "#eab308",
};

export default defineIndicator({
  id: "cdc_actionzone",
  name: "CDC ActionZone V3",
  category: "trend",
  longRule: "แท่งเขียวแรก (Fast EMA > Slow EMA และราคาอยู่เหนือ Fast)",
  shortRule: "แท่งแดงแรก (Fast EMA < Slow EMA และราคาอยู่ใต้ Fast)",
  minBars: 27,
  params: [
    { key: "fastPeriod", label: "Fast EMA", hint: "ค่ามาตรฐาน 12", default: 12, min: 2, max: 100, step: 1 },
    { key: "slowPeriod", label: "Slow EMA", hint: "ค่ามาตรฐาน 26", default: 26, min: 3, max: 300, step: 1 },
  ],
  compute: (b, p) => cdcActionZone(b.close, p.fastPeriod, p.slowPeriod, 1),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Fast EMA", color: COLORS.blue, values: r.fastMA },
      { kind: "line", title: "Slow EMA", color: COLORS.amber, values: r.slowMA },
    ],
    barColors: r.zone.map((z) => (z ? ZONE_COLORS[z] ?? null : null)),
  }),
});

import { defineIndicator } from "../types";
import { supertrend } from "@/lib/indicators";
import { fromBuySell, maskSeries, COLORS } from "../math";

export default defineIndicator({
  id: "supertrend",
  name: "Supertrend",
  category: "trend",
  longRule: "เทรนด์เปลี่ยนเป็นขาขึ้น (ราคาปิดเหนือเส้น Supertrend)",
  shortRule: "เทรนด์เปลี่ยนเป็นขาลง (ราคาปิดใต้เส้น Supertrend)",
  minBars: 15,
  params: [
    { key: "atrPeriod", label: "ATR Period", hint: "ค่าทั่วไป 10", default: 10, min: 2, max: 100, step: 1 },
    { key: "multiplier", label: "ATR Multiplier", hint: "มาก=กรองสัญญาณหลอก", default: 3, min: 0.5, max: 10, step: 0.1 },
  ],
  compute: (b, p) => supertrend(b.klines, p.atrPeriod, p.multiplier),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Supertrend ↑", color: COLORS.up, width: 2, values: maskSeries(r.supertrend, (i) => r.trend[i] === 1) },
      { kind: "line", title: "Supertrend ↓", color: COLORS.down, width: 2, values: maskSeries(r.supertrend, (i) => r.trend[i] === -1) },
    ],
  }),
});

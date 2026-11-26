import { defineIndicator } from "../types";
import { cmMacdUltMTF } from "@/lib/indicators";
import { fromBuySell, COLORS } from "../math";

const HIST: Record<string, string> = { aqua: "#22d3ee", blue: "#3b82f6", red: "#ef4444", maroon: "#7f1d1d" };

export default defineIndicator({
  id: "cm_macd",
  name: "CM MacD Ultimate MTF",
  category: "momentum",
  longRule: "MACD ตัดขึ้นเหนือเส้น Signal",
  shortRule: "MACD ตัดลงใต้เส้น Signal",
  minBars: 35,
  params: [
    { key: "fastLength", label: "Fast EMA", hint: "6-21 — น้อย=ไว", default: 12, min: 2, max: 100, step: 1 },
    { key: "slowLength", label: "Slow EMA", hint: "15-50", default: 26, min: 3, max: 200, step: 1 },
    { key: "signalLength", label: "Signal SMA", hint: "3-20 — มาก=กรอง noise", default: 9, min: 2, max: 50, step: 1 },
  ],
  compute: (b, p) => cmMacdUltMTF(b.close, p.fastLength, p.slowLength, p.signalLength),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    panes: [{
      title: "MACD",
      series: [
        { kind: "histogram", title: "Histogram", color: COLORS.grey, values: r.histogram, colors: r.histColor.map((c) => (c ? HIST[c] : null)) },
        { kind: "line", title: "MACD", color: COLORS.blue, values: r.macdLine },
        { kind: "line", title: "Signal", color: COLORS.orange, values: r.signalLine },
      ],
      levels: [{ value: 0, color: "rgba(127,127,127,0.3)" }],
    }],
  }),
});

import { defineIndicator } from "../types";
import { trendlinesWithBreaks } from "@/lib/indicators";
import { fromBuySell } from "../math";

export default defineIndicator({
  id: "trendlines",
  name: "Trendlines with Breaks [LuxAlgo]",
  category: "structure",
  longRule: "ราคาทะลุเส้นเทรนด์ขาลง (แนวต้าน)",
  shortRule: "ราคาหลุดเส้นเทรนด์ขาขึ้น (แนวรับ)",
  minBars: 30,
  params: [
    { key: "trendLength", label: "Swing Lookback", default: 14, min: 2, max: 100, step: 1 },
    { key: "trendMult", label: "Slope Mult", default: 1, min: 0, max: 5, step: 0.1 },
  ],
  compute: (b, p) => trendlinesWithBreaks(b.klines, p.trendLength, p.trendMult, "Atr"),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Upper", color: "rgba(239,68,68,0.7)", style: 2, values: r.upper.map((v) => (v !== null && v > 0 ? v : null)) },
      { kind: "line", title: "Lower", color: "rgba(20,184,166,0.7)", style: 2, values: r.lower.map((v) => (v !== null && v > 0 ? v : null)) },
    ],
  }),
});

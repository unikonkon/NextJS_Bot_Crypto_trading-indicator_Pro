import { defineIndicator } from "../types";
import { utBot } from "@/lib/indicators";
import { fromBuySell, maskSeries, COLORS } from "../math";

export default defineIndicator({
  id: "ut_bot",
  name: "UT Bot Alerts",
  category: "trend",
  longRule: "ราคาข้ามขึ้นเหนือ ATR Trailing Stop",
  shortRule: "ราคาข้ามลงใต้ ATR Trailing Stop",
  minBars: 15,
  params: [
    { key: "keyValue", label: "Key Value", hint: "ความไว — มาก=สัญญาณน้อยลง", default: 1, min: 0.1, max: 10, step: 0.1 },
    { key: "utAtrPeriod", label: "ATR Period", default: 10, min: 1, max: 100, step: 1 },
  ],
  compute: (b, p) => utBot(b.klines, p.keyValue, p.utAtrPeriod),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Trail ↑", color: COLORS.up, values: maskSeries(r.trailingStop, (i) => r.pos[i] !== -1) },
      { kind: "line", title: "Trail ↓", color: COLORS.down, values: maskSeries(r.trailingStop, (i) => r.pos[i] === -1) },
    ],
  }),
});

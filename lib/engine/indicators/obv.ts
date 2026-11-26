import { defineIndicator } from "../types";
import { obv } from "@/lib/indicators";
import { emaN, crossSignals, COLORS } from "../math";

export default defineIndicator({
  id: "obv_trend",
  name: "OBV Trend",
  category: "volume",
  longRule: "OBV ตัดขึ้นเหนือเส้น EMA ของตัวเอง (แรงซื้อเข้า)",
  shortRule: "OBV ตัดลงใต้เส้น EMA ของตัวเอง (แรงขายออก)",
  minBars: 25,
  params: [
    { key: "length", label: "Signal EMA", default: 20, min: 2, max: 200, step: 1 },
  ],
  compute: (b, p) => {
    const line = obv(b.klines);
    return { line, signal: emaN(line, p.length) };
  },
  signals: (r) => crossSignals(r.line, r.signal),
  plot: (r) => ({
    panes: [{
      title: "OBV",
      series: [
        { kind: "line", title: "OBV", color: COLORS.cyan, values: r.line },
        { kind: "line", title: "EMA", color: COLORS.orange, values: r.signal },
      ],
    }],
  }),
});

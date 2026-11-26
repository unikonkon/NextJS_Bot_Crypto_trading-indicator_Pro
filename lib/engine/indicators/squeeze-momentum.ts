import { defineIndicator } from "../types";
import { squeezeMomentum } from "@/lib/indicators";
import { fromBuySell, COLORS } from "../math";

const HIST: Record<string, string> = { lime: "#84cc16", green: "#166534", red: "#ef4444", maroon: "#7f1d1d" };

export default defineIndicator({
  id: "squeeze_momentum",
  name: "Squeeze Momentum [LazyBear]",
  category: "volatility",
  longRule: "โมเมนตัมข้ามขึ้นเหนือ 0",
  shortRule: "โมเมนตัมข้ามลงใต้ 0",
  minBars: 25,
  params: [
    { key: "bbLength", label: "BB Length", default: 20, min: 5, max: 100, step: 1 },
    { key: "bbMult", label: "BB MultFactor", default: 2, min: 0.5, max: 5, step: 0.1 },
    { key: "kcLength", label: "KC Length", default: 20, min: 5, max: 100, step: 1 },
    { key: "kcMult", label: "KC MultFactor", default: 1.5, min: 0.5, max: 5, step: 0.1 },
  ],
  compute: (b, p) => squeezeMomentum(b.klines, p.bbLength, p.bbMult, p.kcLength, p.kcMult),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    panes: [{
      title: "Squeeze Momentum",
      series: [
        { kind: "histogram", title: "Momentum", color: COLORS.grey, values: r.value, colors: r.histColor.map((c) => (c ? HIST[c] : null)) },
        {
          kind: "line", title: "Squeeze", color: COLORS.grey, width: 2,
          values: r.value.map((v) => (v === null ? null : 0)),
          // squeeze on = amber, released = grey, no squeeze = blue
          colors: r.sqzOn.map((on, i) => (on ? COLORS.amber : r.noSqz[i] ? COLORS.blue : "#9ca3af")),
        },
      ],
    }],
  }),
});

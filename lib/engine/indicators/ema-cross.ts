import { defineIndicator } from "../types";
import { ema, crossSignals, COLORS } from "../math";

export default defineIndicator({
  id: "ema_cross",
  name: "EMA Cross",
  category: "trend",
  longRule: "EMA เร็ว ตัดขึ้นเหนือ EMA ช้า (Golden Cross)",
  shortRule: "EMA เร็ว ตัดลงใต้ EMA ช้า (Death Cross)",
  minBars: 30,
  params: [
    { key: "fast", label: "Fast EMA", default: 9, min: 2, max: 200, step: 1 },
    { key: "slow", label: "Slow EMA", default: 21, min: 3, max: 400, step: 1 },
  ],
  compute: (b, p) => ({ fast: ema(b.close, p.fast), slow: ema(b.close, p.slow) }),
  signals: (r) => crossSignals(r.fast, r.slow),
  plot: (r, _b, p) => ({
    overlays: [
      { kind: "line", title: `EMA ${p.fast}`, color: COLORS.blue, values: r.fast },
      { kind: "line", title: `EMA ${p.slow}`, color: COLORS.amber, values: r.slow },
    ],
  }),
});

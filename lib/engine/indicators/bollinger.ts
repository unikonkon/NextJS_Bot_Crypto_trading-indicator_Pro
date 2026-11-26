import { defineIndicator } from "../types";
import { sma, stdev, COLORS } from "../math";

export default defineIndicator({
  id: "bollinger_reversion",
  name: "Bollinger Bands Reversion",
  category: "volatility",
  longRule: "ราคาปิดกลับขึ้นเหนือ Lower Band",
  shortRule: "ราคาปิดกลับลงใต้ Upper Band",
  minBars: 25,
  params: [
    { key: "length", label: "Length", default: 20, min: 5, max: 200, step: 1 },
    { key: "mult", label: "StdDev Mult", default: 2, min: 0.5, max: 5, step: 0.1 },
  ],
  compute: (b, p) => {
    const basis = sma(b.close, p.length);
    const dev = stdev(b.close, p.length);
    const upper = basis.map((m, i) => (m === null || dev[i] === null ? null : m + p.mult * (dev[i] as number)));
    const lower = basis.map((m, i) => (m === null || dev[i] === null ? null : m - p.mult * (dev[i] as number)));
    return { basis, upper, lower };
  },
  signals: (r, b) => {
    const out = new Int8Array(b.length);
    const c = b.close;
    for (let i = 1; i < b.length; i++) {
      const lo0 = r.lower[i - 1], lo1 = r.lower[i], up0 = r.upper[i - 1], up1 = r.upper[i];
      if (lo0 === null || lo1 === null || up0 === null || up1 === null) continue;
      if (c[i - 1] <= lo0 && c[i] > lo1) out[i] = 1;
      else if (c[i - 1] >= up0 && c[i] < up1) out[i] = -1;
    }
    return out;
  },
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Upper", color: "rgba(59,130,246,0.6)", values: r.upper },
      { kind: "line", title: "Basis", color: COLORS.amber, style: 2, values: r.basis },
      { kind: "line", title: "Lower", color: "rgba(59,130,246,0.6)", values: r.lower },
    ],
  }),
});

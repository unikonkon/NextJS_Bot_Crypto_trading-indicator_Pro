import { defineIndicator } from "../types";
import { highest, lowest, smaN, COLORS, type NumSeries } from "../math";

export default defineIndicator({
  id: "stochastic",
  name: "Stochastic %K/%D",
  category: "momentum",
  longRule: "%K ตัดขึ้นเหนือ %D ในโซน Oversold",
  shortRule: "%K ตัดลงใต้ %D ในโซน Overbought",
  minBars: 20,
  params: [
    { key: "kLength", label: "%K Length", default: 14, min: 2, max: 100, step: 1 },
    { key: "kSmooth", label: "%K Smooth", default: 3, min: 1, max: 20, step: 1 },
    { key: "dSmooth", label: "%D Smooth", default: 3, min: 1, max: 20, step: 1 },
    { key: "oversold", label: "Oversold <", default: 20, min: 1, max: 50, step: 1 },
    { key: "overbought", label: "Overbought >", default: 80, min: 50, max: 99, step: 1 },
  ],
  compute: (b, p) => {
    const hh = highest(b.high, p.kLength);
    const ll = lowest(b.low, p.kLength);
    const raw: NumSeries = b.close.map((c, i) => {
      const h = hh[i], l = ll[i];
      if (h === null || l === null) return null;
      return h === l ? 50 : ((c - l) / (h - l)) * 100;
    });
    const k = smaN(raw, p.kSmooth);
    const d = smaN(k, p.dSmooth);
    return { k, d };
  },
  signals: (r, b, p) => {
    const out = new Int8Array(b.length);
    for (let i = 1; i < b.length; i++) {
      const k0 = r.k[i - 1], k1 = r.k[i], d0 = r.d[i - 1], d1 = r.d[i];
      if (k0 === null || k1 === null || d0 === null || d1 === null) continue;
      if (k0 <= d0 && k1 > d1 && Math.min(k0, k1) < p.oversold) out[i] = 1;
      else if (k0 >= d0 && k1 < d1 && Math.max(k0, k1) > p.overbought) out[i] = -1;
    }
    return out;
  },
  plot: (r, _b, p) => ({
    panes: [{
      title: "Stochastic",
      series: [
        { kind: "line", title: "%K", color: COLORS.blue, values: r.k },
        { kind: "line", title: "%D", color: COLORS.orange, values: r.d },
      ],
      levels: [
        { value: p.overbought, color: "rgba(239,68,68,0.45)" },
        { value: p.oversold, color: "rgba(16,185,129,0.45)" },
      ],
    }],
  }),
});

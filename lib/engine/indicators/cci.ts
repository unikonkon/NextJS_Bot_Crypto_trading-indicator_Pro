import { defineIndicator } from "../types";
import { COLORS, type NumSeries } from "../math";

export default defineIndicator({
  id: "cci",
  name: "CCI Reversal",
  category: "momentum",
  longRule: "CCI ข้ามกลับขึ้นเหนือ −เกณฑ์ (ออกจากโซน Oversold)",
  shortRule: "CCI ข้ามกลับลงใต้ +เกณฑ์ (ออกจากโซน Overbought)",
  minBars: 25,
  params: [
    { key: "length", label: "Length", default: 20, min: 5, max: 200, step: 1 },
    { key: "level", label: "เกณฑ์ ±", default: 100, min: 50, max: 300, step: 10 },
  ],
  compute: (b, p) => {
    const n = b.length;
    const tp = b.close.map((c, i) => (b.high[i] + b.low[i] + c) / 3);
    const cci: NumSeries = new Array(n).fill(null);
    for (let i = p.length - 1; i < n; i++) {
      let sum = 0;
      for (let j = i - p.length + 1; j <= i; j++) sum += tp[j];
      const mean = sum / p.length;
      let md = 0;
      for (let j = i - p.length + 1; j <= i; j++) md += Math.abs(tp[j] - mean);
      md /= p.length;
      cci[i] = md === 0 ? 0 : (tp[i] - mean) / (0.015 * md);
    }
    return cci;
  },
  signals: (r, b, p) => {
    const out = new Int8Array(b.length);
    for (let i = 1; i < b.length; i++) {
      const a = r[i - 1], c = r[i];
      if (a === null || c === null) continue;
      if (a <= -p.level && c > -p.level) out[i] = 1;
      else if (a >= p.level && c < p.level) out[i] = -1;
    }
    return out;
  },
  plot: (r, _b, p) => ({
    panes: [{
      title: `CCI ${p.length}`,
      series: [{ kind: "line", title: "CCI", color: COLORS.cyan, values: r }],
      levels: [
        { value: p.level, color: "rgba(239,68,68,0.45)" },
        { value: 0, color: "rgba(127,127,127,0.25)" },
        { value: -p.level, color: "rgba(16,185,129,0.45)" },
      ],
    }],
  }),
});

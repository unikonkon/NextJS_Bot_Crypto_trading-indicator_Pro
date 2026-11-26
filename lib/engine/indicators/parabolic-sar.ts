import { defineIndicator } from "../types";
import { maskSeries, COLORS, type NumSeries } from "../math";

export default defineIndicator({
  id: "parabolic_sar",
  name: "Parabolic SAR",
  category: "trend",
  longRule: "SAR พลิกมาอยู่ใต้ราคา",
  shortRule: "SAR พลิกมาอยู่เหนือราคา",
  minBars: 5,
  params: [
    { key: "start", label: "Start AF", default: 0.02, min: 0.001, max: 0.2, step: 0.001 },
    { key: "increment", label: "Increment", default: 0.02, min: 0.001, max: 0.2, step: 0.001 },
    { key: "maximum", label: "Max AF", default: 0.2, min: 0.01, max: 1, step: 0.01 },
  ],
  compute: (b, p) => {
    const n = b.length;
    const sar: NumSeries = new Array(n).fill(null);
    const trend: (1 | -1 | 0)[] = new Array(n).fill(0);
    const flip = new Int8Array(n);
    if (n < 2) return { sar, trend, flip };
    const { high: h, low: l } = b;
    let isLong = b.close[1] >= b.close[0];
    let af = p.start;
    let ep = isLong ? h[0] : l[0];
    let s = isLong ? l[0] : h[0];
    for (let i = 1; i < n; i++) {
      s = s + af * (ep - s);
      if (isLong) {
        s = Math.min(s, l[i - 1], i >= 2 ? l[i - 2] : l[i - 1]);
        if (l[i] < s) {
          isLong = false; s = ep; ep = l[i]; af = p.start; flip[i] = -1;
        } else if (h[i] > ep) {
          ep = h[i]; af = Math.min(af + p.increment, p.maximum);
        }
      } else {
        s = Math.max(s, h[i - 1], i >= 2 ? h[i - 2] : h[i - 1]);
        if (h[i] > s) {
          isLong = true; s = ep; ep = h[i]; af = p.start; flip[i] = 1;
        } else if (l[i] < ep) {
          ep = l[i]; af = Math.min(af + p.increment, p.maximum);
        }
      }
      sar[i] = s;
      trend[i] = isLong ? 1 : -1;
    }
    return { sar, trend, flip };
  },
  signals: (r) => r.flip,
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "SAR ↑", color: COLORS.up, points: true, values: maskSeries(r.sar, (i) => r.trend[i] === 1) },
      { kind: "line", title: "SAR ↓", color: COLORS.down, points: true, values: maskSeries(r.sar, (i) => r.trend[i] === -1) },
    ],
  }),
});

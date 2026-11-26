import { defineIndicator } from "../types";
import { highest, lowest, COLORS } from "../math";

export default defineIndicator({
  id: "donchian_breakout",
  name: "Donchian Breakout (Turtle)",
  category: "trend",
  longRule: "ราคาปิดทะลุ High สูงสุดของ N แท่งก่อนหน้า",
  shortRule: "ราคาปิดหลุด Low ต่ำสุดของ N แท่งก่อนหน้า",
  minBars: 25,
  params: [
    { key: "length", label: "Channel Length", hint: "Turtle ดั้งเดิมใช้ 20 / 55", default: 20, min: 2, max: 300, step: 1 },
  ],
  compute: (b, p) => {
    const hh = highest(b.high, p.length);
    const ll = lowest(b.low, p.length);
    // Channel of the *previous* N bars so the breakout bar itself is not included
    const upper = [null, ...hh.slice(0, -1)];
    const lower = [null, ...ll.slice(0, -1)];
    return { upper, lower };
  },
  signals: (r, b) => {
    const out = new Int8Array(b.length);
    for (let i = 1; i < b.length; i++) {
      const u = r.upper[i], l = r.lower[i], u0 = r.upper[i - 1], l0 = r.lower[i - 1];
      if (u === null || l === null) continue;
      const wasAbove = u0 !== null && b.close[i - 1] > u0;
      const wasBelow = l0 !== null && b.close[i - 1] < l0;
      if (b.close[i] > u && !wasAbove) out[i] = 1;
      else if (b.close[i] < l && !wasBelow) out[i] = -1;
    }
    return out;
  },
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Upper", color: COLORS.up, values: r.upper },
      { kind: "line", title: "Lower", color: COLORS.down, values: r.lower },
    ],
  }),
});

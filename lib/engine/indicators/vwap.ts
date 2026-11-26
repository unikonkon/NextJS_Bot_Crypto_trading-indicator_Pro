import { defineIndicator } from "../types";
import { crossSignals, COLORS, type NumSeries } from "../math";

export default defineIndicator({
  id: "vwap_cross",
  name: "Rolling VWAP Cross",
  category: "volume",
  longRule: "ราคาปิดตัดขึ้นเหนือ VWAP",
  shortRule: "ราคาปิดตัดลงใต้ VWAP",
  minBars: 25,
  params: [
    { key: "length", label: "VWAP Window", hint: "จำนวนแท่งที่ใช้เฉลี่ย", default: 50, min: 5, max: 500, step: 1 },
  ],
  compute: (b, p) => {
    const n = b.length;
    const out: NumSeries = new Array(n).fill(null);
    let pv = 0, vol = 0;
    for (let i = 0; i < n; i++) {
      const tp = (b.high[i] + b.low[i] + b.close[i]) / 3;
      pv += tp * b.volume[i];
      vol += b.volume[i];
      if (i >= p.length) {
        const j = i - p.length;
        pv -= ((b.high[j] + b.low[j] + b.close[j]) / 3) * b.volume[j];
        vol -= b.volume[j];
      }
      if (i >= p.length - 1) out[i] = vol > 0 ? pv / vol : tp;
    }
    return out;
  },
  signals: (r, b) => crossSignals(b.close, r),
  plot: (r) => ({
    overlays: [{ kind: "line", title: "VWAP", color: COLORS.purple, width: 2, values: r }],
  }),
});

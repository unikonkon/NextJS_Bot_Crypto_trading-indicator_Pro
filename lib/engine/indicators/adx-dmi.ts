import { defineIndicator } from "../types";
import { rma, COLORS, type NumSeries } from "../math";

export default defineIndicator({
  id: "adx_dmi",
  name: "ADX / DMI",
  category: "trend",
  longRule: "+DI ตัดขึ้นเหนือ −DI ขณะ ADX > เกณฑ์ (เทรนด์แข็งแรง)",
  shortRule: "−DI ตัดขึ้นเหนือ +DI ขณะ ADX > เกณฑ์",
  minBars: 30,
  params: [
    { key: "length", label: "DI Length", default: 14, min: 2, max: 100, step: 1 },
    { key: "adxSmooth", label: "ADX Smoothing", default: 14, min: 2, max: 100, step: 1 },
    { key: "threshold", label: "ADX >", hint: "ต่ำกว่านี้ถือว่าไม่มีเทรนด์", default: 20, min: 0, max: 60, step: 1 },
  ],
  compute: (b, p) => {
    const n = b.length;
    const { high: h, low: l, close: c } = b;
    const tr: NumSeries = new Array(n).fill(null);
    const plusDM: NumSeries = new Array(n).fill(null);
    const minusDM: NumSeries = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1];
      const down = l[i - 1] - l[i];
      plusDM[i] = up > down && up > 0 ? up : 0;
      minusDM[i] = down > up && down > 0 ? down : 0;
      tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    const trS = rma(tr, p.length);
    const pS = rma(plusDM, p.length);
    const mS = rma(minusDM, p.length);
    const plusDI: NumSeries = trS.map((t, i) => (t === null || t === 0 || pS[i] === null ? null : (100 * (pS[i] as number)) / t));
    const minusDI: NumSeries = trS.map((t, i) => (t === null || t === 0 || mS[i] === null ? null : (100 * (mS[i] as number)) / t));
    const dx: NumSeries = plusDI.map((pd, i) => {
      const md = minusDI[i];
      if (pd === null || md === null) return null;
      const sum = pd + md;
      return sum === 0 ? 0 : (100 * Math.abs(pd - md)) / sum;
    });
    const adx = rma(dx, p.adxSmooth);
    return { plusDI, minusDI, adx };
  },
  signals: (r, b, p) => {
    const out = new Int8Array(b.length);
    for (let i = 1; i < b.length; i++) {
      const p0 = r.plusDI[i - 1], p1 = r.plusDI[i], m0 = r.minusDI[i - 1], m1 = r.minusDI[i], a = r.adx[i];
      if (p0 === null || p1 === null || m0 === null || m1 === null || a === null || a < p.threshold) continue;
      if (p0 <= m0 && p1 > m1) out[i] = 1;
      else if (m0 <= p0 && m1 > p1) out[i] = -1;
    }
    return out;
  },
  plot: (r, _b, p) => ({
    panes: [{
      title: "ADX / DMI",
      series: [
        { kind: "line", title: "+DI", color: COLORS.up, values: r.plusDI },
        { kind: "line", title: "−DI", color: COLORS.down, values: r.minusDI },
        { kind: "line", title: "ADX", color: COLORS.amber, width: 2, values: r.adx },
      ],
      levels: [{ value: p.threshold, color: "rgba(127,127,127,0.35)" }],
    }],
  }),
});

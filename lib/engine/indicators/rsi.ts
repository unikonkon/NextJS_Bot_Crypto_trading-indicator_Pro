import { defineIndicator } from "../types";
import { rsi, COLORS } from "../math";

export default defineIndicator({
  id: "rsi",
  name: "RSI Overbought/Oversold",
  category: "momentum",
  longRule: "RSI ต่ำกว่าเส้น Oversold",
  shortRule: "RSI สูงกว่าเส้น Overbought",
  minBars: 15,
  params: [
    { key: "period", label: "RSI Period", hint: "ค่าทั่วไป 7, 14, 21", default: 14, min: 2, max: 100, step: 1 },
    { key: "buyThreshold", label: "Oversold <", hint: "ต่ำกว่านี้ = สัญญาณขาขึ้น", default: 30, min: 1, max: 50, step: 1 },
    { key: "sellThreshold", label: "Overbought >", hint: "สูงกว่านี้ = สัญญาณขาลง", default: 70, min: 50, max: 99, step: 1 },
  ],
  compute: (b, p) => rsi(b.close, p.period),
  signals: (r, _b, p) => {
    const out = new Int8Array(r.length);
    for (let i = 0; i < r.length; i++) {
      const v = r[i];
      if (v === null) continue;
      if (v < p.buyThreshold) out[i] = 1;
      else if (v > p.sellThreshold) out[i] = -1;
    }
    return out;
  },
  plot: (r, _b, p) => ({
    panes: [{
      title: `RSI ${p.period}`,
      series: [{ kind: "line", title: "RSI", color: COLORS.violet, values: r, width: 2 }],
      levels: [
        { value: p.sellThreshold, color: "rgba(239,68,68,0.45)" },
        { value: 50, color: "rgba(127,127,127,0.25)" },
        { value: p.buyThreshold, color: "rgba(16,185,129,0.45)" },
      ],
    }],
  }),
});

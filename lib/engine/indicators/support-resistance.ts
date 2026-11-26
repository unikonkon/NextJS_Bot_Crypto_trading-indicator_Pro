import { defineIndicator } from "../types";
import { supportResistance } from "@/lib/indicators";
import { fromBuySell, COLORS } from "../math";

export default defineIndicator({
  id: "support_resistance",
  name: "Support & Resistance Breaks",
  category: "structure",
  longRule: "ทะลุแนวต้าน พร้อม Volume ยืนยัน",
  shortRule: "หลุดแนวรับ พร้อม Volume ยืนยัน",
  minBars: 35,
  params: [
    { key: "leftBars", label: "Left Bars", default: 15, min: 2, max: 100, step: 1 },
    { key: "rightBars", label: "Right Bars", default: 15, min: 2, max: 100, step: 1 },
    { key: "volumeThresh", label: "Volume Threshold", hint: "% ของ Volume oscillator", default: 20, min: 0, max: 100, step: 1 },
  ],
  compute: (b, p) => supportResistance(b.klines, p.leftBars, p.rightBars, p.volumeThresh),
  signals: (r) => fromBuySell(r.signal),
  plot: (r) => ({
    overlays: [
      { kind: "line", title: "Resistance", color: COLORS.down, width: 2, values: r.resistance },
      { kind: "line", title: "Support", color: COLORS.blue, width: 2, values: r.support },
    ],
  }),
});

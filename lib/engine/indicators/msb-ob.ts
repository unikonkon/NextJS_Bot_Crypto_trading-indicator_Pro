import { defineIndicator, type SegmentPlot, type MarkerPlot } from "../types";
import { msbOrderBlock } from "@/lib/indicators";
import { fromBuySell, COLORS } from "../math";

export default defineIndicator({
  id: "msb_ob",
  name: "Market Structure Break & OB",
  category: "structure",
  longRule: "Bullish MSB พร้อม Order Block",
  shortRule: "Bearish MSB พร้อม Order Block",
  minBars: 30,
  params: [
    { key: "zigzagLen", label: "ZigZag Length", default: 9, min: 2, max: 50, step: 1 },
    { key: "fibFactor", label: "Fib Factor", default: 0.33, min: 0, max: 1, step: 0.01 },
  ],
  compute: (b, p) => msbOrderBlock(b.klines, p.zigzagLen, p.fibFactor),
  signals: (r) => fromBuySell(r.signal),
  plot: (r, b, _p, ctx) => {
    const last = b.length - 1;
    // ZigZag line: one value per swing index, gaps elsewhere
    const zz: (number | null)[] = new Array(b.length).fill(null);
    for (const sp of r.swingPoints) if (sp.index >= 0 && sp.index <= last) zz[sp.index] = sp.price;
    const segments: SegmentPlot[] = [];
    const markers: MarkerPlot[] = [];
    for (const s of r.msbSignals.slice(-40)) {
      if (s.index < 0 || s.index >= last) continue;
      const color = s.bias === "bullish" ? COLORS.up : COLORS.down;
      segments.push({ from: s.index, to: Math.min(s.index + 30, last), value: s.level, color, width: 2 });
      markers.push({ index: s.index, position: s.bias === "bullish" ? "belowBar" : "aboveBar", color, shape: s.bias === "bullish" ? "arrowUp" : "arrowDown", text: "MSB" });
    }
    for (const ob of r.orderBlocks.filter((o) => !o.broken).slice(-10)) {
      if (ob.startIndex < 0 || ob.startIndex >= last) continue;
      const color = ob.type.startsWith("Bu") ? COLORS.upSoft : COLORS.downSoft;
      segments.push({ from: ob.startIndex, to: last, value: ob.high, color }, { from: ob.startIndex, to: last, value: ob.low, color });
    }
    return {
      overlays: [{ kind: "line", title: "ZigZag", color: ctx.dark ? "rgba(148,163,184,0.6)" : "rgba(100,116,139,0.6)", values: zz, connectGaps: true }],
      segments,
      markers,
    };
  },
});

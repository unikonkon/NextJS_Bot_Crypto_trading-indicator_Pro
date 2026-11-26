import { defineIndicator, type SegmentPlot, type MarkerPlot } from "../types";
import { smartMoneyConcepts } from "@/lib/indicators";
import { fromBuySell, COLORS } from "../math";

export default defineIndicator({
  id: "smc",
  name: "Smart Money Concepts (SMC)",
  category: "structure",
  longRule: "CHoCH/BOS ขาขึ้น ในโซนส่วนลด (Discount)",
  shortRule: "CHoCH/BOS ขาลง ในโซนพรีเมียม (Premium)",
  minBars: 100,
  params: [
    { key: "swingSize", label: "Swing Size", hint: "10-100 — น้อย=ไว มาก=จับเทรนด์ใหญ่", default: 50, min: 5, max: 200, step: 1 },
    { key: "internalSize", label: "Internal Size", hint: "2-15 — น้อย=สัญญาณเยอะ มาก=กรอง noise", default: 5, min: 2, max: 30, step: 1 },
  ],
  compute: (b, p) => smartMoneyConcepts(b.klines, p.swingSize, p.internalSize),
  signals: (r) => fromBuySell(r.signal),
  plot: (r, b) => {
    const last = b.length - 1;
    const segments: SegmentPlot[] = [];
    const markers: MarkerPlot[] = [];
    const structures = [...r.internalStructures, ...r.swingStructures].slice(-60);
    for (const s of structures) {
      if (s.pivotIndex < 0 || s.index > last || s.pivotIndex >= s.index) continue;
      const color = s.bias === "bullish" ? COLORS.up : COLORS.down;
      segments.push({ from: s.pivotIndex, to: s.index, value: s.level, color, width: s.type === "BOS" ? 1 : 2, style: s.type === "BOS" ? 0 : 2 });
      markers.push({ index: s.index, position: s.bias === "bullish" ? "belowBar" : "aboveBar", color, shape: s.bias === "bullish" ? "arrowUp" : "arrowDown", text: s.type });
    }
    for (const ob of r.internalOrderBlocks.filter((o) => !o.mitigated).slice(-10)) {
      const color = ob.bias === "bullish" ? COLORS.upSoft : COLORS.downSoft;
      segments.push({ from: ob.startIndex, to: last, value: ob.high, color }, { from: ob.startIndex, to: last, value: ob.low, color });
    }
    for (const ob of r.swingOrderBlocks.filter((o) => !o.mitigated).slice(-5)) {
      const color = ob.bias === "bullish" ? "rgba(49,121,245,0.4)" : "rgba(178,40,51,0.4)";
      segments.push({ from: ob.startIndex, to: last, value: ob.high, color, width: 2 }, { from: ob.startIndex, to: last, value: ob.low, color, width: 2 });
    }
    return { segments, markers };
  },
});

/**
 * Pennant Triangle [1h] (Craig Percoco) — lib/indicators-pennant.ts on the exposure engine.
 * Pine keeps a Long book and a Short book side by side; here each book is its own strategy id
 * so both show up (and can be ranked) separately, matching the Long / Short columns of the Pine table.
 * Entries and rule exits fill at the signal bar's close and SL / target inside the bar, as in Pine.
 */
import {
  PENNANT_EXIT,
  PENNANT_EXIT_LABELS,
  PENNANT_FILTER_LABELS,
  PENNANT_LONG_DEFAULTS,
  PENNANT_SHORT_DEFAULTS,
  PENNANT_SL_LABELS,
  pennantStrategy,
  pennantWarmupBars,
  validatePennant,
  type PennantResult,
} from "@/lib/indicators-pennant";
import { defineIndicator, type IndicatorDef, type MarkerPlot, type ParamDef, type SegmentPlot } from "../types";
import { levelLines, mergePlots } from "./legacy-plot";

const UP = "#089981";
const DOWN = "#F23645";

function params(side: 1 | -1): ParamDef[] {
  const d = side > 0 ? PENNANT_LONG_DEFAULTS : PENNANT_SHORT_DEFAULTS;
  const sw = side > 0 ? "Sweep Low → CHoCH" : "Sweep High → CHoCH";
  const sweepIf = { key: "sweep", value: 1 };
  return [
    { key: "filter", label: "ตัวกรองทิศ", hint: side > 0 ? "แท่ง 1D / 4h ที่ปิดแล้ว · 1D เหนือ EMA50 ดีสุด" : "Short: 1D MACD และ Signal < 0 ดีสุด", default: d.filter, min: 0, max: 4, step: 1, options: PENNANT_FILTER_LABELS },
    { key: "sl", label: "SL (ไม้จากธง)", default: d.sl, min: 0, max: 3, step: 1, options: PENNANT_SL_LABELS },
    { key: "exit", label: "ออก (ไม้จากธง)", hint: side > 0 ? "ทิศเสีย = ถือจนตัวกรองไม่ผ่าน · ดีกว่าเป้าทุกแบบ" : "Short: เป้า 2R ดีสุด · ถือจนทิศเสียแย่สุด", default: d.exit, min: 0, max: 3, step: 1, options: PENNANT_EXIT_LABELS },
    { key: "poleLen", label: "ช่วงวัดเสาธง (แท่ง)", hint: side > 0 ? "ทดสอบ 6–48 → 24" : undefined, default: d.poleLen, min: 1, max: 200, step: 1 },
    { key: "maxAge", label: "อายุธงสูงสุด (แท่ง)", hint: side > 0 ? "ทดสอบ 30/60/100/150 → 60" : undefined, default: d.maxAge, min: 5, max: 400, step: 1 },
    { key: "apex", label: "ต้องทะลุก่อนถึง Apex (สัดส่วนทาง)", hint: "1.0 = ก่อนถึงจุดยอด", default: d.apex, min: 0.1, max: 1, step: 0.05 },
    { key: "pl", label: "Pivot (แท่งซ้าย/ขวา)", hint: "ทดสอบ 2/3/4 → 3", default: d.pl, min: 2, max: 10, step: 1 },
    { key: "poleK", label: "เสาธงขั้นต่ำ (× ATR14)", default: d.poleK, min: 0, max: 20, step: 0.5 },
    { key: "wMax", label: "ปากธงกว้างสุด (× เสาธง)", hint: "หลวมดีกว่า", default: d.wMax, min: 0.1, max: 10, step: 0.25 },
    { key: "minAge", label: "อายุธงขั้นต่ำ (แท่ง)", default: d.minAge, min: 1, max: 100, step: 1 },
    {
      key: "sweep", label: `เข้าเพิ่ม: ${sw}`, toggle: true, default: d.sweep, min: 0, max: 1, step: 1,
      hint: side > 0
        ? "Low ทะลุ Low ต่ำสุด N แท่ง แล้วภายใน K แท่ง แท่งเขียวปิดเหนือ High นับจากแท่งที่กวาด · SL = Low ที่กวาด − buf × ATR · ไม่ตั้งเป้า · ถือจนทิศเสีย"
        : "ต้นฉบับปิดไว้: ทดสอบกับ BTC ETH BNB SOL XRP แล้วขาดทุนทุกแบบ",
    },
    { key: "swN", label: "Sweep N (แท่ง)", default: d.swN, min: 2, max: 500, step: 1, visibleWhen: sweepIf },
    { key: "swK", label: "Sweep K (แท่ง)", default: d.swK, min: 1, max: 200, step: 1, visibleWhen: sweepIf },
    { key: "swBuf", label: "Sweep buf (× ATR)", default: d.swBuf, min: 0, max: 5, step: 0.25, visibleWhen: sweepIf },
  ];
}

function make(side: 1 | -1): IndicatorDef {
  const long = side > 0;
  return defineIndicator<PennantResult>({
    id: long ? "pennant_long" : "pennant_short",
    name: long ? "Pennant + Sweep (Long)" : "Pennant (Short)",
    category: "structure",
    source: "v6",
    description: long
      ? "ธงสามเหลี่ยมหลังเสาธง (Craig Percoco) บน 1h: เข้าเมื่อปิดทะลุเส้นบนธงขาขึ้น หรือ Sweep Low → CHoCH ขณะ 1D ปิดเหนือ EMA50 · SL ใต้ Swing ในธง · ถือจน 1D ปิดใต้ EMA50 · ต้นฉบับทดสอบบน 1h เท่านั้น"
      : "ธงสามเหลี่ยมขาลง (Craig Percoco) บน 1h: เข้าเมื่อปิดหลุดเส้นล่างธง ขณะ 1D MACD และ Signal < 0 · SL 2 ATR · เป้า 2R · ใช้ Futures · ต้นฉบับทดสอบบน 1h เท่านั้น",
    params: params(side),
    minBars: 100,
    warmupBars: (p, tf) => pennantWarmupBars(p, tf),
    validate: (p) => validatePennant(p),
    compute: (b, p, ctx) => pennantStrategy(b, side, p, ctx.startIndex),
    engine: () => ({ kind: "exposure", direction: long ? "long" : "short", fill: "close" }),
    signals: (r) => new Int8Array(r.exposure.length),
    exposure: (r) => ({ exposure: r.exposure, exitFill: r.exitFill }),
    reasons: (r) => r.reason,
    plot: (r, b, p) => {
      const col = long ? UP : DOWN;
      const segments: SegmentPlot[] = [];
      const markers: MarkerPlot[] = [];
      // Broken pennants (Pine keeps the last 40): breakout line + opposite line up to the break bar
      for (const f of r.breaks.slice(-40)) {
        segments.push({ from: f.p0, to: f.idx, value: f.v0, value2: f.v0 + f.mU * (f.idx - f.p0), color: col, width: 2 });
        segments.push({ from: f.r0, to: f.idx, value: f.w0, value2: f.w0 + f.mL * (f.idx - f.r0), color: col, width: 2 });
        if (!f.entered) markers.push({ index: f.idx, position: long ? "belowBar" : "aboveBar", color: col, shape: long ? "arrowUp" : "arrowDown", text: "ธง ✗" });
      }
      // Sweep entries: swept level (dotted orange) and CHoCH level (dashed)
      for (const s of r.sweeps.slice(-20)) {
        segments.push({ from: s.j0, to: s.idx, value: s.ext, color: "#f97316", style: 1, width: 2 });
        segments.push({ from: s.j0, to: s.idx, value: s.lvl, color: col, style: 2 });
      }
      // Pennant still forming at the last bar
      const f = r.forming;
      const last = b.length - 1;
      if (f && last > f.p0) {
        const c = long ? "#2962FF" : "#FF9800";
        segments.push({ from: f.p0, to: last, value: f.v0, value2: f.v0 + f.mU * (last - f.p0), color: c, width: 2 });
        if (last > f.r0) segments.push({ from: f.r0, to: last, value: f.w0, value2: f.w0 + f.mL * (last - f.r0), color: c, width: 2 });
      }
      const filterLine = Math.round(p.filter) === 0 ? "EMA50 1D" : "EMA200";
      return mergePlots(
        r.biasLine.some((v) => v !== null) ? { overlays: [{ kind: "line", title: filterLine, color: "#94a3b8", style: 2, values: r.biasLine }] } : {},
        { overlays: levelLines(r.stop, Math.round(p.exit) === PENNANT_EXIT.bias ? undefined : r.target) },
        { segments, markers },
      );
    },
  });
}

export const PENNANT_DEFS: IndicatorDef[] = [make(1), make(-1)];

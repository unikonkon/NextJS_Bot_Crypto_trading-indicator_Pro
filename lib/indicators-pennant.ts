/**
 * Pennant Triangle [1h] — ธงสามเหลี่ยมหลังเสาธง + Sweep → CHoCH (Craig Percoco) · เข้าตามทิศ 1D
 *
 * ที่มา: lib/ธงสามเหลี่ยม (Pennant) หลังเสาธง + Sweep → CHoCH (Craig Percoco).pine (Pine v6)
 * เลขบรรทัดในคอมเมนต์อ้างถึงไฟล์นั้น · แปลงส่วนที่กำหนดการเข้า-ออกทั้งหมดตรงตัว:
 *   • Pivot (136–165): ซ้ายต้องเกินทุกแท่ง (>=) · ขวาไม่เกิน (>) · ยืนยันเมื่อผ่านไป pl แท่ง
 *   • findPen (171–232): ยอดเสาธง = Pivot สุดขั้วในอายุธง → Pivot ล่าสุด · อีกเส้นจาก Pivot ฝั่งตรงข้าม
 *     ที่สุดขั้วหลังยอดเสาธง → Pivot ล่าสุด (ต้องยกตัว/กดตัว) · ห้ามแท่งปิดหลุดเส้น · เสาธง ≥ poleK × ATR
 *     · ปากธง ≤ wMax × เสาธง · เส้นบีบเข้า · ทะลุก่อนถึง apex × ทางไปจุดยอด · ธงหนึ่งใช้ครั้งเดียว
 *   • sweepCh (258–281): กวาด Low/High สุดขั้ว N แท่ง แล้วภายใน K แท่ง แท่งสีตามทิศปิดเลยระดับนับจากแท่งที่กวาด
 *   • ตัวกรองทิศ (116–131): request.security(…, lookahead_on) กับค่า [1] = แท่ง 1D / 4h ที่ปิดแล้ว
 *     ที่นี่สร้างแท่ง 1D / 4h จากแท่งของกราฟ (ราคาปิดตรงกับ Binance) แล้วใช้แท่งที่ปิดก่อนเวลาเปิดแท่งนี้
 *   • Book (344–464): ตรวจ SL → เป้า → กฎออก ก่อน แล้วค่อยเข้าที่ราคาปิด · ออกแท่งไหนไม่เข้าซ้ำแท่งนั้น
 *
 * Pine ถือ Long และ Short เป็นสองบัญชีแยกกันพร้อมกัน — ที่นี่หนึ่งการคำนวณ = หนึ่งฝั่ง (side)
 * ผลจึงเทียบได้กับคอลัมน์ Long / Short ของตาราง Pine ทีละคอลัมน์
 * ที่ไม่ได้แปลง: ตาราง, ป้าย, alert และเส้นวาด (ส่วนแสดงผล ไม่มีผลต่อการเข้า-ออก)
 */
import { atr as atrOf } from "@/lib/indicators";
import type { Bars } from "@/lib/engine/types";

type Series = (number | null)[];

// ══ 1) ค่าตั้งต้น ══════════════════════════════════════════════
/** ตัวเลือกของ Pine เก็บเป็นตัวเลข (พารามิเตอร์ของระบบเป็นตัวเลขทั้งหมด) */
export const PENNANT_FILTER = { d50: 0, dMacd: 1, dMacd4h: 2, ema200: 3, none: 4 } as const;
export const PENNANT_SL = { swing: 0, line: 1, atr2: 2, none: 3 } as const;
export const PENNANT_EXIT = { bias: 0, r2: 1, pole: 2, atrTrail: 3 } as const;

export const PENNANT_FILTER_LABELS = ["1D เหนือ EMA50", "1D MACD", "1D + 4h MACD", "1h เหนือ EMA200", "ไม่ใช้"];
export const PENNANT_SL_LABELS = ["Swing ในธง ± 0.25 ATR", "เส้นธงฝั่งตรงข้าม ± 0.25 ATR", "2 ATR", "ไม่ใช้"];
export const PENNANT_EXIT_LABELS = ["ทิศเสีย (ตามตัวกรอง)", "เป้า 2R", "เป้า = ความสูงเสาธง", "ATR Trailing 3×"];

const PATTERN = { pl: 3, poleK: 2, wMax: 3, minAge: 4 };
/** ▲ Long (73–82) */
export const PENNANT_LONG_DEFAULTS = {
  ...PATTERN, poleLen: 24, maxAge: 60, apex: 1, filter: PENNANT_FILTER.d50, sl: PENNANT_SL.swing,
  exit: PENNANT_EXIT.bias, sweep: 1, swN: 72, swK: 12, swBuf: 0.5,
};
/** ▼ Short (84–93) */
export const PENNANT_SHORT_DEFAULTS = {
  ...PATTERN, poleLen: 12, maxAge: 30, apex: 0.75, filter: PENNANT_FILTER.dMacd, sl: PENNANT_SL.atr2,
  exit: PENNANT_EXIT.r2, sweep: 0, swN: 24, swK: 12, swBuf: 0.25,
};
export type PennantParams = typeof PENNANT_LONG_DEFAULTS;

export interface PennantLines {
  /** เส้นทะลุ: ผ่าน (p0, v0) ความชัน mU · เส้นตรงข้าม: ผ่าน (r0, w0) ความชัน mL */
  p0: number; v0: number; mU: number;
  r0: number; w0: number; mL: number;
  pole: number;
  apexX: number;
}

export interface PennantResult {
  side: 1 | -1;
  /** เป้าหมายสถานะรายแท่ง (ลงมือที่ราคาปิดแท่งนั้น): side = ถือ, 0 = ว่าง */
  exposure: number[];
  /** ราคาที่ปิดไม้ภายในแท่ง (ชน SL / เป้า) */
  exitFill: Series;
  reason: string[];
  stop: Series;
  target: Series;
  /** ตัวกรองทิศผ่านหรือไม่ รายแท่ง */
  bias: boolean[];
  /** เส้นอ้างอิงของตัวกรอง (EMA50 1D หรือ EMA200) ที่ใช้ตัดสินแท่งนั้น — ไว้วาด */
  biasLine: Series;
  /** ธงที่ทะลุแล้ว (ทุกอัน ไม่ว่าจะได้เข้าหรือไม่) */
  breaks: (PennantLines & { idx: number; entered: boolean })[];
  /** Sweep → CHoCH ที่ใช้เข้าไม้ */
  sweeps: { idx: number; j0: number; ext: number; lvl: number }[];
  /** ธงที่กำลังก่อตัว ณ แท่งสุดท้าย */
  forming: PennantLines | null;
}

// ══ 2) ส่วนประกอบ ══════════════════════════════════════════════
/** EMA ที่เริ่มจากค่าแรกที่ไม่ใช่ null ด้วย SMA (รองรับซีรีส์ที่มี null นำหน้า เช่น MACD) */
function emaS(src: Series, len: number): Series {
  const out: Series = new Array(src.length).fill(null);
  const a = 2 / (len + 1);
  let prev: number | null = null, sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    if (prev === null) {
      sum += v; cnt++;
      if (cnt === len) { prev = sum / len; out[i] = prev; }
    } else {
      prev = a * v + (1 - a) * prev;
      out[i] = prev;
    }
  }
  return out;
}

/** แท่ง timeframe ใหญ่จากแท่งของกราฟ: ราคาปิด = ราคาปิดของแท่งสุดท้ายในช่วง · end = เวลาปิด */
function resample(time: number[], close: number[], ms: number) {
  const end: number[] = [], c: number[] = [];
  let cur = NaN;
  for (let i = 0; i < time.length; i++) {
    const b = Math.floor(time[i] / ms);
    if (b !== cur) { cur = b; end.push((b + 1) * ms); c.push(close[i]); }
    else c[c.length - 1] = close[i];
  }
  return { end, close: c };
}

interface HtfFeed { m: Series; s: Series; c: Series; e50: Series }

/**
 * htfFeed() (119–123) บน timeframe `ms`: [MACD, Signal, close, EMA50] ของแท่งที่ปิดก่อนเวลาเปิดของแท่งกราฟ
 * = ผลของ request.security(..., lookahead_on) กับค่า [1] ใน Pine
 */
function htfFeed(time: number[], close: number[], ms: number): HtfFeed {
  const d = resample(time, close, ms);
  const e12 = emaS(d.close, 12), e26 = emaS(d.close, 26);
  const macd: Series = d.close.map((_, j) => (e12[j] !== null && e26[j] !== null ? (e12[j] as number) - (e26[j] as number) : null));
  const sig = emaS(macd, 9), e50 = emaS(d.close, 50);
  const n = time.length;
  const out: HtfFeed = { m: new Array(n).fill(null), s: new Array(n).fill(null), c: new Array(n).fill(null), e50: new Array(n).fill(null) };
  let j = -1;
  for (let i = 0; i < n; i++) {
    while (j + 1 < d.end.length && d.end[j + 1] <= time[i]) j++;
    if (j < 0) continue;
    out.m[i] = macd[j]; out.s[i] = sig[j]; out.c[i] = d.close[j]; out.e50[i] = e50[j];
  }
  return out;
}

/** `for j = a to b` ของ Pine: นับลงเมื่อ a > b */
function* pineRange(a: number, b: number) {
  if (a <= b) for (let j = a; j <= b; j++) yield j;
  else for (let j = a; j >= b; j--) yield j;
}

const gt = (a: number | null, b: number | null) => a !== null && b !== null && a > b;
const lt = (a: number | null, b: number | null) => a !== null && b !== null && a < b;

// ══ 3) ตัวคำนวณ ═══════════════════════════════════════════════
export function pennantStrategy(
  bars: Bars,
  side: 1 | -1,
  overrides: Partial<PennantParams> | Record<string, number> = {},
  startIndex = 0,
): PennantResult {
  const base = side > 0 ? PENNANT_LONG_DEFAULTS : PENNANT_SHORT_DEFAULTS;
  const p = { ...base, ...overrides } as PennantParams;
  const problem = validatePennant(p);
  if (problem) throw new Error(`Pennant: ${problem}`);

  const s = side;
  const n = bars.length;
  const { time, open: o, high: h, low: l, close: c } = bars;
  const pl = Math.round(p.pl), minAge = Math.round(p.minAge), maxAge = Math.round(p.maxAge), poleLen = Math.round(p.poleLen);
  const swN = Math.round(p.swN), swK = Math.round(p.swK);
  const filter = Math.round(p.filter), slMode = Math.round(p.sl), exMode = Math.round(p.exit);
  const sweepOn = p.sweep >= 0.5;

  // ── Indicators + HTF (116–131) ──
  const atrV = atrOf(bars.klines, 14);
  const e200 = emaS(c, 200);
  const needD = filter === PENNANT_FILTER.d50 || filter === PENNANT_FILTER.dMacd || filter === PENNANT_FILTER.dMacd4h;
  const D = needD ? htfFeed(time, c, 86_400_000) : null;
  const H4 = filter === PENNANT_FILTER.dMacd4h && s > 0 ? htfFeed(time, c, 14_400_000) : null;
  const biasAt = (i: number): boolean => {
    if (filter === PENNANT_FILTER.none) return true;
    if (filter === PENNANT_FILTER.ema200) return s > 0 ? gt(c[i], e200[i]) : lt(c[i], e200[i]);
    const d = D!;
    if (filter === PENNANT_FILTER.d50) return s > 0 ? gt(d.c[i], d.e50[i]) : lt(d.c[i], d.e50[i]);
    const dUp = gt(d.m[i], 0) && gt(d.s[i], 0), dDn = lt(d.m[i], 0) && lt(d.s[i], 0);
    if (filter === PENNANT_FILTER.dMacd4h && s > 0) return dUp && gt(H4!.m[i], 0) && gt(H4!.s[i], 0);
    return s > 0 ? dUp : dDn;
  };

  const blank = (): Series => new Array(n).fill(null);
  const r: PennantResult = {
    side, exposure: new Array(n).fill(0), exitFill: blank(), reason: new Array(n).fill("รอให้อินดิเคเตอร์พร้อม"),
    stop: blank(), target: blank(), bias: new Array(n).fill(false),
    biasLine: filter === PENNANT_FILTER.d50 ? D!.e50 : filter === PENNANT_FILTER.ema200 ? e200 : blank(),
    breaks: [], sweeps: [], forming: null,
  };

  // ── Pivots (136–165): a = ฝั่งยอดเสาธง (Long = Pivot High), b = ฝั่งตรงข้าม ──
  const aI: number[] = [], aV: number[] = [], bI: number[] = [], bV: number[] = [];
  const keepBars = maxAge + 2;
  let used = -1;

  // ── Sweep state (258–281) ──
  let swJ: number | null = null, swExt = NaN;

  // ── Book (344–429) ──
  let inPos = false, entry = 0, sl: number | null = null, tp: number | null = null, ext = 0, swEnt = false, held = 0;

  const fmt = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : x.toPrecision(6));
  const sideTh = s > 0 ? "Long" : "Short";
  const filtTh = PENNANT_FILTER_LABELS[filter] ?? "";

  for (let i = 0; i < n; i++) {
    // Pivot ที่ยืนยันที่แท่งนี้ = แท่ง i − pl
    if (i >= 2 * pl) {
      const x = i - pl;
      let isPH = true, isPL = true;
      for (let k = 1; k <= pl; k++) {
        if (h[x - k] >= h[x]) isPH = false;
        if (l[x - k] <= l[x]) isPL = false;
        if (h[x + k] > h[x]) isPH = false;
        if (l[x + k] < l[x]) isPL = false;
      }
      const [isA, isB] = s > 0 ? [isPH, isPL] : [isPL, isPH];
      if (isA) { aI.push(x); aV.push(s > 0 ? h[x] : l[x]); }
      if (isB) { bI.push(x); bV.push(s > 0 ? l[x] : h[x]); }
    }
    while (aI.length && aI[0] < i - keepBars) { aI.shift(); aV.shift(); }
    while (bI.length && bI[0] < i - keepBars) { bI.shift(); bV.shift(); }

    // ── findPen(s, …) ──
    let pen: PennantLines | null = null, inner: number | null = null;
    {
      const na = aI.length, nb = bI.length;
      let k0 = -1;
      if (na >= 2) for (let k = 0; k < na; k++) if (aI[k] >= i - maxAge && (k0 < 0 || s * aV[k] > s * aV[k0])) k0 = k;
      if (k0 >= 0 && k0 < na - 1 && nb >= 2) {
        const pp0 = aI[k0];
        if (pp0 !== used && i - pp0 >= minAge) {
          let q0 = -1;
          for (let k = 0; k < nb; k++) if (bI[k] > pp0 && (q0 < 0 || s * bV[k] < s * bV[q0])) q0 = k;
          if (q0 >= 0 && q0 < nb - 1 && s * bV[nb - 1] > s * bV[q0]) {
            const p0 = pp0, v0 = aV[k0], mU = (aV[na - 1] - v0) / (aI[na - 1] - p0);
            const r0 = bI[q0], w0 = bV[q0], mL = (bV[nb - 1] - w0) / (bI[nb - 1] - r0);
            let ok = true;
            for (const j of pineRange(p0 + 1, i - 1)) if (s * c[j] > s * (v0 + mU * (j - p0))) { ok = false; break; }
            if (ok && r0 + 1 <= i - 1) for (const j of pineRange(r0 + 1, i - 1)) if (s * c[j] < s * (w0 + mL * (j - r0))) { ok = false; break; }
            let pole = NaN, apexX = NaN;
            if (ok) {
              let baseV = s > 0 ? l[p0] : h[p0];
              for (let j = Math.max(0, p0 - poleLen); j <= p0; j++) baseV = s > 0 ? Math.min(baseV, l[j]) : Math.max(baseV, h[j]);
              pole = s * (v0 - baseV);
              const a0 = atrV[p0];
              ok = a0 !== null && pole >= p.poleK * a0;
            }
            if (ok) {
              const w = s * (v0 - (w0 + mL * (p0 - r0)));
              const dm = s * (mL - mU);
              ok = w > 0 && w <= p.wMax * pole && dm > 0;
              if (ok) {
                const ax = p0 + w / dm;
                ok = i <= p0 + p.apex * (ax - p0);
                apexX = Math.round(ax);
              }
            }
            if (ok) { pen = { p0, v0, mU, r0, w0, mL, pole, apexX }; inner = bV[nb - 1]; }
          }
        }
      }
    }
    const u = pen ? pen.v0 + pen.mU * (i - pen.p0) : null;     // เส้นทะลุ
    const lo = pen ? pen.w0 + pen.mL * (i - pen.r0) : null;    // เส้นตรงข้าม
    const brk = pen !== null && s * c[i] > s * (u as number);
    if (brk) used = pen!.p0;
    if (i === n - 1 && pen && !brk && s * c[i] >= s * (lo as number)) r.forming = pen;

    // ── sweepCh(side, N, K) ──
    let swSig = false, swLvl = NaN, swJ0 = -1, swExtHit = NaN;
    {
      let prev: number | null = null;
      if (i >= swN) {
        prev = s < 0 ? -Infinity : Infinity;
        for (let k = i - swN; k < i; k++) prev = s < 0 ? Math.max(prev, h[k]) : Math.min(prev, l[k]);
      }
      if (prev !== null && (s < 0 ? h[i] > prev : l[i] < prev)) {
        swJ = i; swExt = s < 0 ? h[i] : l[i];
      } else if (swJ !== null && i - swJ <= swK) {
        if (s < 0 ? h[i] > swExt : l[i] < swExt) swExt = s < 0 ? h[i] : l[i];
        let lv = s < 0 ? l[i - 1] : h[i - 1];
        for (let k = 1; k <= i - swJ; k++) lv = s < 0 ? Math.min(lv, l[i - k]) : Math.max(lv, h[i - k]);
        if (s < 0 ? c[i] < lv && c[i] < o[i] : c[i] > lv && c[i] > o[i]) {
          swSig = true; swExtHit = swExt; swLvl = lv; swJ0 = swJ; swJ = null;
        }
      }
    }

    const biasOk = biasAt(i);
    r.bias[i] = biasOk;
    const a = atrV[i];
    if (brk) r.breaks.push({ ...pen!, idx: i, entered: false });

    if (i < startIndex) {
      r.reason[i] = "warmup (no position)";
      continue;
    }

    // ── step(): SL → เป้า → กฎออก (396–416) ──
    let why = 0;
    if (inPos) {
      held++;
      if (sl !== null && (s > 0 ? l[i] <= sl : h[i] >= sl)) {
        why = 1;
        r.exitFill[i] = s > 0 ? Math.min(sl, o[i]) : Math.max(sl, o[i]);
      } else if (tp !== null && (s > 0 ? h[i] >= tp : l[i] <= tp)) {
        why = 2;
        r.exitFill[i] = s > 0 ? Math.max(tp, o[i]) : Math.min(tp, o[i]);
      } else {
        let hit = false;
        if (exMode === PENNANT_EXIT.bias || swEnt) hit = !biasOk;
        else if (exMode === PENNANT_EXIT.atrTrail) {
          ext = s > 0 ? Math.max(ext, c[i]) : Math.min(ext, c[i]);
          hit = a !== null && (s > 0 ? c[i] < ext - 3 * a : c[i] > ext + 3 * a);
        }
        if (hit) why = 3;
      }
      if (why) {
        const px = r.exitFill[i] ?? c[i];
        const g = (s * (px - entry) / entry) * 100;
        const label = why === 1 ? "ชน SL" : why === 2 ? "ถึงเป้า" : exMode === PENNANT_EXIT.atrTrail && !swEnt ? "ATR trailing 3×" : `ทิศเสีย (${filtTh} ไม่ผ่าน)`;
        r.reason[i] = `ปิด ${sideTh} (${label}) ที่ ${fmt(px)} · ${g >= 0 ? "+" : ""}${g.toFixed(2)}% ก่อนค่าธรรมเนียม · ถือ ${held} แท่ง`;
        // ระดับที่มีผลในแท่งที่ออกก็ยังแสดง
        r.stop[i] = sl; r.target[i] = tp;
        inPos = false;
      }
    }

    // ── เข้า (446–464): ทิศผ่าน · ไม่มีไม้ · ไม่ได้เพิ่งออกในแท่งนี้ ──
    if (!inPos && why === 0) {
      const slOf = () =>
        slMode === PENNANT_SL.none ? null
          : slMode === PENNANT_SL.atr2 ? (a === null ? NaN : c[i] - s * 2 * a)
            : slMode === PENNANT_SL.line ? (lo === null || a === null ? NaN : lo - s * 0.25 * a)
              : inner === null || a === null ? NaN : inner - s * 0.25 * a;
      const okStop = (st: number | null) => st === null || (Number.isFinite(st) && s * (c[i] - st) > 0 && Math.abs(c[i] - st) / c[i] >= 0.001);
      let opened: "flag" | "sweep" | null = null, stop: number | null = null;
      if (biasOk) {
        const stopFlag = brk ? slOf() : null;
        const swStop = a === null ? NaN : swExtHit - s * p.swBuf * a;
        if (brk && okStop(stopFlag)) { opened = "flag"; stop = stopFlag; }
        else if (sweepOn && swSig && okStop(swStop)) { opened = "sweep"; stop = swStop; }
      }
      if (opened) {
        const R = stop === null ? NaN : Math.abs(c[i] - stop);
        inPos = true; entry = c[i]; sl = stop; ext = c[i]; swEnt = opened === "sweep"; held = 0;
        tp = swEnt ? null
          : exMode === PENNANT_EXIT.r2 && Number.isFinite(R) ? c[i] + s * 2 * R
            : exMode === PENNANT_EXIT.pole ? c[i] + s * pen!.pole
              : null;
        if (swEnt) r.sweeps.push({ idx: i, j0: swJ0, ext: swExtHit, lvl: swLvl });
        else r.breaks[r.breaks.length - 1].entered = true;
        const how = swEnt
          ? `Sweep ${s > 0 ? "Low" : "High"} ${fmt(swExtHit)} (${i - swJ0} แท่งก่อน) → CHoCH ปิด${s > 0 ? "เหนือ" : "ใต้"} ${fmt(swLvl)}`
          : `${s > 0 ? "ทะลุเส้นบนธงขาขึ้น" : "หลุดเส้นล่างธงขาลง"} ${fmt(u)} · เสาธง ${a ? (pen!.pole / a).toFixed(1) : "?"} ATR · อายุธง ${i - pen!.p0} แท่ง`;
        r.reason[i] = `${s > 0 ? "BUY" : "SHORT"}: ${how} · ${filtTh} ✓ · เข้า ${fmt(c[i])} · SL ${fmt(sl)}${tp !== null ? ` · เป้า ${fmt(tp)}` : ""}`;
      } else if (why === 0) {
        if (brk) r.reason[i] = biasOk ? `ธงทะลุแต่ SL ใช้ไม่ได้ (ห่างจากราคาไม่ถึง 0.1%) · ไม่เข้า` : `ธงทะลุ แต่ทิศไม่ผ่าน (${filtTh} ✗) · ไม่เข้า`;
        else if (sweepOn && swSig) r.reason[i] = biasOk ? `Sweep → CHoCH แต่ SL ใช้ไม่ได้ · ไม่เข้า` : `Sweep → CHoCH แต่ทิศไม่ผ่าน (${filtTh} ✗) · ไม่เข้า`;
        else if (!biasOk) r.reason[i] = `ว่าง · ทิศไม่ผ่าน (${filtTh} ✗)`;
        else if (pen && s * c[i] >= s * (lo as number)) r.reason[i] = `ว่าง · ทิศ ✓ · ธง${s > 0 ? "ขาขึ้น" : "ขาลง"}กำลังก่อตัว: ปิด${s > 0 ? "เหนือ" : "ใต้"} ${fmt(u)} = ${s > 0 ? "BUY" : "SHORT"} (อีก ${Math.max(pen.apexX - i, 0)} แท่งถึงจุดยอด)`;
        else r.reason[i] = `ว่าง · ทิศ ✓ · รอธงทะลุ${sweepOn ? " หรือ Sweep → CHoCH" : ""}`;
      }
    } else if (inPos) {
      r.reason[i] = `ถือ ${sideTh} ${held} แท่ง · เข้า ${fmt(entry)} · SL ${fmt(sl)}${tp !== null ? ` · เป้า ${fmt(tp)}` : ""}${biasOk ? "" : " · ทิศไม่ผ่านแล้ว (ไม้นี้ออกด้วย SL/เป้าเท่านั้น)"}`;
    }

    if (inPos) { r.stop[i] = sl; r.target[i] = tp; }
    r.exposure[i] = inPos ? s : 0;
  }
  return r;
}

// ══ 4) ตรวจพารามิเตอร์ ═════════════════════════════════════════
export function validatePennant(p: Record<string, number>): string | null {
  const isInt = (x: number) => Number.isInteger(x);
  if (!isInt(p.pl) || p.pl < 2) return "Pivot ต้องเป็นจำนวนเต็มอย่างน้อย 2";
  if (!isInt(p.minAge) || p.minAge < 1) return "อายุธงขั้นต่ำต้องเป็นจำนวนเต็มอย่างน้อย 1";
  if (!isInt(p.maxAge) || p.maxAge < 5) return "อายุธงสูงสุดต้องเป็นจำนวนเต็มอย่างน้อย 5";
  if (p.maxAge < p.minAge) return "อายุธงสูงสุดต้องไม่น้อยกว่าอายุธงขั้นต่ำ";
  if (!isInt(p.poleLen) || p.poleLen < 1) return "ช่วงวัดเสาธงต้องเป็นจำนวนเต็มอย่างน้อย 1";
  if (!(p.apex > 0 && p.apex <= 1)) return "สัดส่วนทางไป Apex ต้องอยู่ระหว่าง 0.1–1";
  if (!(p.wMax > 0) || p.poleK < 0) return "ค่าเสาธง/ปากธงไม่ถูกต้อง";
  if (![0, 1, 2, 3, 4].includes(p.filter)) return "ตัวกรองทิศไม่ถูกต้อง";
  if (![0, 1, 2, 3].includes(p.sl) || ![0, 1, 2, 3].includes(p.exit)) return "SL / การออกไม่ถูกต้อง";
  if (!isInt(p.swN) || p.swN < 2 || !isInt(p.swK) || p.swK < 1 || p.swBuf < 0) return "ค่า Sweep ไม่ถูกต้อง";
  return null;
}

/**
 * อุ่นเครื่อง: EMA50/MACD ของ 1D ต้องนิ่ง — ทดสอบ BTC/ETH 1h แล้วสถานะตรงกับประวัติยาวสุดตั้งแต่ 200 วัน
 * (สั้นกว่านั้นวันที่ราคาปิดชิด EMA50 พลิกได้) · EMA200 ของกราฟ ~600 แท่ง · ธง/Sweep ~ อายุธง + N
 */
export function pennantWarmupBars(p: Record<string, number>, tfMinutes: number): number {
  const tf = tfMinutes > 0 ? tfMinutes : 60;
  const pattern = Math.round(p.maxAge) + Math.round(p.poleLen) + Math.round(p.swN) + 2 * Math.round(p.pl) + 20;
  const f = Math.round(p.filter);
  const htf = f === PENNANT_FILTER.ema200 ? 600 : f === PENNANT_FILTER.none ? 0 : Math.ceil((200 * 1440) / tf);
  return Math.min(15_000, Math.max(pattern, htf));
}

import { INDICATORS } from "./indicators";
import { htfTrend, type HtfTrend } from "./htf";
import { HTF_LABELS, HTF_MINUTES, type Bars, type Category, type ComputeContext, type HtfFilter, type HtfInterval, type IndicatorDef, type Params, type Source } from "./types";

const BY_ID = new Map<string, IndicatorDef>();
for (const def of INDICATORS) {
  if (BY_ID.has(def.id)) throw new Error(`Duplicate indicator id: ${def.id}`);
  BY_ID.set(def.id, def);
}

export function listIndicators(): IndicatorDef[] {
  return INDICATORS;
}

export function getIndicator(id: string): IndicatorDef | undefined {
  return BY_ID.get(id);
}

export function defaultParams(def: IndicatorDef): Params {
  const p: Params = {};
  for (const pd of def.params) p[pd.key] = pd.default;
  return p;
}

/** Fill missing keys with defaults and clamp to each param's range */
export function normalizeParams(def: IndicatorDef, input?: Partial<Params>): Params {
  const p: Params = {};
  for (const pd of def.params) {
    const raw = input?.[pd.key];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : pd.default;
    p[pd.key] = Math.min(pd.max, Math.max(pd.min, v));
  }
  return p;
}

export function paramsKey(id: string, p: Params): string {
  return `${id}|${Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join(",")}`;
}

export function categoriesInUse(): Category[] {
  return Array.from(new Set(INDICATORS.map((d) => d.category)));
}

export function sourceOf(def: IndicatorDef): Source {
  return def.source ?? "v1";
}

export function sourcesInUse(): Source[] {
  return Array.from(new Set(INDICATORS.map(sourceOf))).sort();
}

/** Signal or exposure engine for these params */
export function engineOf(def: IndicatorDef, p: Params) {
  return def.engine?.(p) ?? ({ kind: "signal" } as const);
}

/** Bars to skip before evaluation */
export function warmupOf(def: IndicatorDef, p: Params, tfMinutes: number): number {
  const w = def.warmupBars ? def.warmupBars(p, tfMinutes) : def.minBars;
  return Math.max(0, Math.ceil(Number.isFinite(w) ? w : def.minBars));
}

/** Median spacing between bars, in minutes (0 when unknown) */
export function detectTfMinutes(bars: Bars): number {
  const gaps: number[] = [];
  for (let i = 1; i <= Math.min(bars.length - 1, 200); i++) {
    const g = bars.time[i] - bars.time[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] / 60000;
}

/**
 * Where evaluation starts: after the indicator's warm-up, and — when the user asked to
 * evaluate only the last `evalBars` bars — no earlier than that window.
 */
export function planRun(def: IndicatorDef, p: Params, bars: Bars, evalBars?: number) {
  const tfMinutes = detectTfMinutes(bars);
  const warmup = warmupOf(def, p, tfMinutes);
  const windowStart = evalBars && evalBars > 0 ? bars.length - evalBars : 0;
  const startIndex = Math.max(0, Math.min(bars.length, Math.max(warmup, windowStart)));
  return { ctx: { startIndex, tfMinutes } as ComputeContext, warmup };
}

/** The filter is on and the chart timeframe is lower than the filter's timeframe */
export function htfApplies(f: HtfFilter | undefined, tfMinutes: number): f is HtfFilter {
  return !!f?.enabled && tfMinutes > 0 && tfMinutes < HTF_MINUTES[f.interval];
}

/**
 * Small LRU cache of compute() results keyed by indicator+params.
 * One instance per dataset — create a new one when the bars change.
 */
export class ComputeCache {
  private map = new Map<string, unknown>();
  private htf: { interval: HtfInterval; bars: Bars } | null = null;
  private trend: { key: string; value: HtfTrend } | null = null;
  constructor(private bars: Bars, private max = 40) {}

  get dataBars(): Bars {
    return this.bars;
  }

  /** Higher-timeframe bars of the same market (for the trend filter) */
  setHtf(interval: HtfInterval | null, bars: Bars | null) {
    this.htf = interval && bars ? { interval, bars } : null;
    this.trend = null;
  }

  /**
   * Higher-timeframe state per chart bar, or null when the filter is off or does not apply
   * (chart timeframe not lower than the filter's). Throws when the data has not been loaded.
   */
  htfTrend(f: HtfFilter | undefined, tfMinutes: number): HtfTrend | null {
    if (!htfApplies(f, tfMinutes)) return null;
    if (!this.htf || this.htf.interval !== f!.interval || this.htf.bars.length === 0) {
      throw new Error(`กำลังโหลดข้อมูล ${HTF_LABELS[f!.interval]} สำหรับตัวกรองเทรนด์…`);
    }
    const key = `${f!.interval}|${f!.fast}|${f!.slow}|${tfMinutes}`;
    if (this.trend?.key !== key) this.trend = { key, value: htfTrend(this.bars, this.htf.bars, f!, tfMinutes) };
    return this.trend.value;
  }

  compute(def: IndicatorDef, p: Params, ctx: ComputeContext): unknown {
    const key = `${paramsKey(def.id, p)}@${ctx.startIndex}`;
    if (this.map.has(key)) {
      const v = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, v);
      return v;
    }
    const v = def.compute(this.bars, p, ctx);
    this.map.set(key, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
    return v;
  }

}

import type { NumSeries } from "./math";
import { HTF_MINUTES, type Bars, type HtfFilter, type HtfInterval, type IndicatorDef, type LinePlot, type Params } from "./types";

/**
 * Recommended filters with the timeframe where each made the most profit in the user's tests.
 * Any registered indicator can be used as a filter; these are the presets shown first.
 */
export const HTF_CHOICES: { id: string; best: HtfInterval }[] = [
  { id: "trendlines", best: "1w" },
  { id: "cm_macd", best: "3d" },
  { id: "cci", best: "3d" },
  { id: "obv_trend", best: "3d" },
  { id: "vwap_cross", best: "1d" },
  { id: "ema_cross", best: "1d" },
  { id: "cdc_actionzone", best: "1d" },
];

/** Recommended timeframe of a preset filter (null for the others) */
export function htfBest(id: string): HtfInterval | null {
  return HTF_CHOICES.find((c) => c.id === id)?.best ?? null;
}

/** Fill gaps in a stored filter (the first version only had EMA fast/slow) */
export function normalizeHtf(f: Partial<HtfFilter> | undefined): HtfFilter {
  const indicator = typeof f?.indicator === "string" && f.indicator ? f.indicator : "ema_cross";
  const interval = f?.interval && f.interval in HTF_MINUTES ? f.interval : "1d";
  const params: Record<string, Params> = { ...(f?.params ?? {}) };
  if (!params.ema_cross && (f?.fast !== undefined || f?.slow !== undefined)) {
    params.ema_cross = { fast: f.fast ?? 9, slow: f.slow ?? 21 };
  }
  return { enabled: !!f?.enabled, interval, indicator, params };
}

/** Time the higher-timeframe bar j closes: Binance closeTime when known (exact month ends), else open + length */
function closeTimes(htf: Bars, interval: HtfInterval): number[] {
  const ms = HTF_MINUTES[interval] * 60_000;
  return htf.time.map((t, j) => {
    const ct = htf.klines[j]?.closeTime;
    return typeof ct === "number" && ct > t ? ct + 1 : t + ms;
  });
}

/**
 * Direction of the filter indicator on each higher-timeframe bar:
 * signal indicators → the last signal so far; strategies with their own exits → the side they hold.
 */
function htfStates(def: IndicatorDef, htf: Bars, params: Params, interval: HtfInterval, startIndex: number) {
  const ctx = { startIndex, tfMinutes: HTF_MINUTES[interval] };
  const r = def.compute(htf, params, ctx);
  const state = new Int8Array(htf.length);
  const engine = def.engine?.(params) ?? { kind: "signal" as const };
  if (engine.kind === "exposure" && def.exposure) {
    const ex = def.exposure(r, htf, params).exposure;
    for (let j = 0; j < htf.length; j++) state[j] = ex[j] > 0 ? 1 : ex[j] < 0 ? -1 : 0;
  } else {
    const sig = def.signals(r, htf, params);
    let cur = 0;
    for (let j = 0; j < htf.length; j++) {
      if (sig[j] === 1 || sig[j] === -1) cur = sig[j];
      state[j] = cur;
    }
  }
  return { r, state };
}

export interface HtfTrend {
  /** Per chart bar: +1 Long allowed, −1 Short allowed, 0 unknown (no entries) */
  regime: Int8Array;
  /** The filter indicator's price-scale lines as known at each chart bar (stepped) — for drawing */
  overlays: LinePlot[];
  /** Chart bar where the current state began (−1 when unknown) */
  sinceIdx: number;
}

/**
 * Run `def` on the higher-timeframe bars and map its direction onto the chart bars without lookahead:
 * chart bar i (closing at time[i] + tf) sees only higher-timeframe bars that closed by then;
 * the bar still in progress is never used.
 * @param warmup higher-timeframe bars a self-managed strategy skips before it may hold a position
 */
export function htfTrend(
  ltf: Bars, htf: Bars, def: IndicatorDef, params: Params, interval: HtfInterval, ltfMinutes: number,
  opts: { overlays?: boolean; warmup?: number } = {},
): HtfTrend {
  const n = ltf.length;
  const htfMs = HTF_MINUTES[interval] * 60_000;
  const ltfMs = Math.max(1, ltfMinutes) * 60_000;
  // Not enough higher-timeframe history for the warm-up → no state at all (never a shifted start)
  const start = Math.max(0, Math.min(htf.length, opts.warmup ?? 0));
  const { r, state } = htfStates(def, htf, params, interval, start);
  const closeAt = closeTimes(htf, interval);

  // Price-scale overlay lines of the indicator (EMA, VWAP, trendlines…), stepped onto the chart
  const src = opts.overlays
    ? (def.plot?.(r, htf, params, { dark: true }).overlays ?? []).filter((o): o is LinePlot => o.kind === "line")
    : [];
  const lines = src.map((o) => ({ o, values: new Array(n).fill(null) as NumSeries, colors: o.colors ? (new Array(n).fill(null) as (string | null)[]) : undefined }));

  const regime = new Int8Array(n);
  let j = -1; // last higher-timeframe bar closed by the current chart bar's close
  for (let i = 0; i < n; i++) {
    const barClose = ltf.time[i] + ltfMs;
    while (j + 1 < htf.length && closeAt[j + 1] <= barClose) j++;
    if (j < 0) continue;
    // A hole in the higher-timeframe data would carry a stale state forward — treat as unknown
    if (barClose - closeAt[j] > 2 * htfMs) continue;
    regime[i] = state[j];
    for (const l of lines) {
      l.values[i] = l.o.values[j] ?? null;
      if (l.colors) l.colors[i] = l.o.colors?.[j] ?? null;
    }
  }

  let sinceIdx = n - 1;
  const last = n ? regime[n - 1] : 0;
  if (last === 0) sinceIdx = -1;
  else while (sinceIdx > 0 && regime[sinceIdx - 1] === last) sinceIdx--;

  const overlays: LinePlot[] = lines.map(({ o, values, colors }) => ({
    kind: "line", title: o.title, color: o.color, width: 1, style: 2, values, ...(colors ? { colors } : {}),
  }));
  return { regime, overlays, sinceIdx };
}

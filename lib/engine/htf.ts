import type { NumSeries } from "./math";
import { HTF_MINUTES, type Bars, type HtfFilter, type HtfInterval, type IndicatorDef, type LinePlot, type Params } from "./types";

/**
 * Indicators offered as the higher-timeframe trend filter, in the order shown, each with the
 * timeframe where it made the most profit in the user's tests (selected automatically).
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
const CHOICE_IDS = new Set(HTF_CHOICES.map((c) => c.id));

export function htfBest(id: string): HtfInterval {
  return HTF_CHOICES.find((c) => c.id === id)?.best ?? "1d";
}

/** Fill gaps in a stored filter (older versions only had EMA fast/slow) */
export function normalizeHtf(f: Partial<HtfFilter> | undefined): HtfFilter {
  const indicator = f?.indicator && CHOICE_IDS.has(f.indicator) ? f.indicator : "ema_cross";
  const interval = f?.interval && f.interval in HTF_MINUTES ? f.interval : "1d";
  const params: Record<string, Params> = { ...(f?.params ?? {}) };
  if (!params.ema_cross && (f?.fast !== undefined || f?.slow !== undefined)) {
    params.ema_cross = { fast: f.fast ?? 9, slow: f.slow ?? 21 };
  }
  return { enabled: !!f?.enabled, interval, indicator, params };
}

export interface HtfTrend {
  /** Per chart bar: +1 higher timeframe bullish (after its Buy signal), −1 bearish, 0 unknown */
  regime: Int8Array;
  /** The filter indicator's price-scale lines as known at each chart bar (stepped) — for drawing */
  overlays: LinePlot[];
  /** Chart bar where the current state began (−1 when unknown) */
  sinceIdx: number;
}

/**
 * Run `def` on the higher-timeframe bars and map its direction onto the chart bars without lookahead.
 * Direction = the last signal so far (Buy → up until a Sell). Chart bar i (closing at time[i] + tf)
 * sees only higher-timeframe bars that closed by then; the bar still in progress is never used.
 */
export function htfTrend(ltf: Bars, htf: Bars, def: IndicatorDef, params: Params, interval: HtfInterval, ltfMinutes: number): HtfTrend {
  const n = ltf.length;
  const htfMinutes = HTF_MINUTES[interval];
  const htfMs = htfMinutes * 60_000;
  const ltfMs = Math.max(1, ltfMinutes) * 60_000;

  const r = def.compute(htf, params, { startIndex: 0, tfMinutes: htfMinutes });
  const sig = def.signals(r, htf, params);
  const state = new Int8Array(htf.length);
  let cur = 0;
  for (let j = 0; j < htf.length; j++) {
    if (sig[j] === 1 || sig[j] === -1) cur = sig[j];
    state[j] = cur;
  }

  // Price-scale overlay lines of the indicator (EMA, VWAP, trendlines…), stepped onto the chart
  const src = (def.plot?.(r, htf, params, { dark: true }).overlays ?? []).filter((o): o is LinePlot => o.kind === "line");
  const lines = src.map((o) => ({ o, values: new Array(n).fill(null) as NumSeries, colors: o.colors ? (new Array(n).fill(null) as (string | null)[]) : undefined }));

  const regime = new Int8Array(n);
  let j = -1; // last higher-timeframe bar closed by the current chart bar's close
  for (let i = 0; i < n; i++) {
    const closeAt = ltf.time[i] + ltfMs;
    while (j + 1 < htf.length && htf.time[j + 1] + htfMs <= closeAt) j++;
    if (j < 0) continue;
    // A hole in the higher-timeframe data would carry a stale state forward — treat as unknown
    if (closeAt - (htf.time[j] + htfMs) > 2 * htfMs) continue;
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

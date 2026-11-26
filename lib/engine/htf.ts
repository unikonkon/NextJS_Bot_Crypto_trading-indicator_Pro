import { ema, type NumSeries } from "./math";
import { HTF_MINUTES, type Bars, type HtfFilter } from "./types";

export interface HtfTrend {
  /** Per chart bar: +1 higher timeframe bullish (EMA fast > slow), −1 bearish, 0 unknown */
  regime: Int8Array;
  /** Higher-timeframe EMAs as known at each chart bar (stepped) — for drawing */
  fast: NumSeries;
  slow: NumSeries;
  /** Chart bar where the current state began (−1 when unknown) */
  sinceIdx: number;
}

/**
 * Map the higher-timeframe EMA cross state onto the chart bars without lookahead:
 * chart bar i (closing at time[i] + tf) sees only higher-timeframe bars that closed by then.
 * The higher-timeframe bar still in progress is never used.
 */
export function htfTrend(ltf: Bars, htf: Bars, f: HtfFilter, ltfMinutes: number): HtfTrend {
  const n = ltf.length;
  const regime = new Int8Array(n);
  const fastOut: NumSeries = new Array(n).fill(null);
  const slowOut: NumSeries = new Array(n).fill(null);
  const htfMs = HTF_MINUTES[f.interval] * 60_000;
  const ltfMs = Math.max(1, ltfMinutes) * 60_000;
  const fe = ema(htf.close, Math.max(1, Math.round(f.fast)));
  const se = ema(htf.close, Math.max(2, Math.round(f.slow)));

  let j = -1; // last higher-timeframe bar closed by the current chart bar's close
  for (let i = 0; i < n; i++) {
    const closeAt = ltf.time[i] + ltfMs;
    while (j + 1 < htf.length && htf.time[j + 1] + htfMs <= closeAt) j++;
    if (j < 0) continue;
    // A hole in the higher-timeframe data would carry a stale state forward — treat as unknown
    if (closeAt - (htf.time[j] + htfMs) > 2 * htfMs) continue;
    const a = fe[j], b = se[j];
    if (a === null || b === null) continue;
    fastOut[i] = a;
    slowOut[i] = b;
    regime[i] = a > b ? 1 : a < b ? -1 : 0;
  }
  let sinceIdx = n - 1;
  const cur = n ? regime[n - 1] : 0;
  if (cur === 0) sinceIdx = -1;
  else while (sinceIdx > 0 && regime[sinceIdx - 1] === cur) sinceIdx--;
  return { regime, fast: fastOut, slow: slowOut, sinceIdx };
}

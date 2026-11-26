import type { Bars, SignalArray } from "./types";
import type { KlineData } from "@/lib/types/kline";

export { sma, ema, rsi, atr } from "@/lib/indicators";

export type NumSeries = (number | null)[];

export function toBars(klines: KlineData[]): Bars {
  const n = klines.length;
  const time = new Array<number>(n);
  const open = new Array<number>(n);
  const high = new Array<number>(n);
  const low = new Array<number>(n);
  const close = new Array<number>(n);
  const volume = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const k = klines[i];
    time[i] = k.openTime;
    open[i] = +k.open;
    high[i] = +k.high;
    low[i] = +k.low;
    close[i] = +k.close;
    volume[i] = +k.volume;
  }
  return { length: n, time, open, high, low, close, volume, klines };
}

/** Rolling population standard deviation (matches Pine `ta.stdev`) */
export function stdev(data: number[], period: number): NumSeries {
  const out: NumSeries = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (data[j] - mean) ** 2;
    out[i] = Math.sqrt(sq / period);
  }
  return out;
}

export function highest(data: number[], period: number): NumSeries {
  const out: NumSeries = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (data[j] > m) m = data[j];
    out[i] = m;
  }
  return out;
}

export function lowest(data: number[], period: number): NumSeries {
  const out: NumSeries = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (data[j] < m) m = data[j];
    out[i] = m;
  }
  return out;
}

/** Wilder's RMA over a series that may start with nulls */
export function rma(data: NumSeries, period: number): NumSeries {
  const out: NumSeries = new Array(data.length).fill(null);
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v;
      count++;
      if (count === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = (prev * (period - 1) + v) / period;
    out[i] = prev;
  }
  return out;
}

/** Convert a legacy "BUY" | "SELL" | null array into a signal array */
export function fromBuySell(arr: ("BUY" | "SELL" | null)[]): SignalArray {
  const out = new Int8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] === "BUY" ? 1 : arr[i] === "SELL" ? -1 : 0;
  return out;
}

/** +1 where a crosses above b, -1 where a crosses below b */
export function crossSignals(a: NumSeries, b: NumSeries | number): SignalArray {
  const out = new Int8Array(a.length);
  const at = (i: number) => (typeof b === "number" ? b : b[i]);
  for (let i = 1; i < a.length; i++) {
    const a0 = a[i - 1], a1 = a[i], b0 = at(i - 1), b1 = at(i);
    if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
    if (a0 <= b0 && a1 > b1) out[i] = 1;
    else if (a0 >= b0 && a1 < b1) out[i] = -1;
  }
  return out;
}

/** Bars → whitespace-friendly series where values only show while `mask` is true */
export function maskSeries(values: NumSeries, mask: (i: number) => boolean): NumSeries {
  return values.map((v, i) => (v !== null && mask(i) ? v : null));
}

export const COLORS = {
  up: "#10b981",
  down: "#ef4444",
  blue: "#3b82f6",
  amber: "#f59e0b",
  orange: "#f97316",
  violet: "#a78bfa",
  purple: "rgba(168,85,247,0.7)",
  cyan: "#22d3ee",
  teal: "rgba(20,184,166,0.7)",
  upSoft: "rgba(16,185,129,0.35)",
  downSoft: "rgba(239,68,68,0.35)",
  grey: "#6b7280",
};

export function refLine(dark: boolean): string {
  return dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
}

/** SMA over a series that may contain nulls (window must be fully non-null) */
export function smaN(data: NumSeries, period: number): NumSeries {
  const out: NumSeries = new Array(data.length).fill(null);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) { sum = 0; valid = 0; continue; }
    sum += v;
    valid++;
    if (valid > period) { sum -= data[i - period] as number; valid = period; }
    if (valid === period) out[i] = sum / period;
  }
  return out;
}

/** EMA over a series that may start with nulls (seeded with SMA) */
export function emaN(data: NumSeries, period: number): NumSeries {
  const out: NumSeries = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v;
      count++;
      if (count === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { KlineData } from "@/lib/types/kline";
import { HTF_LABELS, HTF_MINUTES, type HtfInterval } from "@/lib/engine/types";
import { fetchKlinesRange } from "./use-kline-data";

interface Loaded {
  symbol: string;
  /** Covered range: [from, to) in ms */
  from: number;
  to: number;
  klines: KlineData[];
}

export interface HtfWant {
  interval: HtfInterval;
  /** Higher-timeframe bars needed before the first chart bar for the filter indicators to settle */
  warmBars: number;
}

/** 2017-01-01 UTC — Binance has no klines before 2017 */
const EXCHANGE_START = Date.UTC(2017, 0, 1);

function firstMissing(
  symbol: string, wants: HtfWant[], firstTime: number | null, lastTime: number | null, ltfMinutes: number,
  data: Partial<Record<HtfInterval, Loaded>>,
) {
  if (firstTime === null || lastTime === null) return null;
  const end = lastTime + ltfMinutes * 60_000;
  const missing = wants
    // Long warm-ups on monthly/weekly bars would reach before Binance existed (a negative time is rejected)
    .map((w) => ({ w, from: Math.max(EXCHANGE_START, Math.floor((firstTime - w.warmBars * HTF_MINUTES[w.interval] * 60_000) / 86_400_000) * 86_400_000) }))
    .find(({ w, from }) => {
      const d = data[w.interval];
      return !(d && d.symbol === symbol && d.from <= from && d.to >= end);
    });
  if (!missing) return null;
  const { w, from } = missing;
  return { key: `${symbol}|${w.interval}|${from}|${end}`, interval: w.interval, from, end };
}

/**
 * Higher-timeframe bars for the trend filter, for every interval in `wants` (fetched one at a time).
 * Each covers the loaded chart bars plus its warm-up; refetched only when that is no longer covered.
 */
export function useHtfSets(p: {
  symbol: string;
  wants: HtfWant[];
  firstTime: number | null;
  lastTime: number | null;
  ltfMinutes: number;
}) {
  const [data, setData] = useState<Partial<Record<HtfInterval, Loaded>>>({});
  const [failed, setFailed] = useState<{ key: string; interval: HtfInterval; error: string } | null>(null);
  const { symbol, wants, firstTime, lastTime, ltfMinutes } = p;

  // First interval that is not covered yet — null when everything is loaded
  const need = useMemo(
    () => firstMissing(symbol, wants, firstTime, lastTime, ltfMinutes, data),
    [symbol, wants, firstTime, lastTime, ltfMinutes, data],
  );

  useEffect(() => {
    if (!need || failed?.key === need.key) return;
    const ctrl = new AbortController();
    fetchKlinesRange(symbol, need.interval, need.from, need.end, ctrl.signal)
      .then((klines) => {
        if (ctrl.signal.aborted) return;
        if (!klines.length) throw new Error(`ไม่พบข้อมูล ${symbol} ${HTF_LABELS[need.interval]}`);
        const last = klines[klines.length - 1].closeTime + 1;
        setData((prev) => ({ ...prev, [need.interval]: { symbol, from: need.from, to: Math.max(need.end, last), klines } }));
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setFailed({ key: need.key, interval: need.interval, error: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [need, failed, symbol]);

  const sets = useMemo(() => {
    const out: Partial<Record<HtfInterval, KlineData[]>> = {};
    for (const [k, v] of Object.entries(data)) if (v && v.symbol === symbol) out[k as HtfInterval] = v.klines;
    return out;
  }, [data, symbol]);
  const error = need && failed?.key === need.key ? { interval: failed.interval, message: failed.error } : null;
  return {
    /** Loaded bars by interval (kept while a wider range loads — the engine maps by time) */
    sets,
    /** Interval being fetched now */
    loading: need && !error ? need.interval : null,
    error,
  };
}

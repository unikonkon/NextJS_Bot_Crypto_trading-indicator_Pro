"use client";

import { useEffect, useMemo, useState } from "react";
import type { KlineData } from "@/lib/types/kline";
import { HTF_MINUTES, type HtfFilter, type HtfInterval } from "@/lib/engine/types";
import { fetchKlinesRange } from "./use-kline-data";

interface Loaded {
  symbol: string;
  interval: HtfInterval;
  /** Covered range: [from, to) in ms */
  from: number;
  to: number;
  klines: KlineData[];
}

/**
 * Higher-timeframe bars for the trend filter. Covers the loaded chart bars plus enough
 * history before them for the slow EMA to settle; refetches only when that is no longer covered.
 */
export function useHtfData(p: {
  active: boolean;
  symbol: string;
  filter: HtfFilter;
  firstTime: number | null;
  lastTime: number | null;
  ltfMinutes: number;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{ key: string; error: string } | null>(null);
  const { active, symbol, firstTime, lastTime, ltfMinutes } = p;
  const { interval, slow } = p.filter;

  // What must be covered now — null when nothing needs fetching
  const need = useMemo(() => {
    if (!active || firstTime === null || lastTime === null) return null;
    const htfMs = HTF_MINUTES[interval] * 60_000;
    const warm = 3 * Math.max(2, Math.round(slow)) + 10;
    const from = Math.floor((firstTime - warm * htfMs) / htfMs) * htfMs;
    const end = lastTime + ltfMinutes * 60_000;
    if (data && data.symbol === symbol && data.interval === interval && data.from <= from && data.to >= end) return null;
    return { key: `${symbol}|${interval}|${from}|${end}`, symbol, interval, from, end, htfMs };
  }, [active, symbol, interval, slow, firstTime, lastTime, ltfMinutes, data]);

  useEffect(() => {
    if (!need || failed?.key === need.key) return;
    const ctrl = new AbortController();
    fetchKlinesRange(need.symbol, need.interval, need.from, need.end, ctrl.signal)
      .then((klines) => {
        if (ctrl.signal.aborted) return;
        if (!klines.length) throw new Error(`ไม่พบข้อมูล ${need.symbol} ${need.interval}`);
        const last = klines[klines.length - 1].openTime + need.htfMs;
        setData({ symbol: need.symbol, interval: need.interval, from: need.from, to: Math.max(need.end, last), klines });
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setFailed({ key: need.key, error: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [need, failed]);

  const match = active && data && data.symbol === symbol && data.interval === interval ? data : null;
  const error = need && failed?.key === need.key ? failed.error : null;
  return {
    // Keep showing the previous bars while a wider range loads (same market) — the engine maps by time
    klines: match?.klines ?? null,
    loading: !!need && !error,
    error,
  };
}

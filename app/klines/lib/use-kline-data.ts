"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseKline, type BinanceKlineRaw, type Interval, type KlineData } from "@/lib/types/kline";
import type { CsvFileInfo } from "@/app/api/dataShowUI/route";

export type DataSource =
  | { kind: "latest"; limit: number }
  | { kind: "range"; start: number; end: number }
  | { kind: "csv"; file: string };

const PAGE = 1000;

/** Sort ascending and drop duplicate openTimes (charts require strictly increasing time) */
export function normalizeKlines(rows: KlineData[]): KlineData[] {
  const sorted = [...rows].sort((a, b) => a.openTime - b.openTime);
  const out: KlineData[] = [];
  for (const k of sorted) {
    if (!Number.isFinite(k.openTime) || !Number.isFinite(+k.close)) continue;
    if (out.length && out[out.length - 1].openTime === k.openTime) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

async function fetchPage(params: Record<string, string>, signal: AbortSignal): Promise<KlineData[]> {
  const res = await fetch(`/api/klines?${new URLSearchParams(params)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const raw: BinanceKlineRaw[] = await res.json();
  return raw.map(parseKline);
}

/** Every bar of `interval` between start and end, paging forwards (shared by the main data and the trend filter) */
export async function fetchKlinesRange(
  symbol: string, interval: string, start: number, end: number, signal: AbortSignal, onProgress?: (n: number) => void,
): Promise<KlineData[]> {
  const all: KlineData[] = [];
  let cur = start;
  while (cur < end) {
    const page = await fetchPage({ symbol, interval, limit: String(PAGE), startTime: String(cur), endTime: String(end) }, signal);
    if (page.length === 0) break;
    all.push(...page);
    onProgress?.(all.length);
    const last = page[page.length - 1].closeTime;
    if (last >= end || page.length < PAGE) break;
    cur = last + 1;
    await new Promise((r) => setTimeout(r, 80));
  }
  return all;
}

export function parseCsv(text: string): KlineData[] {
  return text.trim().split("\n").slice(1).map((line) => {
    const c = line.split(",");
    return {
      openTime: new Date(c[0]).getTime(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
      closeTime: new Date(c[6]).getTime(),
      quoteAssetVolume: c[7],
      numberOfTrades: parseInt(c[8], 10),
      takerBuyBaseVolume: c[9],
      takerBuyQuoteVolume: c[10],
    };
  });
}

export function useKlineData() {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [csvFiles, setCsvFiles] = useState<CsvFileInfo[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/dataShowUI")
      .then((r) => r.json())
      .then((f: unknown) => setCsvFiles(Array.isArray(f) ? (f as CsvFileInfo[]) : []))
      .catch(() => setCsvFiles([]));
  }, []);

  const run = useCallback(async (src: DataSource, task: (signal: AbortSignal) => Promise<KlineData[]>) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const rows = normalizeKlines(await task(ctrl.signal));
      if (ctrl.signal.aborted) return;
      if (rows.length === 0) throw new Error("ไม่พบข้อมูลในช่วงที่เลือก");
      setKlines(rows);
      setSource(src);
      setLoadedAt(new Date());
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === ctrl) {
        setLoading(false);
        setProgress(null);
        abortRef.current = null;
      }
    }
  }, []);

  /** Latest N bars. N > 1000 pages backwards with endTime. */
  const loadLatest = useCallback((symbol: string, interval: Interval, limit: number) =>
    run({ kind: "latest", limit }, async (signal) => {
      const all: KlineData[] = [];
      let endTime: number | undefined;
      while (all.length < limit) {
        const want = Math.min(PAGE, limit - all.length);
        const params: Record<string, string> = { symbol, interval, limit: String(want) };
        if (endTime !== undefined) params.endTime = String(endTime);
        const page = await fetchPage(params, signal);
        if (page.length === 0) break;
        all.unshift(...page);
        setProgress(all.length);
        if (page.length < want) break;
        endTime = page[0].openTime - 1;
      }
      return all;
    }), [run]);

  /** Every bar between start and end, paging forwards */
  const loadRange = useCallback((symbol: string, interval: Interval, start: number, end: number) =>
    run({ kind: "range", start, end }, (signal) => fetchKlinesRange(symbol, interval, start, end, signal, setProgress)), [run]);

  const loadCsv = useCallback((file: string) =>
    run({ kind: "csv", file }, async (signal) => {
      const res = await fetch(`/api/dataShowUI?file=${encodeURIComponent(file)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseCsv(await res.text());
    }), [run]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  /** Download the bars currently loaded (no refetch) */
  const downloadCsv = useCallback((name: string) => {
    if (klines.length === 0) return;
    const header = "OpenTime,Open,High,Low,Close,Volume,CloseTime,QuoteAssetVolume,NumberOfTrades,TakerBuyBaseVolume,TakerBuyQuoteVolume";
    const rows = klines.map((k) =>
      `${new Date(k.openTime).toISOString()},${k.open},${k.high},${k.low},${k.close},${k.volume},${new Date(k.closeTime).toISOString()},${k.quoteAssetVolume},${k.numberOfTrades},${k.takerBuyBaseVolume},${k.takerBuyQuoteVolume}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}_${klines.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [klines]);

  return { klines, loading, progress, error, setError, source, loadedAt, csvFiles, loadLatest, loadRange, loadCsv, cancel, downloadCsv };
}

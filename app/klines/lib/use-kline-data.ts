"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Interval, KlineData } from "@/lib/types/kline";
import type { CsvFileInfo } from "@/app/api/dataShowUI/route";
import { fetchKlinesRange, fetchLatestKlines, normalizeKlines, parseCsv } from "./kline-fetch";
import { isKeepEnabled, loadLatestStored, loadRangeStored, onStoreError, type StoreUse } from "./kline-store";
import { fmtDate } from "./format";

export { fetchKlinesRange, fetchLatestKlines, normalizeKlines, parseCsv };

export type DataSource =
  | { kind: "latest"; limit: number }
  /** `toNow`: loaded up to the present (a quick range), not to a fixed end */
  | { kind: "range"; start: number; end: number; toNow?: boolean }
  | { kind: "csv"; file: string };

/** Bars from a loader, optionally with how much of them came from the local database */
type Loaded = KlineData[] | { rows: KlineData[]; use: StoreUse };

export function useKlineData() {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [csvFiles, setCsvFiles] = useState<CsvFileInfo[]>([]);
  /** How the bars on screen were obtained when the local database was used (null = plain download / file) */
  const [storeUse, setStoreUse] = useState<StoreUse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/dataShowUI")
      .then((r) => r.json())
      .then((f: unknown) => setCsvFiles(Array.isArray(f) ? (f as CsvFileInfo[]) : []))
      .catch(() => setCsvFiles([]));
  }, []);

  // Bars are stored after they are shown — a failure there (quota full…) arrives separately
  useEffect(() => onStoreError(setError), []);

  const run = useCallback(async (src: DataSource, task: (signal: AbortSignal) => Promise<Loaded>) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const out = await task(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const use = Array.isArray(out) ? null : out.use;
      const rows = Array.isArray(out) ? normalizeKlines(out) : out.rows;
      if (rows.length === 0) throw new Error("ไม่พบข้อมูลในช่วงที่เลือก");
      setKlines(rows);
      setSource(src);
      setLoadedAt(new Date());
      setStoreUse(use);
      // Offline / exchange unreachable: the stored bars are still usable, just not up to date
      if (use?.stale) setError(`อัปเดตข้อมูลไม่สำเร็จ (${use.stale}) — แสดงข้อมูลที่เก็บไว้ในเครื่องถึง ${fmtDate(rows[rows.length - 1].openTime, true)}`);
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
    run({ kind: "latest", limit }, (signal) => (isKeepEnabled()
      ? loadLatestStored(symbol, interval, limit, signal, setProgress)
      : fetchLatestKlines(symbol, interval, limit, signal, setProgress))), [run]);

  /** Every bar between start and end, paging forwards (`toNow`: the end is the present) */
  const loadRange = useCallback((symbol: string, interval: Interval, start: number, end: number, toNow = false) =>
    run({ kind: "range", start, end, toNow }, (signal) => (isKeepEnabled()
      ? loadRangeStored(symbol, interval, start, end, signal, setProgress)
      : fetchKlinesRange(symbol, interval, start, end, signal, setProgress))), [run]);

  const loadCsv = useCallback((file: string) =>
    run({ kind: "csv", file }, async (signal) => {
      const res = await fetch(`/api/dataShowUI?file=${encodeURIComponent(file)}`, { signal });
      if (!res.ok) throw new Error(res.status === 404 ? `ไม่พบไฟล์ ${file} แล้ว` : `โหลดไฟล์ ${file} ไม่ได้ (HTTP ${res.status})`);
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

  return { klines, loading, progress, error, setError, source, loadedAt, csvFiles, storeUse, loadLatest, loadRange, loadCsv, cancel, downloadCsv };
}

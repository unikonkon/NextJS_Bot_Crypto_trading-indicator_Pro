"use client";

/**
 * Run backtests over several stored CSV files (ranking / strategy comparison).
 * Uses its own worker pool so the chart's dataset in the shared pool is never replaced;
 * files run one after another, the jobs of each file in parallel.
 */
import type { CsvFileInfo } from "@/app/api/dataShowUI/route";
import { INTERVAL_MINUTES, type Interval, type KlineData } from "@/lib/types/kline";
import { htfApplies, htfWarmupBars } from "@/lib/engine/registry";
import { normalizeHtf } from "@/lib/engine/htf";
import { HTF_MINUTES, type HtfInterval } from "@/lib/engine/types";
import type { JobOutput, RunJob } from "@/lib/engine/runner";
import { AbortedError, BacktestPool } from "@/lib/engine/worker/pool";
import { fetchKlinesRange, fetchLatestKlines, normalizeKlines, parseCsv } from "./use-kline-data";

/** 2017-01-01 UTC — Binance has no klines before 2017 */
const EXCHANGE_START = Date.UTC(2017, 0, 1);
const DAY = 86_400_000;

/** Bar length of a file in minutes (from its name; 0 when unknown) */
export function fileTfMinutes(f: CsvFileInfo): number {
  return f.interval ? INTERVAL_MINUTES[f.interval as Interval] ?? 0 : 0;
}

// Parsed files and downloaded higher-timeframe bars are kept for the page's lifetime
const csvCache = new Map<string, Promise<KlineData[]>>();
const htfCache = new Map<string, Promise<KlineData[]>>();

function loadCsv(f: CsvFileInfo): Promise<KlineData[]> {
  const key = `${f.file}|${f.size}|${f.to}`;
  let p = csvCache.get(key);
  if (!p) {
    p = fetch(`/api/dataShowUI?file=${encodeURIComponent(f.file)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`โหลด ${f.file} ไม่ได้ (HTTP ${r.status})`))))
      .then((t) => normalizeKlines(parseCsv(t)));
    p.catch(() => csvCache.delete(key));
    csvCache.set(key, p);
  }
  return p;
}

function loadHtf(symbol: string, interval: HtfInterval, from: number, end: number): Promise<KlineData[]> {
  // A cached download that already covers the range is reused
  for (const [k, p] of htfCache) {
    const [s, i, f, e] = k.split("|");
    if (s === symbol && i === interval && +f <= from && +e >= end) return p;
  }
  const key = `${symbol}|${interval}|${from}|${end}`;
  // Never aborted midway: other files (and later runs) share the download
  const p = fetchKlinesRange(symbol, interval, from, end, new AbortController().signal);
  p.catch(() => htfCache.delete(key));
  htfCache.set(key, p);
  return p;
}

export interface FileJob<T> {
  job: RunJob;
  meta: T;
}

export interface FileResult<T> {
  file: CsvFileInfo;
  meta: T;
  out: JobOutput | Error;
}

export async function runOnFiles<T>(opts: {
  files: CsvFileInfo[];
  /** Pair to use for higher-timeframe data when a file name does not say */
  fallbackSymbol: string;
  /** Jobs for one file; `tfMinutes` is the file's bar length */
  jobsFor: (file: CsvFileInfo, tfMinutes: number) => FileJob<T>[];
  onProgress?: (done: number, total: number, stage: string) => void;
  signal: AbortSignal;
}): Promise<FileResult<T>[]> {
  const { files, signal } = opts;
  const plans = files.map((file) => ({ file, tf: fileTfMinutes(file), jobs: opts.jobsFor(file, fileTfMinutes(file)) }));
  const total = plans.reduce((n, p) => n + p.jobs.length, 0);

  // Higher-timeframe bars each symbol needs: one download per interval covering every file + warm-up
  const htfNeed = new Map<string, { symbol: string; interval: HtfInterval; from: number; end: number }>();
  for (const { file, tf, jobs } of plans) {
    const symbol = file.symbol ?? opts.fallbackSymbol;
    for (const { job } of jobs) {
      const h = job.config.htf;
      if (!htfApplies(h, tf)) continue;
      const f = normalizeHtf(h);
      const warmMs = htfWarmupBars(f) * HTF_MINUTES[f.interval] * 60_000;
      const from = Math.max(EXCHANGE_START, Math.floor((file.from - warmMs) / DAY) * DAY);
      const key = `${symbol}|${f.interval}`;
      const cur = htfNeed.get(key);
      htfNeed.set(key, { symbol, interval: f.interval, from: Math.min(cur?.from ?? from, from), end: Math.max(cur?.end ?? 0, file.to + 1) });
    }
  }

  const out: FileResult<T>[] = [];
  let done = 0;
  const pool = new BacktestPool();
  try {
    for (const { file, jobs } of plans) {
      if (signal.aborted) throw new AbortedError();
      if (!jobs.length) continue;
      const symbol = file.symbol ?? opts.fallbackSymbol;
      opts.onProgress?.(done, total, `โหลด ${file.file}`);
      const klines = await loadCsv(file);
      const sets: Partial<Record<HtfInterval, KlineData[]>> = {};
      for (const need of htfNeed.values()) {
        if (need.symbol !== symbol) continue;
        opts.onProgress?.(done, total, `โหลด ${symbol} ${need.interval} สำหรับตัวกรอง`);
        sets[need.interval] = await loadHtf(symbol, need.interval, need.from, need.end);
      }
      if (signal.aborted) throw new AbortedError();
      pool.setData(klines);
      pool.setHtf(sets);
      const stage = `${file.symbol ?? ""} ${file.interval ?? file.file}`.trim();
      const before = done;
      const res = await pool.runMany(jobs.map((j) => j.job), (d) => { done = before + d; opts.onProgress?.(done, total, stage); }, signal);
      res.forEach((r, i) => out.push({ file, meta: jobs[i].meta, out: r }));
    }
  } finally {
    pool.terminate();
  }
  return out;
}

// ─── Several coins (latest N bars of each, straight from Binance) ──────────

const COIN_TTL = 3 * 60_000;
const coinCache = new Map<string, { at: number; p: Promise<KlineData[]> }>();

function loadCoin(symbol: string, interval: Interval, bars: number): Promise<KlineData[]> {
  const key = `${symbol}|${interval}|${bars}`;
  const hit = coinCache.get(key);
  if (hit && Date.now() - hit.at < COIN_TTL) return hit.p;
  // Not tied to one run's abort: a cancelled run can still reuse what finished downloading
  const p = fetchLatestKlines(symbol, interval, bars, new AbortController().signal).then(normalizeKlines);
  p.catch(() => coinCache.delete(key));
  coinCache.set(key, { at: Date.now(), p });
  return p;
}

export interface CoinResult<T> {
  symbol: string;
  meta: T;
  out: JobOutput | Error;
}

/**
 * Run jobs on the latest `bars` bars of every symbol (one coin at a time, its jobs in parallel;
 * the next coin downloads while the current one runs). A coin that fails to load gets error rows.
 */
export async function runOnCoins<T>(opts: {
  symbols: string[];
  interval: Interval;
  /** Bars to download per coin (evaluation window + warm-up) */
  bars: number;
  jobsFor: (symbol: string) => FileJob<T>[];
  onProgress?: (done: number, total: number, stage: string) => void;
  signal: AbortSignal;
}): Promise<CoinResult<T>[]> {
  const { symbols, interval, bars, signal } = opts;
  const tf = INTERVAL_MINUTES[interval] ?? 0;
  const tfMs = tf * 60_000;
  const plans = symbols.map((symbol) => ({ symbol, jobs: opts.jobsFor(symbol) }));
  const total = symbols.length;
  const loads = new Map<number, Promise<KlineData[]>>();
  const get = (i: number) => {
    let p = loads.get(i);
    if (!p) {
      p = loadCoin(plans[i].symbol, interval, bars);
      p.catch(() => {});
      loads.set(i, p);
    }
    return p;
  };

  const out: CoinResult<T>[] = [];
  const fail = (symbol: string, jobs: FileJob<T>[], err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    for (const j of jobs) out.push({ symbol, meta: j.meta, out: e });
  };
  const pool = new BacktestPool();
  try {
    for (let i = 0; i < plans.length; i++) {
      if (signal.aborted) throw new AbortedError();
      const { symbol, jobs } = plans[i];
      opts.onProgress?.(i, total, `โหลด ${symbol}`);
      let klines: KlineData[];
      try {
        klines = await get(i);
      } catch (err) {
        fail(symbol, jobs, err);
        continue;
      } finally {
        if (i + 1 < plans.length) get(i + 1);
      }
      if (signal.aborted) throw new AbortedError();
      if (klines.length < 50) { fail(symbol, jobs, new Error(`ข้อมูลไม่พอ (${klines.length} แท่ง)`)); continue; }

      // Higher-timeframe bars for the trend filter, covering this coin's bars + warm-up
      const sets: Partial<Record<HtfInterval, KlineData[]>> = {};
      try {
        for (const { job } of jobs) {
          const h = job.config.htf;
          if (!htfApplies(h, tf)) continue;
          const f = normalizeHtf(h);
          if (sets[f.interval]) continue;
          const warmMs = htfWarmupBars(f) * HTF_MINUTES[f.interval] * 60_000;
          const from = Math.max(EXCHANGE_START, Math.floor((klines[0].openTime - warmMs) / DAY) * DAY);
          opts.onProgress?.(i, total, `โหลด ${symbol} ${f.interval} สำหรับตัวกรอง`);
          sets[f.interval] = await loadHtf(symbol, f.interval, from, klines[klines.length - 1].openTime + tfMs);
        }
      } catch (err) {
        fail(symbol, jobs, err);
        continue;
      }
      if (signal.aborted) throw new AbortedError();

      pool.setData(klines);
      pool.setHtf(sets);
      opts.onProgress?.(i, total, symbol);
      const res = await pool.runMany(jobs.map((j) => j.job), undefined, signal);
      res.forEach((r, k) => out.push({ symbol, meta: jobs[k].meta, out: r }));
    }
    opts.onProgress?.(total, total, "");
  } finally {
    pool.terminate();
  }
  return out;
}

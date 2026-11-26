"use client";

/**
 * Candlestick bars stored in the local database (IndexedDB — durable site data, not a cache):
 * one contiguous block per coin + timeframe, any number of coins, until the browser's quota is full.
 * Loading a coin again only downloads the bars that are new since it was stored; nothing is removed
 * automatically — coins and timeframes are deleted from /saved.
 */
import { INTERVAL_MINUTES, parseKline, type BinanceKlineRaw, type Interval, type KlineData } from "@/lib/types/kline";
import { dbGet, dbGetAll, transact } from "@/lib/saved/db";
import { fetchKlinesRange, fetchLatestKlines, normalizeKlines } from "./kline-fetch";

/** localStorage key of the on/off setting (JSON boolean — shared with useLocalState) */
export const KEEP_BARS_KEY = "klines.keepBars";
/** Newest bars stored per coin + timeframe */
export const MAX_STORED_BARS = 300_000;
/** Measured size of one stored bar (browsers do not report the size of a single record) */
export const BYTES_PER_BAR = 100;

export interface StoredBarsMeta {
  symbol: string;
  interval: string;
  bars: number;
  from: number;
  to: number;
  firstPrice: number;
  lastPrice: number;
  savedAt: number;
}

interface StoredBars {
  symbol: string;
  interval: string;
  /**
   * The block is complete from this time on: the start that was asked for (which can be before the first
   * bar the exchange has), or 0 once the exchange had nothing older.
   */
  coverFrom: number;
  rows: BinanceKlineRaw[];
}

/** How a load was served — shown in the data sheet */
export interface StoreUse {
  /** Bars taken from the local database / downloaded now */
  reused: number;
  fetched: number;
  /** Set when the update failed and the stored bars are shown as they are */
  stale?: string;
}

export function isKeepEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEEP_BARS_KEY) !== "false";
  } catch {
    return false;
  }
}

const toRaw = (k: KlineData): BinanceKlineRaw =>
  [k.openTime, k.open, k.high, k.low, k.close, k.volume, k.closeTime, k.quoteAssetVolume, k.numberOfTrades, k.takerBuyBaseVolume, k.takerBuyQuoteVolume];

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ─── What is stored ──────────────────────────────────────────

/** Every stored coin + timeframe (coin A→Z, then smallest timeframe first) */
export async function listStoredBars(): Promise<StoredBarsMeta[]> {
  const all = await dbGetAll<StoredBarsMeta>("barsMeta");
  const minutes = (m: StoredBarsMeta) => INTERVAL_MINUTES[m.interval as Interval] ?? 0;
  return all.sort((a, b) => a.symbol.localeCompare(b.symbol) || minutes(a) - minutes(b));
}

/** Delete one timeframe of a coin, or (without `interval`) everything stored for the coin */
export async function deleteStoredBars(symbol: string, interval?: string): Promise<void> {
  const key: IDBValidKey | IDBKeyRange = interval ? [symbol, interval] : IDBKeyRange.bound([symbol, ""], [symbol, "￿"]);
  await transact(["bars", "barsMeta"], "readwrite", (s) => { s("bars").delete(key); s("barsMeta").delete(key); });
}

export async function clearStoredBars(): Promise<void> {
  await transact(["bars", "barsMeta"], "readwrite", (s) => { s("bars").clear(); s("barsMeta").clear(); });
}

export interface StorageInfo {
  /** Bytes this site uses / may use in the browser (everything it stores, not only bars) */
  usage: number;
  quota: number;
  /** The browser promised not to clear the data on its own when the disk runs low */
  persisted: boolean;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  try {
    const est = await navigator.storage.estimate();
    if (!est.quota) return null;
    return { usage: est.usage ?? 0, quota: est.quota, persisted: (await navigator.storage.persisted?.()) ?? false };
  } catch {
    return null; // not supported
  }
}

/** Ask the browser to keep the data even when the disk runs low (it may decline) */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ─── Storing ─────────────────────────────────────────────────

const errorListeners = new Set<(msg: string) => void>();
/** Storing happens after the bars are already on screen — failures (quota full…) are reported here */
export function onStoreError(fn: (msg: string) => void): () => void {
  errorListeners.add(fn);
  return () => { errorListeners.delete(fn); };
}

let persistAsked = false;

async function read(symbol: string, interval: string): Promise<{ rows: KlineData[]; coverFrom: number } | null> {
  try {
    const rec = await dbGet<StoredBars>("bars", [symbol, interval]);
    if (!rec || !Array.isArray(rec.rows) || rec.rows.length === 0) return null;
    return { rows: rec.rows.map(parseKline), coverFrom: rec.coverFrom };
  } catch {
    return null; // stored bars are a shortcut — never block loading on them
  }
}

function write(symbol: string, interval: string, all: KlineData[], coverFrom: number) {
  if (all.length === 0) return;
  const rows = all.length > MAX_STORED_BARS ? all.slice(-MAX_STORED_BARS) : all;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const record: StoredBars = { symbol, interval, coverFrom: rows === all ? coverFrom : first.openTime, rows: rows.map(toRaw) };
  const meta: StoredBarsMeta = {
    symbol, interval, bars: rows.length, from: first.openTime, to: last.openTime,
    firstPrice: +first.open, lastPrice: +last.close, savedAt: Date.now(),
  };
  transact(["bars", "barsMeta"], "readwrite", (s) => { s("bars").put(record); s("barsMeta").put(meta); })
    .then(() => {
      // Once there is something worth keeping, ask the browser not to clear it on its own
      if (!persistAsked) { persistAsked = true; void requestPersist(); }
    })
    .catch((err) => {
      const full = err instanceof DOMException && err.name === "QuotaExceededError";
      const msg = full
        ? `เก็บ ${symbol} ${interval} ลงเครื่องไม่ได้ — พื้นที่ของเว็บในเบราว์เซอร์เต็ม ลบเหรียญที่ไม่ใช้ได้ที่หน้า “ที่บันทึกไว้”`
        : `เก็บ ${symbol} ${interval} ลงเครื่องไม่สำเร็จ: ${message(err)}`;
      errorListeners.forEach((fn) => fn(msg));
    });
}

// ─── Loading through the store ───────────────────────────────

/** Latest `limit` bars: stored bars + only what is new since they were stored (+ older bars when more are needed) */
export async function loadLatestStored(
  symbol: string, interval: Interval, limit: number, signal: AbortSignal, onProgress?: (n: number) => void,
): Promise<{ rows: KlineData[]; use: StoreUse }> {
  const tfMs = INTERVAL_MINUTES[interval] * 60_000;
  const hit = await read(symbol, interval);
  const stored = hit?.rows ?? [];
  const last = stored[stored.length - 1];

  // Nothing stored, or it ends before the window that is wanted now → plain download
  if (!hit || (Date.now() - last.openTime) / tfMs >= limit) {
    const rows = normalizeKlines(await fetchLatestKlines(symbol, interval, limit, signal, onProgress));
    write(symbol, interval, rows, rows.length < limit ? 0 : rows[0]?.openTime ?? 0);
    return { rows, use: { reused: 0, fetched: rows.length } };
  }

  onProgress?.(stored.length);
  let merged = stored;
  let coverFrom = hit.coverFrom;
  try {
    // From the last stored bar on: it may still have been forming when it was stored
    const fresh = await fetchKlinesRange(symbol, interval, last.openTime, Date.now() + tfMs, signal);
    merged = normalizeKlines([...stored, ...fresh]);
    if (merged.length < limit && coverFrom > 0) {
      const want = limit - merged.length;
      const older = await fetchLatestKlines(symbol, interval, want, signal, (n) => onProgress?.(merged.length + n), merged[0].openTime - 1);
      merged = normalizeKlines([...older, ...merged]);
      coverFrom = older.length < want ? 0 : merged[0].openTime;
    }
  } catch (err) {
    if (signal.aborted) throw err;
    const rows = merged.slice(-limit);
    return { rows, use: { reused: rows.length, fetched: 0, stale: message(err) } };
  }
  write(symbol, interval, merged, coverFrom);
  const rows = merged.slice(-limit);
  const fetched = Math.min(rows.length, merged.length - stored.length);
  return { rows, use: { reused: rows.length - fetched, fetched } };
}

/** Bars from `start` to `end`: the stored block is extended at whichever end is missing */
export async function loadRangeStored(
  symbol: string, interval: Interval, start: number, end: number, signal: AbortSignal, onProgress?: (n: number) => void,
): Promise<{ rows: KlineData[]; use: StoreUse }> {
  const tfMs = INTERVAL_MINUTES[interval] * 60_000;
  const hit = await read(symbol, interval);
  const stored = hit?.rows ?? [];
  const first = stored[0];
  const last = stored[stored.length - 1];

  // The block must stay contiguous → a range that does not touch it replaces it
  if (!hit || end < first.openTime || start > last.openTime + tfMs) {
    const rows = normalizeKlines(await fetchKlinesRange(symbol, interval, start, end, signal, onProgress));
    write(symbol, interval, rows, start);
    return { rows, use: { reused: 0, fetched: rows.length } };
  }

  onProgress?.(stored.length);
  let merged = stored;
  let coverFrom = hit.coverFrom;
  let stale: string | undefined;
  try {
    if (start < coverFrom) {
      const head = await fetchKlinesRange(symbol, interval, start, first.openTime - 1, signal, (n) => onProgress?.(stored.length + n));
      merged = [...head, ...merged];
      coverFrom = start;
    }
    if (end > last.openTime) {
      const have = merged.length;
      const tail = await fetchKlinesRange(symbol, interval, last.openTime, end, signal, (n) => onProgress?.(have + n));
      merged = [...merged, ...tail];
    }
    merged = normalizeKlines(merged);
    write(symbol, interval, merged, coverFrom);
  } catch (err) {
    if (signal.aborted) throw err;
    stale = message(err);
    merged = normalizeKlines(merged);
  }
  const rows = merged.filter((k) => k.openTime >= start && k.openTime <= end);
  const known = new Set<number>();
  for (const k of stored) known.add(k.openTime);
  const reused = rows.reduce((n, k) => n + (known.has(k.openTime) ? 1 : 0), 0);
  return { rows, use: { reused, fetched: rows.length - reused, stale } };
}

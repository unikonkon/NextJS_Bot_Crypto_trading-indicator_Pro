import { parseKline, type BinanceKlineRaw, type KlineData } from "@/lib/types/kline";

/** Downloading and parsing candlestick bars (no React) — shared by the chart, batch runs and the local cache */
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

/**
 * The latest `limit` bars of `interval`, paging backwards (shared by the chart and multi-coin runs).
 * `before`: only bars that opened at or before this time — to extend bars already held further back.
 */
export async function fetchLatestKlines(
  symbol: string, interval: string, limit: number, signal: AbortSignal, onProgress?: (n: number) => void, before?: number,
): Promise<KlineData[]> {
  const all: KlineData[] = [];
  let endTime = before;
  while (all.length < limit) {
    const want = Math.min(PAGE, limit - all.length);
    const params: Record<string, string> = { symbol, interval, limit: String(want) };
    if (endTime !== undefined) params.endTime = String(endTime);
    const page = await fetchPage(params, signal);
    if (page.length === 0) break;
    all.unshift(...page);
    onProgress?.(all.length);
    if (page.length < want) break;
    endTime = page[0].openTime - 1;
  }
  return all;
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

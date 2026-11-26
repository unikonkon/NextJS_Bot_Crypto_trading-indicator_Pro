import { NextResponse } from "next/server";

const BINANCE_BASE = "https://api.binance.com";
const TTL = 10 * 60_000;

export interface SymbolRow {
  /** Base asset, e.g. "BTC" (pair = base + "USDT") */
  b: string;
  /** 24h quote volume in USDT */
  v: number;
  /** 24h price change % */
  c: number;
  /** Last price */
  p: number;
}

// exchangeInfo is ~18 MB (too big for the fetch cache) → keep the compact result in memory
let cached: { at: number; rows: SymbolRow[] } | null = null;

async function load(): Promise<SymbolRow[]> {
  const [info, tick] = await Promise.all([
    fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?permissions=SPOT&symbolStatus=TRADING`, { cache: "no-store" }),
    fetch(`${BINANCE_BASE}/api/v3/ticker/24hr`, { cache: "no-store" }),
  ]);
  if (!info.ok) throw new Error(`exchangeInfo ${info.status}`);
  if (!tick.ok) throw new Error(`ticker ${tick.status}`);
  const { symbols } = (await info.json()) as { symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] };
  const tickers = (await tick.json()) as { symbol: string; quoteVolume: string; priceChangePercent: string; lastPrice: string }[];
  const bySym = new Map(tickers.map((t) => [t.symbol, t]));
  return symbols
    .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING")
    .map((s) => {
      const t = bySym.get(s.symbol);
      return { b: s.baseAsset, v: t ? +t.quoteVolume : 0, c: t ? +t.priceChangePercent : 0, p: t ? +t.lastPrice : 0 };
    })
    .sort((a, b) => b.v - a.v);
}

/** Binance spot USDT pairs that are trading now, with 24h volume / change (cached 10 min) */
export async function GET() {
  try {
    if (!cached || Date.now() - cached.at > TTL) cached = { at: Date.now(), rows: await load() };
    return NextResponse.json({ updated: cached.at, symbols: cached.rows });
  } catch (err) {
    // Serve a stale list rather than nothing
    if (cached) return NextResponse.json({ updated: cached.at, symbols: cached.rows, stale: true });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { errorMessage, publicGet, type Market } from "@/lib/binance/server";

/** Trading rules of one symbol — used to round quantities before sending an order */
export interface SymbolRules {
  market: Market;
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  /** Quantity rules for MARKET orders */
  stepSize: string;
  minQty: string;
  maxQty: string;
  /** Minimum order value in the quote asset (0 = unknown) */
  minNotional: number;
  tickSize: string;
}

interface RawFilter {
  filterType: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
  notional?: string;
  tickSize?: string;
}

interface RawSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: RawFilter[];
}

export async function GET(request: NextRequest) {
  const market: Market = request.nextUrl.searchParams.get("market") === "futures" ? "futures" : "spot";
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{3,30}$/.test(symbol)) return NextResponse.json({ error: "symbol ไม่ถูกต้อง" }, { status: 400 });

  try {
    const r = market === "spot"
      ? await publicGet("spot", "/api/v3/exchangeInfo", { symbol })
      : await publicGet("futures", "/fapi/v1/exchangeInfo");
    if (!r.ok) return NextResponse.json({ error: "ดึงกฎการเทรดไม่สำเร็จ", details: r.data }, { status: r.status });

    const list = ((r.data as { symbols?: RawSymbol[] }).symbols ?? []);
    const s = list.find((x) => x.symbol === symbol);
    if (!s) {
      return NextResponse.json(
        { error: market === "futures" ? `ไม่มีคู่ ${symbol} ในตลาด Futures` : `ไม่มีคู่ ${symbol} ในตลาด Spot` },
        { status: 404 },
      );
    }
    const f = (type: string) => s.filters.find((x) => x.filterType === type);
    // MARKET orders use MARKET_LOT_SIZE when it is set, else LOT_SIZE
    const lot = f("LOT_SIZE");
    const mlot = f("MARKET_LOT_SIZE");
    const useMarketLot = mlot && parseFloat(mlot.stepSize ?? "0") > 0;
    const lotOf = useMarketLot ? mlot : lot;
    const notional = f("NOTIONAL") ?? f("MIN_NOTIONAL");
    const rules: SymbolRules = {
      market,
      symbol: s.symbol,
      status: s.status,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      stepSize: lotOf?.stepSize ?? "0.00000001",
      minQty: lotOf?.minQty ?? "0",
      maxQty: lotOf?.maxQty ?? "0",
      minNotional: parseFloat(notional?.minNotional ?? notional?.notional ?? "0") || 0,
      tickSize: f("PRICE_FILTER")?.tickSize ?? "0.01",
    };
    return NextResponse.json(rules, { headers: { "Cache-Control": "public, s-maxage=300" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

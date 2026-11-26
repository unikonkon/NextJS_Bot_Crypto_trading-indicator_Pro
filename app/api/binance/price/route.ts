import { NextRequest, NextResponse } from "next/server";
import { errorMessage, publicGet, type Market } from "@/lib/binance/server";

/** Last price of one symbol: ?symbol=BTCUSDT[&market=futures] */
export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const market: Market = request.nextUrl.searchParams.get("market") === "futures" ? "futures" : "spot";

  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  try {
    const r = market === "futures"
      ? await publicGet("futures", "/fapi/v1/ticker/price", { symbol })
      : await publicGet("spot", "/api/v3/ticker/price", { symbol });
    const data = r.data as { symbol?: string; price?: string; msg?: string };
    if (!r.ok) {
      return NextResponse.json({ error: data.msg || "Failed to fetch price", details: data }, { status: r.status });
    }
    return NextResponse.json({ symbol: data.symbol, price: data.price });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

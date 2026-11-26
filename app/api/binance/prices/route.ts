import { NextRequest, NextResponse } from "next/server";
import { errorMessage, publicGet } from "@/lib/binance/server";

/**
 * Spot prices of several assets against USDT in one call: ?assets=BTC,ETH,BNB
 * Returns { BTC: 65000.1, ... } — assets without a USDT pair are left out.
 */
export async function GET(request: NextRequest) {
  const assets = (request.nextUrl.searchParams.get("assets") ?? "")
    .split(",")
    .map((a) => a.trim().toUpperCase())
    .filter((a) => /^[A-Z0-9]{1,20}$/.test(a));
  if (!assets.length) return NextResponse.json({});

  try {
    const r = await publicGet("spot", "/api/v3/ticker/price");
    if (!r.ok) return NextResponse.json({ error: "ดึงราคาไม่สำเร็จ", details: r.data }, { status: r.status });
    const all = new Map((r.data as { symbol: string; price: string }[]).map((t) => [t.symbol, parseFloat(t.price)]));
    const out: Record<string, number> = {};
    for (const a of assets) {
      if (a === "USDT") out[a] = 1;
      else if (all.has(`${a}USDT`)) out[a] = all.get(`${a}USDT`)!;
    }
    return NextResponse.json(out, { headers: { "Cache-Control": "public, s-maxage=5" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

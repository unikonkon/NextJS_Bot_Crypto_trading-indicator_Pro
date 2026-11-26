import { NextRequest, NextResponse } from "next/server";
import { credsOf, errorMessage, signedRequest } from "@/lib/binance/server";

/**
 * USDⓈ-M Futures — one endpoint, several actions (POST JSON with apiKey/secretKey + action):
 *   account   → wallet / available balance + open positions
 *   position  → position of one symbol (positionAmt > 0 long, < 0 short)
 *   prepare   → set leverage + margin type for a symbol, check One-way mode
 *   order     → MARKET order (quantity), optional reduceOnly, test = validate only
 */

interface Body {
  action?: string;
  symbol?: string;
  leverage?: number;
  marginType?: "ISOLATED" | "CROSSED";
  side?: "BUY" | "SELL";
  quantity?: string;
  reduceOnly?: boolean;
  test?: boolean;
}

const fail = (error: string, status: number, details?: unknown) => NextResponse.json({ error, details }, { status });

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => ({}));
  const creds = credsOf(raw);
  if (!creds) return fail("API Key หรือ Secret Key ไม่ได้ตั้งค่า", 400);
  const body = raw as Body;
  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
  const call = (method: "GET" | "POST", path: string, params?: Record<string, string | number | boolean | undefined>) =>
    signedRequest({ market: "futures", method, path, params, ...creds });

  try {
    switch (body.action) {
      case "account": {
        const r = await call("GET", "/fapi/v3/account");
        if (!r.ok) return fail("ดึงบัญชี Futures ไม่สำเร็จ", r.status, r.data);
        const d = r.data as {
          totalWalletBalance?: string; availableBalance?: string; totalUnrealizedProfit?: string;
          assets?: { asset: string; walletBalance: string; availableBalance: string }[];
          positions?: { symbol: string; positionAmt: string; unrealizedProfit: string; positionSide: string }[];
        };
        return NextResponse.json({
          totalWalletBalance: parseFloat(d.totalWalletBalance ?? "0"),
          availableBalance: parseFloat(d.availableBalance ?? "0"),
          totalUnrealizedProfit: parseFloat(d.totalUnrealizedProfit ?? "0"),
          assets: (d.assets ?? []).filter((a) => parseFloat(a.walletBalance) !== 0),
          positions: (d.positions ?? []).filter((p) => parseFloat(p.positionAmt) !== 0),
        });
      }

      case "position": {
        if (!symbol) return fail("ต้องระบุ symbol", 400);
        const r = await call("GET", "/fapi/v3/positionRisk", { symbol });
        if (!r.ok) return fail("ดึงสถานะ Futures ไม่สำเร็จ", r.status, r.data);
        const list = r.data as { symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string; leverage?: string }[];
        const p = list.find((x) => x.symbol === symbol && parseFloat(x.positionAmt) !== 0);
        return NextResponse.json({
          symbol,
          positionAmt: p ? parseFloat(p.positionAmt) : 0,
          entryPrice: p ? parseFloat(p.entryPrice) : 0,
          unrealizedProfit: p ? parseFloat(p.unRealizedProfit) : 0,
        });
      }

      case "prepare": {
        if (!symbol) return fail("ต้องระบุ symbol", 400);
        const notes: string[] = [];
        // Hedge mode needs positionSide on every order — the bot only supports One-way mode
        const mode = await call("GET", "/fapi/v1/positionSide/dual");
        if (!mode.ok) return fail("ตรวจโหมดตำแหน่ง Futures ไม่สำเร็จ", mode.status, mode.data);
        if ((mode.data as { dualSidePosition?: boolean }).dualSidePosition) {
          return fail("บัญชี Futures เปิดโหมด Hedge อยู่ — บอทรองรับเฉพาะ One-way Mode (ตั้งค่าใน Binance Futures → Preferences → Position Mode)", 400);
        }
        const marginType = body.marginType === "CROSSED" ? "CROSSED" : "ISOLATED";
        const mt = await call("POST", "/fapi/v1/marginType", { symbol, marginType });
        const mtCode = (mt.data as { code?: number }).code;
        if (!mt.ok && mtCode !== -4046) {
          // -4046 = already this type; -4048 = cannot change while a position / order is open
          notes.push(`เปลี่ยน Margin Type ไม่ได้: ${(mt.data as { msg?: string }).msg ?? mt.status}`);
        }
        const leverage = Math.max(1, Math.min(125, Math.round(Number(body.leverage) || 1)));
        const lv = await call("POST", "/fapi/v1/leverage", { symbol, leverage });
        if (!lv.ok) return fail("ตั้ง Leverage ไม่สำเร็จ", lv.status, lv.data);
        const d = lv.data as { leverage: number; maxNotionalValue?: string };
        return NextResponse.json({ leverage: d.leverage, maxNotionalValue: d.maxNotionalValue, marginType, notes });
      }

      case "order": {
        if (!symbol) return fail("ต้องระบุ symbol", 400);
        if (body.side !== "BUY" && body.side !== "SELL") return fail("side ต้องเป็น BUY หรือ SELL", 400);
        if (!body.quantity || !(parseFloat(body.quantity) > 0)) return fail("quantity ต้องมากกว่า 0", 400);
        const path = body.test ? "/fapi/v1/order/test" : "/fapi/v1/order";
        const r = await call("POST", path, {
          symbol,
          side: body.side,
          type: "MARKET",
          quantity: body.quantity,
          reduceOnly: body.reduceOnly ? true : undefined,
          newOrderRespType: "RESULT",
        });
        if (!r.ok) return fail("ส่งคำสั่ง Futures ไม่สำเร็จ", r.status, r.data);
        return NextResponse.json(r.data);
      }

      default:
        return fail("action ไม่ถูกต้อง", 400);
    }
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}

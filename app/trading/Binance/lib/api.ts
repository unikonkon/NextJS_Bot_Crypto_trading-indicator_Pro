/**
 * Browser-side calls to our /api/binance/* routes. Keys live only in memory and are sent per request.
 */
import type { SymbolRules } from "@/app/api/binance/exchange-info/route";
import type { Market } from "@/lib/trading/live";

export type { SymbolRules };

export interface Creds {
  apiKey: string;
  secretKey: string;
}

export interface Balance {
  asset: string;
  free: string;
  locked: string;
}

export interface OpenOrder {
  symbol: string;
  orderId: number;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty?: string;
  status: string;
  time: number;
}

export interface TradeHistory {
  symbol: string;
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

export interface FuturesAccount {
  totalWalletBalance: number;
  availableBalance: number;
  totalUnrealizedProfit: number;
  assets: { asset: string; walletBalance: string; availableBalance: string }[];
  positions: { symbol: string; positionAmt: string; unrealizedProfit: string; positionSide: string }[];
}

/** Error with Binance's code / message attached */
export class ApiError extends Error {
  constructor(message: string, public code?: number, public details?: unknown) {
    super(message);
  }
}

const CODE_HINTS: Record<number, string> = {
  [-2015]: "API Key ไม่ถูกต้อง, IP ไม่อยู่ใน whitelist หรือยังไม่ได้เปิดสิทธิ์ที่ต้องใช้",
  [-2014]: "รูปแบบ API Key ไม่ถูกต้อง",
  [-1022]: "Signature ไม่ถูกต้อง — ตรวจสอบ Secret Key",
  [-1021]: "เวลาเครื่องไม่ตรงกับ Binance — ซิงค์นาฬิกาเครื่องแล้วลองใหม่",
  [-2010]: "ยอดคงเหลือไม่พอ",
  [-2019]: "Margin ไม่พอสำหรับคำสั่งนี้",
  [-1121]: "ไม่มีคู่เทรดนี้",
  [-1013]: "จำนวน/มูลค่าไม่ผ่านกฎของคู่เทรด (ขั้นต่ำ, step size)",
  [-4164]: "มูลค่าคำสั่งต่ำกว่าขั้นต่ำของ Futures — เพิ่มจำนวนเงินหรือ Leverage",
  [-2022]: "ไม่มีสถานะให้ปิด (ReduceOnly ถูกปฏิเสธ)",
};

/** Thai explanation for a Binance error code (empty when unknown) */
export function hintFor(code?: number): string {
  return code !== undefined ? CODE_HINTS[code] ?? "" : "";
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const det = (data as { details?: { code?: number; msg?: string } }).details;
    const msg = det?.msg || (data as { error?: string }).error || `HTTP ${res.status}`;
    throw new ApiError(msg, det?.code, det);
  }
  return data as T;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  spotAccount: (c: Creds) => post<{ balances: Balance[]; permissions: string[] }>("/api/binance/account", c),
  futuresAccount: (c: Creds) => post<FuturesAccount>("/api/binance/futures", { ...c, action: "account" }),
  futuresPosition: (c: Creds, symbol: string) =>
    post<{ positionAmt: number; entryPrice: number; unrealizedProfit: number }>("/api/binance/futures", { ...c, action: "position", symbol }),
  futuresPrepare: (c: Creds, symbol: string, leverage: number) =>
    post<{ leverage: number; marginType: string; notes: string[] }>("/api/binance/futures", { ...c, action: "prepare", symbol, leverage, marginType: "ISOLATED" }),
  futuresOrder: (c: Creds, o: { symbol: string; side: "BUY" | "SELL"; quantity: string; reduceOnly?: boolean; test: boolean }) =>
    post<{ orderId?: number; avgPrice?: string; executedQty?: string; status?: string }>("/api/binance/futures", { ...c, action: "order", ...o }),
  spotOrder: (c: Creds, o: {
    symbol: string; side: "BUY" | "SELL"; type: "MARKET" | "LIMIT"; quantity?: string; quoteOrderQty?: string; price?: string; testOrder: boolean;
  }) => post<SpotOrderResult>("/api/binance/order", { ...c, ...o }),
  openOrders: (c: Creds) => post<OpenOrder[]>("/api/binance/order/open", c),
  cancelOrder: (c: Creds, symbol: string, orderId: number) => post<unknown>("/api/binance/order/cancel", { ...c, symbol, orderId }),
  trades: (c: Creds, symbol: string, limit: number) => post<TradeHistory[]>("/api/binance/trades", { ...c, symbol, limit }),
  rules: (market: Market, symbol: string) => get<SymbolRules>(`/api/binance/exchange-info?market=${market}&symbol=${encodeURIComponent(symbol)}`),
  price: async (market: Market, symbol: string) =>
    parseFloat((await get<{ price: string }>(`/api/binance/price?market=${market}&symbol=${encodeURIComponent(symbol)}`)).price),
  prices: (assets: string[]) => get<Record<string, number>>(`/api/binance/prices?assets=${assets.map(encodeURIComponent).join(",")}`),
};

export interface SpotOrderResult {
  symbol?: string;
  orderId?: number;
  status?: string;
  side?: string;
  type?: string;
  origQty?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
  fills?: { price: string; qty: string; commission: string; commissionAsset: string }[];
}

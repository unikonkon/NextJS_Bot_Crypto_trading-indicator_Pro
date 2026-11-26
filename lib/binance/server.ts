/**
 * Server-only helpers for calling Binance (Spot + USDⓈ-M Futures).
 * Keys are passed per request from the browser and never stored.
 */
import { buildSignedParams } from "@/lib/binanceSign";

export type Market = "spot" | "futures";

export const BINANCE_BASE: Record<Market, string> = {
  spot: "https://api.binance.com",
  futures: "https://fapi.binance.com",
};

export interface BinanceReply {
  ok: boolean;
  status: number;
  data: unknown;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Binance ตอบกลับไม่ใช่ JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Signed request: params go in the query string for GET/DELETE and in the body for POST */
export async function signedRequest(opts: {
  market: Market;
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  apiKey: string;
  secretKey: string;
}): Promise<BinanceReply> {
  const clean: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v === undefined || v === "") continue;
    clean[k] = typeof v === "boolean" ? String(v) : v;
  }
  clean.timestamp = Date.now();
  clean.recvWindow = 5000;
  const signed = buildSignedParams(clean, opts.secretKey);
  const base = BINANCE_BASE[opts.market];
  const isBody = opts.method === "POST";
  const res = await fetch(isBody ? `${base}${opts.path}` : `${base}${opts.path}?${signed}`, {
    method: opts.method,
    headers: {
      "X-MBX-APIKEY": opts.apiKey,
      ...(isBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: isBody ? signed : undefined,
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, data: await readJson(res) };
}

export async function publicGet(market: Market, path: string, params: Record<string, string> = {}): Promise<BinanceReply> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BINANCE_BASE[market]}${path}${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  return { ok: res.ok, status: res.status, data: await readJson(res) };
}

/** Reads apiKey / secretKey from a JSON body; null when missing */
export function credsOf(body: unknown): { apiKey: string; secretKey: string } | null {
  const b = body as { apiKey?: unknown; secretKey?: unknown } | null;
  if (!b || typeof b.apiKey !== "string" || typeof b.secretKey !== "string" || !b.apiKey || !b.secretKey) return null;
  return { apiKey: b.apiKey, secretKey: b.secretKey };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "เชื่อมต่อ Binance ไม่ได้";
}

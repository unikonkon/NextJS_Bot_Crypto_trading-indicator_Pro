/**
 * Live evaluation — runs exactly the same engine as /klines on the latest *closed* candles and
 * reports the position the backtest holds right now. The bot trades only when that target changes.
 *
 * A flat synthetic bar at the current price is appended after the last closed candle so that a
 * "next open" order decided at the last close is included (it would be filled now, live).
 * Indicators are computed on closed candles only, so the candle in progress never repaints a signal.
 */
import { atr, toBars } from "@/lib/engine/math";
import { runBacktest, runExposure } from "@/lib/engine/backtest";
import { htfTrend, normalizeHtf } from "@/lib/engine/htf";
import {
  engineOf, getIndicator, htfApplies, htfIndicator, htfIndicatorWarmup, normalizeParams, planRun, warmupOf,
} from "@/lib/engine/registry";
import { INTERVAL_MINUTES, parseKline, type BinanceKlineRaw, type Interval, type KlineData } from "@/lib/types/kline";
import type { BacktestConfig, BacktestResult, IndicatorDef, Params, Side, StopRule, TradeMode } from "@/lib/engine/types";
import type { BotPreset } from "./presets";

export type Market = "spot" | "futures";

/** Bars evaluated after the warm-up — the backtest state the bot follows is built over this window */
export const LIVE_EVAL_BARS = 500;
/** Upper bound of candles fetched per evaluation */
export const LIVE_MAX_BARS = 10_000;

export interface LiveEval {
  /** Position the strategy holds now (after a next-open order decided at the last close) */
  target: Side | null;
  /** Open time of the last closed candle that was evaluated */
  lastClosedTime: number;
  lastClose: number;
  /** Most recent raw signal of the strategy among closed candles */
  lastSignal: { dir: 1 | -1; time: number; barsAgo: number } | null;
  /** Strategy's own explanation at the last closed candle (v2–v6) */
  reason: string | null;
  /** Higher-timeframe filter state at the last closed candle: +1 long only, −1 short only, 0 unknown, null off */
  htfState: number | null;
  htfLabel: string | null;
  /** Backtest of the evaluated window, to show next to live results */
  windowReturnPct: number;
  windowTrades: number;
  /** Entry of the position the backtest holds (when target ≠ null) */
  heldSince: { time: number; price: number } | null;
  /** ATR(14) of the last closed candle (for ATR stops) */
  atr: number | null;
  bars: number;
  warmup: number;
}

/** Trade direction the preset uses on this market (Spot cannot short) */
export function presetDirection(p: BotPreset): TradeMode {
  const def = getIndicator(p.indicatorId);
  if (!def) return p.config.mode;
  const params = normalizeParams(def, p.params);
  const eng = engineOf(def, params);
  return eng.kind === "exposure" ? eng.direction : p.config.mode;
}

/** Why a preset cannot run on a market (null = OK) */
export function presetBlocker(p: BotPreset, market: Market): string | null {
  const def = getIndicator(p.indicatorId);
  if (!def) return `ไม่พบ indicator "${p.indicatorName}" ในระบบแล้ว`;
  const params = normalizeParams(def, p.params);
  const invalid = def.validate?.(params);
  if (invalid) return invalid;
  if (market === "spot" && presetDirection(p) === "short") {
    return "กลยุทธ์นี้เทรดเฉพาะขาลง (Short) — Spot เปิด Short ไม่ได้ ให้เลือกตลาด Futures";
  }
  return null;
}

/** Candles to fetch for this preset: warm-up + evaluation window */
export function barsNeeded(def: IndicatorDef, params: Params, interval: Interval): { total: number; warmup: number; capped: boolean } {
  const warmup = warmupOf(def, params, INTERVAL_MINUTES[interval] ?? 60);
  const want = warmup + LIVE_EVAL_BARS + 2;
  return { total: Math.min(LIVE_MAX_BARS, want), warmup, capped: want > LIVE_MAX_BARS };
}

/** Spot can only hold Long: run the signal engine long-only so the backtest state matches what is traded */
function configFor(p: BotPreset, market: Market): BacktestConfig {
  const cfg: BacktestConfig = { ...p.config, htf: normalizeHtf(p.config.htf) };
  if (market === "spot" && cfg.mode === "both") cfg.mode = "long";
  return cfg;
}

export function evaluateLive(input: {
  preset: BotPreset;
  market: Market;
  /** Closed candles, oldest first */
  closed: KlineData[];
  /** Price the next-open fill would happen at (open of the candle in progress, else last close) */
  nowPrice: number;
  /** Higher-timeframe candles for the trend filter (null when the filter is off) */
  htfKlines: KlineData[] | null;
}): LiveEval {
  const { preset, market, closed } = input;
  const def = getIndicator(preset.indicatorId);
  if (!def) throw new Error(`ไม่พบ indicator ${preset.indicatorName}`);
  const params = normalizeParams(def, preset.params);
  const invalid = def.validate?.(params);
  if (invalid) throw new Error(invalid);
  const cfg = configFor(preset, market);

  const bars = toBars(closed);
  const n = bars.length;
  const { ctx, warmup } = planRun(def, params, bars, LIVE_EVAL_BARS);
  if (n - ctx.startIndex < 30) {
    throw new Error(`ข้อมูลไม่พอ: ต้องอุ่นเครื่อง ${warmup.toLocaleString()} แท่ง + ประเมินอย่างน้อย 30 แท่ง (มี ${n.toLocaleString()})`);
  }

  // Trend filter on the higher timeframe (closed candles only)
  let regime: Int8Array | null = null;
  let htfLabel: string | null = null;
  if (htfApplies(cfg.htf, ctx.tfMinutes)) {
    const h = htfIndicator(cfg.htf);
    htfLabel = `${h.def.name} ${h.filter.interval}`;
    if (!input.htfKlines?.length) throw new Error(`ยังไม่มีข้อมูล ${h.filter.interval} สำหรับตัวกรองเทรนด์`);
    regime = htfTrend(bars, toBars(input.htfKlines), h.def, h.params, h.filter.interval, ctx.tfMinutes, {
      warmup: htfIndicatorWarmup(h.def, h.params, h.filter.interval),
    }).regime;
  }

  const r = def.compute(bars, params, ctx);
  const reasons = def.reasons?.(r, params) ?? null;

  // Extended series: closed candles + one flat candle at the current price
  const last = closed[n - 1];
  const tfMs = Math.max(1, ctx.tfMinutes) * 60_000;
  const p = String(input.nowPrice);
  const synth: KlineData = {
    ...last, openTime: last.openTime + tfMs, closeTime: last.closeTime + tfMs,
    open: p, high: p, low: p, close: p, volume: "0", quoteAssetVolume: "0", numberOfTrades: 0, takerBuyBaseVolume: "0", takerBuyQuoteVolume: "0",
  };
  const ext = toBars([...closed, synth]);
  const extRegime = regime ? Int8Array.from([...regime, regime[n - 1]]) : null;
  const extReasons = reasons ? [...reasons, null] : null;
  const htf = regime ? cfg.htf : null;

  const engine = engineOf(def, params);
  let res: BacktestResult;
  if (engine.kind === "exposure") {
    if (!def.exposure) throw new Error(`${def.id}: exposure() missing`);
    const out = def.exposure(r, bars, params);
    res = runExposure(ext, {
      exposure: [...out.exposure, out.exposure[n - 1] ?? 0],
      exitFill: out.exitFill ? [...out.exitFill, null] : undefined,
    }, cfg, engine.direction, {
      startIndex: ctx.startIndex, reasons: extReasons, warmupBars: warmup, fill: engine.fill ?? "nextOpen", regime: extRegime, htf,
    });
  } else {
    const sig = def.signals(r, bars, params);
    const extSig = new Int8Array(n + 1);
    extSig.set(sig.subarray ? sig.subarray(0, n) : Array.from(sig).slice(0, n));
    const fill = cfg.fill === "auto" ? def.defaultFill ?? "close" : cfg.fill;
    res = runBacktest(ext, extSig, cfg, {
      startIndex: ctx.startIndex, fill, reasons: extReasons, warmupBars: warmup, regime: extRegime, htf,
    });
  }

  let lastSignal: LiveEval["lastSignal"] = null;
  for (let i = n - 1; i >= ctx.startIndex; i--) {
    const s = res.signals[i];
    if (s === 1 || s === -1) { lastSignal = { dir: s, time: bars.time[i], barsAgo: n - 1 - i }; break; }
  }
  const held = res.openSide ? res.trades[res.trades.length - 1] : null;
  const atrArr = atr(closed, 14);

  return {
    target: res.openSide,
    lastClosedTime: last.openTime,
    lastClose: +last.close,
    lastSignal,
    reason: reasons?.[n - 1] ?? null,
    htfState: regime ? regime[n - 1] : null,
    htfLabel,
    windowReturnPct: res.totalReturnPct,
    windowTrades: res.totalTrades,
    heldSince: held && held.exitReason === "end" ? { time: held.entryTime, price: held.entryPrice } : null,
    atr: atrArr[n - 1] ?? null,
    bars: n,
    warmup,
  };
}

// ─── Stops checked live between candle closes ────────────────
export interface LiveStops {
  sl: number | null;
  tp: number | null;
  /** Trailing distance: % of the best price, or an absolute ATR distance */
  trail: { kind: "pct" | "atr"; value: number } | null;
}

function dist(rule: StopRule, price: number, atrNow: number | null): number | null {
  if (rule.kind === "none" || !(rule.value > 0)) return null;
  if (rule.kind === "pct") return (price * rule.value) / 100;
  return atrNow == null ? null : atrNow * rule.value;
}

/** Stop-loss / take-profit / trailing levels for a position opened at `entry` (signal strategies only) */
export function stopsFor(cfg: BacktestConfig, side: Side, entry: number, atrNow: number | null): LiveStops {
  const sign = side === "long" ? 1 : -1;
  const sl = dist(cfg.stopLoss, entry, atrNow);
  const tp = dist(cfg.takeProfit, entry, atrNow);
  const t = cfg.trailing;
  let trail: LiveStops["trail"] = null;
  if (t.kind === "pct" && t.value > 0) trail = { kind: "pct", value: t.value };
  else if (t.kind === "atr" && t.value > 0 && atrNow != null) trail = { kind: "atr", value: atrNow * t.value };
  return { sl: sl === null ? null : entry - sign * sl, tp: tp === null ? null : entry + sign * tp, trail };
}

export function trailLevel(stops: LiveStops, side: Side, extreme: number): number | null {
  const t = stops.trail;
  if (!t) return null;
  if (t.kind === "pct") return side === "long" ? extreme * (1 - t.value / 100) : extreme * (1 + t.value / 100);
  return side === "long" ? extreme - t.value : extreme + t.value;
}

/** Which stop the current price has touched (null = none) */
export function stopHit(stops: LiveStops, side: Side, extreme: number, price: number): "stopLoss" | "takeProfit" | "trailing" | null {
  const tl = trailLevel(stops, side, extreme);
  if (side === "long") {
    if (stops.sl !== null && price <= stops.sl) return "stopLoss";
    if (tl !== null && price <= tl) return "trailing";
    if (stops.tp !== null && price >= stops.tp) return "takeProfit";
  } else {
    if (stops.sl !== null && price >= stops.sl) return "stopLoss";
    if (tl !== null && price >= tl) return "trailing";
    if (stops.tp !== null && price <= stops.tp) return "takeProfit";
  }
  return null;
}

export function usesLiveStops(cfg: BacktestConfig, def: IndicatorDef | undefined, params: Params): boolean {
  if (!def || engineOf(def, params).kind === "exposure") return false;
  return [cfg.stopLoss, cfg.takeProfit, cfg.trailing].some((r) => r.kind !== "none" && r.value > 0);
}

// ─── Quantities ──────────────────────────────────────────────
function decimalsOf(step: string): number {
  const s = step.includes("e-") ? Number(step).toFixed(20) : step;
  const frac = s.split(".")[1] ?? "";
  const trimmed = frac.replace(/0+$/, "");
  return trimmed.length;
}

/** Round down to the exchange step size, as a string Binance accepts */
export function floorToStep(qty: number, step: string): string {
  const st = parseFloat(step);
  if (!(st > 0) || !(qty > 0)) return "0";
  const d = decimalsOf(step);
  const units = Math.floor(qty / st + 1e-9);
  return (units * st).toFixed(d);
}

// ─── Candles (client-side, through /api/klines) ──────────────
const PAGE = 1000;

async function fetchPage(params: Record<string, string>, signal?: AbortSignal): Promise<KlineData[]> {
  const res = await fetch(`/api/klines?${new URLSearchParams(params)}`, { signal, cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `ดึงแท่งเทียนไม่สำเร็จ (HTTP ${res.status})`);
  }
  return ((await res.json()) as BinanceKlineRaw[]).map(parseKline);
}

/** Latest `total` candles (including the one in progress), oldest first */
export async function fetchLatest(symbol: string, interval: string, total: number, signal?: AbortSignal): Promise<KlineData[]> {
  const all: KlineData[] = [];
  let endTime: number | undefined;
  while (all.length < total) {
    const want = Math.min(PAGE, total - all.length);
    const params: Record<string, string> = { symbol, interval, limit: String(want) };
    if (endTime !== undefined) params.endTime = String(endTime);
    const page = await fetchPage(params, signal);
    if (!page.length) break;
    all.unshift(...page);
    if (page.length < want) break;
    endTime = page[0].openTime - 1;
  }
  return all;
}

/** Merge newer candles into a cached list (same openTime → replaced), keep the last `keep` */
export function mergeCandles(base: KlineData[], fresh: KlineData[], keep: number): KlineData[] {
  const map = new Map<number, KlineData>();
  for (const k of base) map.set(k.openTime, k);
  for (const k of fresh) map.set(k.openTime, k);
  const out = [...map.values()].sort((a, b) => a.openTime - b.openTime);
  return out.length > keep ? out.slice(out.length - keep) : out;
}

/** Split into closed candles and the one still in progress */
export function splitClosed(rows: KlineData[], now = Date.now()): { closed: KlineData[]; forming: KlineData | null } {
  if (!rows.length) return { closed: [], forming: null };
  const last = rows[rows.length - 1];
  // 1.5 s margin for clock differences with the exchange
  if (last.closeTime >= now - 1500) return { closed: rows.slice(0, -1), forming: last };
  return { closed: rows, forming: null };
}

export const INTERVAL_MS = (i: Interval) => (INTERVAL_MINUTES[i] ?? 60) * 60_000;

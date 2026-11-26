"use client";

/**
 * Trading bot that runs in this browser tab.
 *
 * Every candle close it runs the strategy preset (same engine as /klines) on the latest closed candles and
 * reads the position the backtest holds now ("target"). It trades only when the target *changes*:
 *   flat → long   : open Long        long → flat  : close
 *   flat → short  : open Short (Futures only)    long → short: close, then open Short …
 * On start it waits for the next change (it never buys in the middle of a move).
 * Between candle closes it checks the price against stop-loss / take-profit / trailing (signal strategies).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getIndicator, htfApplies, htfIndicator, htfWarmupBars, normalizeParams } from "@/lib/engine/registry";
import { normalizeHtf } from "@/lib/engine/htf";
import { HTF_MINUTES, type Side } from "@/lib/engine/types";
import type { KlineData } from "@/lib/types/kline";
import type { BotPreset } from "@/lib/trading/presets";
import {
  INTERVAL_MS, barsNeeded, evaluateLive, fetchLatest, floorToStep, mergeCandles, presetBlocker, splitClosed,
  stopHit, stopsFor, trailLevel, usesLiveStops, type LiveEval, type LiveStops, type Market,
} from "@/lib/trading/live";
import { ApiError, api, hintFor, type Creds, type SymbolRules } from "./api";

export interface BotSettings {
  presetId: string | null;
  market: Market;
  /** USDT per trade (on Futures: margin; position value = amount × leverage) */
  amountUsdt: number;
  leverage: number;
  /** true = orders are only validated by Binance (/order/test), nothing is bought */
  test: boolean;
  /** How often the price is checked between candle closes (seconds) */
  pollSec: number;
}

export interface BotPosition {
  side: Side;
  /** Base-asset quantity the bot holds */
  qty: string;
  entryPrice: number;
  entryTime: number;
  /** Best price since entry (trailing stop) */
  extreme: number;
  stops: LiveStops | null;
  test: boolean;
  market: Market;
  symbol: string;
  presetId: string;
}

export interface BotTrade {
  id: string;
  side: Side;
  symbol: string;
  market: Market;
  test: boolean;
  qty: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  /** % before fees (× leverage on Futures = return on margin) */
  pnlPct: number;
  pnlUsdt: number;
  reason: CloseReason;
}

export type LogKind = "info" | "signal" | "open" | "close" | "warn" | "error";
export interface BotLog {
  id: string;
  time: number;
  kind: LogKind;
  text: string;
  detail?: string;
}

export type CloseReason = "signal" | "stopLoss" | "takeProfit" | "trailing" | "manual" | "sync";
export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  signal: "กลยุทธ์สั่งปิด",
  stopLoss: "ชน Stop Loss",
  takeProfit: "ชน Take Profit",
  trailing: "ชน Trailing Stop",
  manual: "ปิดด้วยมือ",
  sync: "ปรับให้ตรงกับกลยุทธ์",
};

export type BotPhase = "stopped" | "starting" | "waiting" | "holding";

interface Persisted {
  settings: BotSettings;
  position: BotPosition | null;
  logs: BotLog[];
  trades: BotTrade[];
}

const STORE_KEY = "trading.bot";
const MAX_LOGS = 200;
const MAX_TRADES = 200;

export const DEFAULT_SETTINGS: BotSettings = {
  presetId: null,
  market: "spot",
  amountUsdt: 20,
  leverage: 1,
  test: true,
  pollSec: 15,
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sideLabel = (s: Side | null) => (s === "long" ? "Long (ถือขึ้น)" : s === "short" ? "Short (ถือลง)" : "ว่าง (ไม่ถือ)");

function readStore(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function errText(err: unknown): { text: string; detail?: string } {
  if (err instanceof ApiError) {
    const hint = hintFor(err.code);
    return { text: hint || err.message, detail: hint ? `${err.message}${err.code !== undefined ? ` (code ${err.code})` : ""}` : err.code !== undefined ? `code ${err.code}` : undefined };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

export function useBot(opts: { creds: Creds | null; presets: BotPreset[] }) {
  const { creds, presets } = opts;

  // ─── Persisted state ─────────────────────────────────────
  const [settings, setSettingsState] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [position, setPositionState] = useState<BotPosition | null>(null);
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [trades, setTrades] = useState<BotTrade[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const s = readStore();
    if (s) {
      setSettingsState({ ...DEFAULT_SETTINGS, ...s.settings });
      setPositionState(s.position ?? null);
      setLogs(Array.isArray(s.logs) ? s.logs : []);
      setTrades(Array.isArray(s.trades) ? s.trades : []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ settings, position, logs, trades } satisfies Persisted));
    } catch {
      /* ignore */
    }
  }, [loaded, settings, position, logs, trades]);

  // ─── Runtime state ───────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<BotPhase>("stopped");
  const [evalInfo, setEvalInfo] = useState<LiveEval | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const [nextBarAt, setNextBarAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs read by the loop (never stale)
  const settingsRef = useRef(settings);
  const positionRef = useRef(position);
  const credsRef = useRef(creds);
  const presetsRef = useRef(presets);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { credsRef.current = creds; }, [creds]);
  useEffect(() => { presetsRef.current = presets; }, [presets]);

  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickingRef = useRef(false);
  const candlesRef = useRef<KlineData[]>([]);
  const htfRef = useRef<KlineData[]>([]);
  const lastEvalBarRef = useRef(0);
  const nextBarRef = useRef(0);
  const prevTargetRef = useRef<Side | null>(null);
  const firstEvalRef = useRef(true);
  const rulesRef = useRef<Map<string, SymbolRules>>(new Map());
  const retryCloseRef = useRef<{ reason: CloseReason; tries: number } | null>(null);
  const errorsRef = useRef(0);
  const lastEvalRef = useRef<LiveEval | null>(null);

  const setPosition = useCallback((p: BotPosition | null) => {
    positionRef.current = p;
    setPositionState(p);
  }, []);

  const log = useCallback((kind: LogKind, text: string, detail?: string) => {
    setLogs((prev) => [{ id: uid(), time: Date.now(), kind, text, detail }, ...prev].slice(0, MAX_LOGS));
  }, []);

  const setSettings = useCallback((patch: Partial<BotSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      return next;
    });
  }, []);

  const preset = useMemo(() => presets.find((p) => p.id === settings.presetId) ?? null, [presets, settings.presetId]);
  const presetRef = useRef(preset);
  useEffect(() => { presetRef.current = preset; }, [preset]);

  const rulesFor = useCallback(async (market: Market, symbol: string) => {
    const key = `${market}:${symbol}`;
    const cached = rulesRef.current.get(key);
    if (cached) return cached;
    const r = await api.rules(market, symbol);
    rulesRef.current.set(key, r);
    return r;
  }, []);

  // ─── Orders ──────────────────────────────────────────────
  const openPosition = useCallback(async (side: Side, ev: LiveEval | null): Promise<boolean> => {
    const s = settingsRef.current;
    const p = presetRef.current;
    const c = credsRef.current;
    if (!p || !c) return false;
    const symbol = p.symbol;
    setBusy(side === "long" ? "กำลังส่งคำสั่งเปิด Long…" : "กำลังส่งคำสั่งเปิด Short…");
    try {
      const rules = await rulesFor(s.market, symbol);
      const now = await api.price(s.market, symbol);
      setPrice(now);
      let qty: string;
      let entry = now;

      if (s.market === "spot") {
        if (side !== "long") return false;
        if (rules.minNotional && s.amountUsdt < rules.minNotional) {
          throw new Error(`จำนวนเงินต่อไม้ ${s.amountUsdt} USDT ต่ำกว่าขั้นต่ำของคู่นี้ (${rules.minNotional} USDT)`);
        }
        const res = await api.spotOrder(c, { symbol, side: "BUY", type: "MARKET", quoteOrderQty: String(s.amountUsdt), testOrder: s.test });
        if (s.test) {
          qty = floorToStep(s.amountUsdt / now, rules.stepSize);
        } else {
          const exec = parseFloat(res.executedQty ?? "0");
          const quote = parseFloat(res.cummulativeQuoteQty ?? "0");
          // Fee charged in the coin itself reduces what we can sell later
          const feeBase = (res.fills ?? []).filter((f) => f.commissionAsset === rules.baseAsset).reduce((a, f) => a + parseFloat(f.commission), 0);
          qty = floorToStep(exec - feeBase, rules.stepSize);
          if (exec > 0 && quote > 0) entry = quote / exec;
        }
      } else {
        const notional = s.amountUsdt * s.leverage;
        qty = floorToStep(notional / now, rules.stepSize);
        if (!(parseFloat(qty) > 0) || parseFloat(qty) < parseFloat(rules.minQty)) {
          throw new Error(`จำนวนสัญญาต่ำกว่าขั้นต่ำ (${rules.minQty} ${rules.baseAsset}) — เพิ่มเงินต่อไม้หรือ Leverage`);
        }
        if (rules.minNotional && parseFloat(qty) * now < rules.minNotional) {
          throw new Error(`มูลค่าสถานะ ${(parseFloat(qty) * now).toFixed(2)} USDT ต่ำกว่าขั้นต่ำ Futures (${rules.minNotional} USDT) — เพิ่มเงินต่อไม้หรือ Leverage`);
        }
        const res = await api.futuresOrder(c, { symbol, side: side === "long" ? "BUY" : "SELL", quantity: qty, test: s.test });
        if (!s.test) {
          if (parseFloat(res.avgPrice ?? "0") > 0) entry = parseFloat(res.avgPrice!);
          if (parseFloat(res.executedQty ?? "0") > 0) qty = res.executedQty!;
        }
      }

      const def = getIndicator(p.indicatorId);
      const params = def ? normalizeParams(def, p.params) : {};
      const stops = usesLiveStops(p.config, def, params) ? stopsFor(p.config, side, entry, ev?.atr ?? null) : null;
      setPosition({
        side, qty, entryPrice: entry, entryTime: Date.now(), extreme: entry, stops,
        test: s.test, market: s.market, symbol, presetId: p.id,
      });
      const value = parseFloat(qty) * entry;
      log("open",
        `${s.test ? "[ทดสอบ] " : ""}เปิด ${side === "long" ? "Long" : "Short"} ${qty} ${rules.baseAsset} @ ${entry.toLocaleString(undefined, { maximumFractionDigits: 8 })}`,
        `${s.market === "futures" ? `Futures ${s.leverage}x · มูลค่า ≈ ${value.toFixed(2)} USDT · margin ≈ ${(value / s.leverage).toFixed(2)} USDT` : `Spot · ใช้ ≈ ${value.toFixed(2)} USDT`}${stops ? ` · SL ${stops.sl?.toFixed(4) ?? "—"} · TP ${stops.tp?.toFixed(4) ?? "—"}` : ""}`);
      return true;
    } catch (err) {
      const e = errText(err);
      log("error", `เปิด ${side === "long" ? "Long" : "Short"} ไม่สำเร็จ: ${e.text}`, e.detail);
      return false;
    } finally {
      setBusy(null);
    }
  }, [rulesFor, setPosition, log]);

  const closePosition = useCallback(async (reason: CloseReason): Promise<boolean> => {
    const pos = positionRef.current;
    const c = credsRef.current;
    if (!pos) return true;
    if (!c) { log("error", "ยังไม่ได้เชื่อมต่อ API — ปิดสถานะไม่ได้"); return false; }
    setBusy("กำลังส่งคำสั่งปิดสถานะ…");
    try {
      const rules = await rulesFor(pos.market, pos.symbol);
      const now = await api.price(pos.market, pos.symbol);
      setPrice(now);
      let exit = now;
      let qty = pos.qty;

      if (pos.market === "spot") {
        if (!pos.test) {
          const acc = await api.spotAccount(c);
          const free = parseFloat(acc.balances.find((b) => b.asset === rules.baseAsset)?.free ?? "0");
          qty = floorToStep(Math.min(parseFloat(pos.qty), free), rules.stepSize);
        }
        const q = parseFloat(qty);
        if (!(q > 0) || q < parseFloat(rules.minQty) || (rules.minNotional && q * now < rules.minNotional)) {
          log("warn", `ยอด ${rules.baseAsset} ที่เหลือ (${qty}) ต่ำกว่าขั้นต่ำที่ขายได้ — ล้างสถานะของบอทโดยไม่ส่งคำสั่ง`);
          setPosition(null);
          retryCloseRef.current = null;
          return true;
        }
        const res = await api.spotOrder(c, { symbol: pos.symbol, side: "SELL", type: "MARKET", quantity: qty, testOrder: pos.test });
        const exec = parseFloat(res.executedQty ?? "0");
        const quote = parseFloat(res.cummulativeQuoteQty ?? "0");
        if (!pos.test && exec > 0 && quote > 0) exit = quote / exec;
      } else {
        if (!pos.test) {
          const fp = await api.futuresPosition(c, pos.symbol);
          const want = pos.side === "long" ? 1 : -1;
          if (fp.positionAmt === 0 || Math.sign(fp.positionAmt) !== want) {
            log("warn", "ไม่พบสถานะนี้บน Binance แล้ว (อาจถูกปิดด้วยมือหรือถูก Liquidate) — ล้างสถานะของบอท");
            setPosition(null);
            retryCloseRef.current = null;
            return true;
          }
          qty = floorToStep(Math.abs(fp.positionAmt), rules.stepSize);
        }
        const res = await api.futuresOrder(c, {
          symbol: pos.symbol, side: pos.side === "long" ? "SELL" : "BUY", quantity: qty, reduceOnly: true, test: pos.test,
        });
        if (!pos.test && parseFloat(res.avgPrice ?? "0") > 0) exit = parseFloat(res.avgPrice!);
      }

      const sign = pos.side === "long" ? 1 : -1;
      const lev = pos.market === "futures" ? settingsRef.current.leverage : 1;
      const pnlPct = (sign * (exit - pos.entryPrice) / pos.entryPrice) * 100 * lev;
      const pnlUsdt = sign * (exit - pos.entryPrice) * parseFloat(qty);
      setTrades((prev) => [{
        id: uid(), side: pos.side, symbol: pos.symbol, market: pos.market, test: pos.test, qty,
        entryPrice: pos.entryPrice, exitPrice: exit, entryTime: pos.entryTime, exitTime: Date.now(), pnlPct, pnlUsdt, reason,
      }, ...prev].slice(0, MAX_TRADES));
      setPosition(null);
      retryCloseRef.current = null;
      log("close",
        `${pos.test ? "[ทดสอบ] " : ""}ปิด ${pos.side === "long" ? "Long" : "Short"} ${qty} @ ${exit.toLocaleString(undefined, { maximumFractionDigits: 8 })} · ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`,
        `${CLOSE_REASON_LABEL[reason]} · ก่อนหักค่าธรรมเนียม`);
      return true;
    } catch (err) {
      const e = errText(err);
      log("error", `ปิดสถานะไม่สำเร็จ: ${e.text}`, e.detail);
      return false;
    } finally {
      setBusy(null);
    }
  }, [rulesFor, setPosition, log]);

  /** Close; on failure keep retrying on the next ticks (a stuck position is the worst case) */
  const closeWithRetry = useCallback(async (reason: CloseReason) => {
    const ok = await closePosition(reason);
    if (!ok) retryCloseRef.current = { reason, tries: (retryCloseRef.current?.tries ?? 0) + 1 };
    return ok;
  }, [closePosition]);

  // ─── Loop ────────────────────────────────────────────────
  const checkStops = useCallback(async (now: number) => {
    const pos = positionRef.current;
    if (!pos?.stops) return;
    const better = pos.side === "long" ? now > pos.extreme : now < pos.extreme;
    if (better) setPosition({ ...pos, extreme: now });
    const extreme = better ? now : pos.extreme;
    const hit = stopHit(pos.stops, pos.side, extreme, now);
    if (hit) {
      log("signal", `ราคา ${now} ${CLOSE_REASON_LABEL[hit]}`);
      await closeWithRetry(hit);
    }
  }, [setPosition, log, closeWithRetry]);

  const evaluateNow = useCallback(async (trade: boolean) => {
    const p = presetRef.current;
    const s = settingsRef.current;
    if (!p) throw new Error("ยังไม่ได้เลือกกลยุทธ์");
    const def = getIndicator(p.indicatorId);
    if (!def) throw new Error(`ไม่พบ indicator ${p.indicatorName}`);
    const params = normalizeParams(def, p.params);
    const need = barsNeeded(def, params, p.interval);
    const keep = need.total + 1;

    // Candles: full history once, then only the newest few merged in
    const fresh = candlesRef.current.length >= need.total
      ? await fetchLatest(p.symbol, p.interval, 5)
      : await fetchLatest(p.symbol, p.interval, keep);
    candlesRef.current = mergeCandles(candlesRef.current.length >= need.total ? candlesRef.current : [], fresh, keep);
    const { closed, forming } = splitClosed(candlesRef.current);
    if (closed.length < 50) throw new Error(`แท่งเทียนไม่พอ (${closed.length})`);
    const last = closed[closed.length - 1];
    const tfMs = INTERVAL_MS(p.interval);
    nextBarRef.current = forming ? forming.closeTime + 1 : last.closeTime + 1 + tfMs;
    setNextBarAt(nextBarRef.current);
    if (trade && last.openTime <= lastEvalBarRef.current) return null; // the exchange has not closed the candle yet

    // Higher-timeframe candles for the trend filter
    const htfCfg = normalizeHtf(p.config.htf);
    let htf: KlineData[] | null = null;
    if (htfApplies(htfCfg, tfMs / 60_000)) {
      const { filter } = htfIndicator(htfCfg);
      const htfMs = HTF_MINUTES[filter.interval] * 60_000;
      const want = Math.min(1500, htfWarmupBars(htfCfg) + Math.ceil((closed.length * tfMs) / htfMs) + 3);
      const rows = htfRef.current.length >= want ? await fetchLatest(p.symbol, filter.interval, 3) : await fetchLatest(p.symbol, filter.interval, want);
      htfRef.current = mergeCandles(htfRef.current.length >= want ? htfRef.current : [], rows, want);
      htf = htfRef.current;
    }

    const nowPrice = forming ? +forming.open : +last.close;
    const ev = evaluateLive({ preset: p, market: s.market, closed, nowPrice, htfKlines: htf });
    lastEvalBarRef.current = last.openTime;
    lastEvalRef.current = ev;
    setEvalInfo(ev);
    setPrice(forming ? +forming.close : +last.close);
    return ev;
  }, []);

  const decide = useCallback(async (ev: LiveEval) => {
    const s = settingsRef.current;
    const desired: Side | null = s.market === "spot" && ev.target === "short" ? null : ev.target;
    const pos = positionRef.current;

    if (firstEvalRef.current) {
      firstEvalRef.current = false;
      prevTargetRef.current = desired;
      if (pos) {
        if (pos.side !== desired) {
          log("signal", `สถานะที่บอทถืออยู่ (${sideLabel(pos.side)}) ไม่ตรงกับกลยุทธ์ตอนนี้ (${sideLabel(desired)}) — ปิดสถานะ`);
          await closeWithRetry("sync");
        } else {
          log("info", `ถือ ${sideLabel(pos.side)} ต่อจากรอบก่อน — ตรงกับกลยุทธ์`);
        }
      } else if (desired) {
        log("info", `กลยุทธ์กำลังถือ ${sideLabel(desired)} อยู่แล้ว${ev.heldSince ? ` (ตั้งแต่ ${new Date(ev.heldSince.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })})` : ""} — บอทจะไม่ไล่ซื้อกลางทาง รอสัญญาณรอบใหม่`);
      } else {
        log("info", "กลยุทธ์ยังไม่ถือสถานะ — รอสัญญาณเข้า");
      }
      return;
    }

    if (desired === prevTargetRef.current) return;
    log("signal", `สัญญาณใหม่: ${sideLabel(prevTargetRef.current)} → ${sideLabel(desired)}`, ev.reason ?? undefined);
    prevTargetRef.current = desired;
    if (pos && pos.side !== desired) {
      const ok = await closeWithRetry("signal");
      if (!ok) return;
    }
    if (desired && !positionRef.current) await openPosition(desired, ev);
  }, [log, closeWithRetry, openPosition]);

  const schedule = useCallback((fn: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!runningRef.current) return;
    const s = settingsRef.current;
    const now = Date.now();
    const untilBar = nextBarRef.current ? nextBarRef.current - now + 2500 : Infinity;
    const wait = Math.max(1000, Math.min(s.pollSec * 1000, untilBar));
    timerRef.current = setTimeout(fn, wait);
  }, []);

  const tick = useCallback(async () => {
    if (!runningRef.current || tickingRef.current) return;
    tickingRef.current = true;
    try {
      const retry = retryCloseRef.current;
      if (retry && positionRef.current) {
        if (retry.tries >= 5) {
          log("error", "ปิดสถานะไม่สำเร็จ 5 ครั้งติด — หยุดบอท กรุณาตรวจสอบและปิดสถานะเองที่ Binance");
          runningRef.current = false;
          setRunning(false);
          setPhase("stopped");
          return;
        }
        await closeWithRetry(retry.reason);
      }

      if (Date.now() >= nextBarRef.current) {
        const ev = await evaluateNow(true);
        if (ev) await decide(ev);
        else nextBarRef.current = Date.now() + 3000; // candle not closed on the exchange yet — retry soon
      } else if (positionRef.current?.stops) {
        const p = presetRef.current;
        if (p) {
          const now = await api.price(settingsRef.current.market, p.symbol);
          setPrice(now);
          await checkStops(now);
        }
      }
      setLastCheck(Date.now());
      setPhase(positionRef.current ? "holding" : "waiting");
      setError(null);
      errorsRef.current = 0;
    } catch (err) {
      errorsRef.current++;
      const e = errText(err);
      setError(e.text);
      log("error", `รอบตรวจล้มเหลว: ${e.text}`, e.detail);
      if (errorsRef.current >= 10) {
        log("error", "ผิดพลาดติดกัน 10 รอบ — หยุดบอท");
        runningRef.current = false;
        setRunning(false);
        setPhase("stopped");
      }
    } finally {
      tickingRef.current = false;
      schedule(() => void tick());
    }
  }, [log, closeWithRetry, evaluateNow, decide, checkStops, schedule]);

  // ─── Controls ────────────────────────────────────────────
  /** Problems that prevent starting (empty = OK) */
  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!creds) out.push("เชื่อมต่อ Binance API ก่อน");
    if (!preset) out.push("เลือกกลยุทธ์ที่ส่งมาจากหน้า Backtest");
    else {
      const b = presetBlocker(preset, settings.market);
      if (b) out.push(b);
    }
    if (!(settings.amountUsdt > 0)) out.push("ใส่จำนวนเงินต่อไม้");
    if (settings.market === "futures" && !(settings.leverage >= 1 && settings.leverage <= 20)) out.push("Leverage ต้องอยู่ระหว่าง 1–20");
    if (position && preset && (position.symbol !== preset.symbol || position.market !== settings.market)) {
      out.push(`บอทยังถือ ${position.symbol} (${position.market}) จากรอบก่อน — ปิดหรือล้างสถานะก่อนเปลี่ยนกลยุทธ์/ตลาด`);
    }
    if (position && position.test !== settings.test) {
      out.push(`สถานะที่ค้างอยู่เป็นโหมด${position.test ? "ทดสอบ" : "เงินจริง"} — ปิดหรือล้างสถานะก่อนสลับโหมด`);
    }
    return out;
  }, [creds, preset, settings, position]);

  const start = useCallback(async () => {
    if (runningRef.current || blockers.length) return;
    const s = settingsRef.current;
    const p = presetRef.current!;
    const c = credsRef.current!;
    setError(null);
    setPhase("starting");
    setBusy("กำลังเตรียมบอท…");
    try {
      const rules = await rulesFor(s.market, p.symbol);
      if (rules.status !== "TRADING") throw new Error(`${p.symbol} ปิดการซื้อขายอยู่ (${rules.status})`);
      const orderValue = s.market === "futures" ? s.amountUsdt * s.leverage : s.amountUsdt;
      if (rules.minNotional && orderValue < rules.minNotional) {
        throw new Error(s.market === "futures"
          ? `มูลค่าสถานะ ${orderValue} USDT ต่ำกว่าขั้นต่ำของ ${p.symbol} Futures (${rules.minNotional} USDT) — เพิ่ม Margin หรือ Leverage`
          : `เงินต่อไม้ ${orderValue} USDT ต่ำกว่าขั้นต่ำของ ${p.symbol} (${rules.minNotional} USDT)`);
      }
      if (s.market === "futures" && !s.test) {
        const r = await api.futuresPrepare(c, p.symbol, s.leverage);
        log("info", `ตั้งค่า Futures ${p.symbol}: Leverage ${r.leverage}x · ${r.marginType}`, r.notes.join(" · ") || undefined);
      }
    } catch (err) {
      const e = errText(err);
      setError(e.text);
      log("error", `เริ่มบอทไม่สำเร็จ: ${e.text}`, e.detail);
      setPhase("stopped");
      setBusy(null);
      return;
    }
    setBusy(null);
    candlesRef.current = [];
    htfRef.current = [];
    lastEvalBarRef.current = 0;
    nextBarRef.current = 0;
    firstEvalRef.current = true;
    retryCloseRef.current = null;
    errorsRef.current = 0;
    runningRef.current = true;
    setRunning(true);
    log("info",
      `เริ่มบอท ${s.test ? "โหมดทดสอบ (ไม่ใช้เงินจริง)" : "โหมดเงินจริง"} · ${p.indicatorName} · ${p.symbol} ${p.interval} · ${s.market === "spot" ? "Spot" : `Futures ${s.leverage}x`} · ${s.amountUsdt} USDT/ไม้`);
    void tick();
  }, [blockers, rulesFor, log, tick]);

  const stop = useCallback((why?: string) => {
    if (!runningRef.current) return;
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRunning(false);
    setPhase("stopped");
    setNextBarAt(null);
    log("info", why ?? `หยุดบอท${positionRef.current ? " — ยังถือสถานะอยู่ (ไม่ได้ปิดให้)" : ""}`);
  }, [log]);

  /** One evaluation without trading — "what would the bot do right now?" */
  const preview = useCallback(async () => {
    setBusy("กำลังคำนวณสัญญาณ…");
    setError(null);
    try {
      candlesRef.current = [];
      htfRef.current = [];
      await evaluateNow(false);
      setLastCheck(Date.now());
    } catch (err) {
      setError(errText(err).text);
    } finally {
      setBusy(null);
    }
  }, [evaluateNow]);

  const closeNow = useCallback(async () => {
    await closeWithRetry("manual");
  }, [closeWithRetry]);

  /** Drop the bot's record of a position without trading (already closed on Binance) */
  const forgetPosition = useCallback(() => {
    if (!positionRef.current) return;
    log("warn", "ล้างสถานะของบอท (ไม่ได้ส่งคำสั่งไป Binance)");
    setPosition(null);
    retryCloseRef.current = null;
  }, [log, setPosition]);

  const clearHistory = useCallback(() => {
    setLogs([]);
    setTrades([]);
  }, []);

  // Clear evaluation when the strategy / market changes
  useEffect(() => {
    if (runningRef.current) return;
    setEvalInfo(null);
    candlesRef.current = [];
    htfRef.current = [];
  }, [settings.presetId, settings.market]);

  // Network status
  useEffect(() => {
    const off = () => log("warn", "อินเทอร์เน็ตหลุด — บอทจะลองใหม่เมื่อกลับมาออนไลน์");
    const on = () => {
      log("info", "อินเทอร์เน็ตกลับมาแล้ว");
      if (runningRef.current) schedule(() => void tick());
    };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, [log, schedule, tick]);

  // Warn before leaving while running
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  // Stop when the page unmounts
  useEffect(() => () => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const stats = useMemo(() => {
    const list = trades.filter((t) => t.test === settings.test);
    const wins = list.filter((t) => t.pnlUsdt > 0).length;
    return {
      count: list.length,
      wins,
      winRate: list.length ? (wins / list.length) * 100 : 0,
      pnlUsdt: list.reduce((a, t) => a + t.pnlUsdt, 0),
    };
  }, [trades, settings.test]);

  const unrealized = useMemo(() => {
    if (!position || price === null) return null;
    const sign = position.side === "long" ? 1 : -1;
    const lev = position.market === "futures" ? settings.leverage : 1;
    return {
      pct: (sign * (price - position.entryPrice) / position.entryPrice) * 100 * lev,
      usdt: sign * (price - position.entryPrice) * parseFloat(position.qty),
      trail: position.stops ? trailLevel(position.stops, position.side, position.extreme) : null,
    };
  }, [position, price, settings.leverage]);

  return {
    loaded, settings, setSettings, preset, position, logs, trades, stats, unrealized,
    running, phase, evalInfo, price, busy, lastCheck, nextBarAt, error, blockers,
    start, stop, preview, closeNow, forgetPosition, clearHistory,
  };
}

export type Bot = ReturnType<typeof useBot>;

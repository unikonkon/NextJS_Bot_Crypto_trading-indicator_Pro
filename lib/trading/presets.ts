/**
 * Strategy presets sent from /klines (backtest) to the trading bot on /trading/Binance.
 * Stored in localStorage of this browser — the same indicator, params and backtest settings
 * the user tested, plus the backtest result at the time it was sent.
 */
import type { Interval } from "@/lib/types/kline";
import type { BacktestConfig, BacktestResult, Params } from "@/lib/engine/types";

export const PRESETS_KEY = "trading.presets";

export interface PresetBacktest {
  totalReturnPct: number;
  buyAndHoldPct: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPct: number;
  profitFactor: number;
  /** Evaluated range */
  from: number;
  to: number;
  bars: number;
}

export interface BotPreset {
  id: string;
  createdAt: number;
  indicatorId: string;
  /** Name at the time it was saved (the registry name is used when it still exists) */
  indicatorName: string;
  params: Params;
  config: BacktestConfig;
  symbol: string;
  interval: Interval;
  /** Backtest result on /klines when the preset was sent (null when it had not run) */
  backtest: PresetBacktest | null;
  /** Free-form note shown in the list */
  note?: string;
}

export function loadPresets(): BotPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    const list = raw ? (JSON.parse(raw) as BotPreset[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.indicatorId === "string") : [];
  } catch {
    return [];
  }
}

function store(list: BotPreset[]) {
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    /* storage full / blocked */
  }
}

/** Same strategy + params + settings + market → replaces the older entry instead of duplicating it */
function sameSetup(a: BotPreset, b: BotPreset) {
  return a.indicatorId === b.indicatorId && a.symbol === b.symbol && a.interval === b.interval
    && JSON.stringify(a.params) === JSON.stringify(b.params) && JSON.stringify(a.config) === JSON.stringify(b.config);
}

export function savePreset(p: BotPreset): BotPreset[] {
  const list = [p, ...loadPresets().filter((x) => !sameSetup(x, p))].slice(0, 50);
  store(list);
  return list;
}

export function removePreset(id: string): BotPreset[] {
  const list = loadPresets().filter((p) => p.id !== id);
  store(list);
  return list;
}

export function makePreset(input: {
  indicatorId: string;
  indicatorName: string;
  params: Params;
  config: BacktestConfig;
  symbol: string;
  interval: Interval;
  result: BacktestResult | null;
  times: number[];
}): BotPreset {
  const r = input.result;
  const start = r ? Math.min(r.startIndex, input.times.length - 1) : 0;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    indicatorId: input.indicatorId,
    indicatorName: input.indicatorName,
    params: { ...input.params },
    config: JSON.parse(JSON.stringify(input.config)),
    symbol: input.symbol,
    interval: input.interval,
    backtest: r && input.times.length
      ? {
          totalReturnPct: r.totalReturnPct,
          buyAndHoldPct: r.buyAndHoldPct,
          winRate: r.winRate,
          totalTrades: r.totalTrades,
          maxDrawdownPct: r.maxDrawdownPct,
          profitFactor: r.profitFactor,
          from: input.times[Math.max(0, start)],
          to: input.times[input.times.length - 1],
          bars: input.times.length - start,
        }
      : null,
  };
}

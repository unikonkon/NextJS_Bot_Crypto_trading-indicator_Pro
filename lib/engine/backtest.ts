import { atr } from "./math";
import type {
  Bars,
  BacktestConfig,
  BacktestResult,
  BacktestStats,
  BacktestSummary,
  ExitReason,
  Side,
  SideStats,
  StopRule,
  Trade,
} from "./types";

interface OpenPosition {
  side: Side;
  entryIdx: number;
  entryPrice: number;
  sl: number | null;
  tp: number | null;
  /** Absolute trailing distance (ATR mode) */
  trailDist: number | null;
  /** Best price reached since entry (high for long, low for short) */
  extreme: number;
}

/**
 * Event-driven backtest on bar closes.
 *
 * Signals (+1 / −1) are evaluated at the close of each bar and filled at that close.
 *   mode "long"  : +1 opens Long,  −1 closes Long
 *   mode "short" : −1 opens Short, +1 closes Short
 *   mode "both"  : +1 closes Short & opens Long, −1 closes Long & opens Short
 *
 * Stops are checked intrabar from the bar after entry, stop before take-profit
 * (conservative when both are touched in the same bar). Gaps fill at the open.
 * Returns compound: equity *= (1 + tradePnl%).
 */
export function runBacktest(bars: Bars, signals: ArrayLike<number>, cfg: BacktestConfig): BacktestResult {
  const n = bars.length;
  const { open, high, low, close, time } = bars;
  const costPct = 2 * (Math.max(0, cfg.feesPct) + Math.max(0, cfg.slippagePct));
  const allowLong = cfg.mode !== "short";
  const allowShort = cfg.mode !== "long";

  const rules = [cfg.stopLoss, cfg.takeProfit, cfg.trailing];
  const atrArr = rules.some((r) => r.kind === "atr") ? atr(bars.klines, 14) : null;

  const distance = (rule: StopRule, price: number, idx: number): number | null => {
    if (rule.kind === "none" || !(rule.value > 0)) return null;
    if (rule.kind === "pct") return (price * rule.value) / 100;
    const a = atrArr?.[idx];
    return a == null ? null : a * rule.value;
  };

  const trades: Trade[] = [];
  const equityCurve = new Array<number>(n);
  let equity = 1;
  let pos: OpenPosition | null = null;
  let barsInPos = 0;

  const openPos = (side: Side, i: number) => {
    const price = close[i];
    const sign = side === "long" ? 1 : -1;
    const slD = distance(cfg.stopLoss, price, i);
    const tpD = distance(cfg.takeProfit, price, i);
    pos = {
      side,
      entryIdx: i,
      entryPrice: price,
      sl: slD === null ? null : price - sign * slD,
      tp: tpD === null ? null : price + sign * tpD,
      trailDist: cfg.trailing.kind === "atr" ? distance(cfg.trailing, price, i) : null,
      extreme: price,
    };
  };

  const closePos = (i: number, price: number, reason: ExitReason) => {
    const p = pos as OpenPosition;
    const sign = p.side === "long" ? 1 : -1;
    const gross = (sign * (price - p.entryPrice) / p.entryPrice) * 100;
    const pnlPct = gross - costPct;
    trades.push({
      side: p.side,
      entryIdx: p.entryIdx,
      entryTime: time[p.entryIdx],
      entryPrice: p.entryPrice,
      exitIdx: i,
      exitTime: time[i],
      exitPrice: price,
      pnlPct,
      bars: i - p.entryIdx,
      exitReason: reason,
    });
    equity = Math.max(0, equity * (1 + pnlPct / 100));
    pos = null;
  };

  const trailLevel = (p: OpenPosition): number | null => {
    const t = cfg.trailing;
    if (t.kind === "none" || !(t.value > 0)) return null;
    if (t.kind === "pct") return p.side === "long" ? p.extreme * (1 - t.value / 100) : p.extreme * (1 + t.value / 100);
    if (p.trailDist === null) return null;
    return p.side === "long" ? p.extreme - p.trailDist : p.extreme + p.trailDist;
  };

  for (let i = 0; i < n; i++) {
    // 1) Intrabar stop / take-profit / trailing
    if (pos !== null && i > (pos as OpenPosition).entryIdx) {
      const p = pos as OpenPosition;
      const tl = trailLevel(p);
      if (p.side === "long") {
        let stop = p.sl;
        let reason: ExitReason = "stopLoss";
        if (tl !== null && (stop === null || tl > stop)) { stop = tl; reason = "trailing"; }
        if (stop !== null && low[i] <= stop) closePos(i, Math.min(open[i], stop), reason);
        else if (p.tp !== null && high[i] >= p.tp) closePos(i, Math.max(open[i], p.tp), "takeProfit");
        else p.extreme = Math.max(p.extreme, high[i]);
      } else {
        let stop = p.sl;
        let reason: ExitReason = "stopLoss";
        if (tl !== null && (stop === null || tl < stop)) { stop = tl; reason = "trailing"; }
        if (stop !== null && high[i] >= stop) closePos(i, Math.max(open[i], stop), reason);
        else if (p.tp !== null && low[i] <= p.tp) closePos(i, Math.min(open[i], p.tp), "takeProfit");
        else p.extreme = Math.min(p.extreme, low[i]);
      }
    }

    // 2) Signal exits & entries at the close
    const sig = signals[i];
    if (pos !== null && cfg.exitOnOpposite) {
      const side = (pos as OpenPosition).side;
      if ((side === "long" && sig === -1) || (side === "short" && sig === 1)) closePos(i, close[i], "signal");
    }
    if (pos === null) {
      if (sig === 1 && allowLong) openPos("long", i);
      else if (sig === -1 && allowShort) openPos("short", i);
    }

    // 3) Mark-to-market equity
    if (pos !== null) {
      const p = pos as OpenPosition;
      const sign = p.side === "long" ? 1 : -1;
      const unreal = (sign * (close[i] - p.entryPrice)) / p.entryPrice;
      equityCurve[i] = (equity * (1 + unreal) - 1) * 100;
      barsInPos++;
    } else {
      equityCurve[i] = (equity - 1) * 100;
    }
  }

  const openSide: Side | null = pos !== null ? (pos as OpenPosition).side : null;
  if (pos !== null && n > 0) {
    closePos(n - 1, close[n - 1], "end");
    equityCurve[n - 1] = (equity - 1) * 100;
  }

  const sigArr = Array.from(signals as ArrayLike<number>);
  const stats = computeStats(bars, trades, equityCurve, equity, barsInPos, sigArr, openSide);
  return { ...stats, trades, equityCurve, signals: sigArr };
}

function sideStats(trades: Trade[]): SideStats {
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const compounded = trades.reduce((eq, t) => Math.max(0, eq * (1 + t.pnlPct / 100)), 1);
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    returnPct: (compounded - 1) * 100,
    avgPnlPct: trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0,
  };
}

function computeStats(
  bars: Bars,
  trades: Trade[],
  equityCurve: number[],
  finalEquity: number,
  barsInPos: number,
  signals: number[],
  openSide: Side | null,
): BacktestStats {
  const n = bars.length;
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossWins = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));

  let peak = 1;
  let maxDD = 0;
  for (const pct of equityCurve) {
    const eq = 1 + pct / 100;
    if (eq > peak) peak = eq;
    if (peak > 0) maxDD = Math.max(maxDD, ((peak - eq) / peak) * 100);
  }

  const rets = trades.map((t) => t.pnlPct);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;

  let lastSignal: BacktestStats["lastSignal"] = null;
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i] === 1 || signals[i] === -1) {
      lastSignal = { dir: signals[i] as 1 | -1, barsAgo: signals.length - 1 - i };
      break;
    }
  }

  const c = bars.close;
  return {
    totalReturnPct: (finalEquity - 1) * 100,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    wins: wins.length,
    losses: losses.length,
    totalTrades: trades.length,
    maxDrawdownPct: maxDD,
    sharpeRatio: variance === 0 ? 0 : mean / Math.sqrt(variance),
    profitFactor: grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses,
    avgWinPct: wins.length ? grossWins / wins.length : 0,
    avgLossPct: losses.length ? -grossLosses / losses.length : 0,
    avgBarsHeld: trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : 0,
    bestTradePct: trades.length ? Math.max(...rets) : 0,
    worstTradePct: trades.length ? Math.min(...rets) : 0,
    buyAndHoldPct: n >= 2 ? ((c[n - 1] - c[0]) / c[0]) * 100 : 0,
    exposurePct: n ? (barsInPos / n) * 100 : 0,
    long: sideStats(trades.filter((t) => t.side === "long")),
    short: sideStats(trades.filter((t) => t.side === "short")),
    openSide,
    lastSignal,
  };
}

export function toSummary(r: BacktestResult, points = 48): BacktestSummary {
  // Drop the heavy per-bar arrays and keep a sparkline
  const { trades: _t, equityCurve, signals: _s, ...stats } = r;
  void _t; void _s;
  const spark: number[] = [];
  const n = equityCurve.length;
  if (n > 0) {
    const step = Math.max(1, Math.floor(n / points));
    for (let i = 0; i < n; i += step) spark.push(equityCurve[i]);
    if ((n - 1) % step !== 0) spark.push(equityCurve[n - 1]);
  }
  return { ...stats, spark };
}

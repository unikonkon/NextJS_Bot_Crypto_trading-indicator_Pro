import { atr } from "./math";
import type {
  Bars,
  BacktestConfig,
  BacktestResult,
  BacktestStats,
  BacktestSummary,
  ExitReason,
  ExposureOutput,
  FillMode,
  HtfFilter,
  HtfReport,
  Side,
  SideStats,
  StopRule,
  Trade,
  TradeMode,
} from "./types";

interface OpenPosition {
  side: Side;
  size: number;
  entryIdx: number;
  entryPrice: number;
  sl: number | null;
  tp: number | null;
  /** Absolute trailing distance (ATR mode) */
  trailDist: number | null;
  /** Best price reached since entry (high for long, low for short) */
  extreme: number;
  /** First bar on which intrabar stops may trigger */
  stopsFrom: number;
}

export interface RunOptions {
  /** First bar that may hold a position; earlier bars are warm-up */
  startIndex?: number;
  fill?: FillMode;
  /** Per-bar strategy explanations, copied onto trades */
  reasons?: (string | null)[] | null;
  warmupBars?: number;
  /**
   * Higher-timeframe state per bar (+1 bull / −1 bear / 0 unknown): new positions may only be
   * opened on its side. Closing is never blocked and open positions are not forced out on a flip.
   */
  regime?: ArrayLike<number> | null;
  /** Filter settings echoed into the result (required with `regime`) */
  htf?: HtfFilter | null;
}

const sideSign = (s: Side) => (s === "long" ? 1 : -1);

/**
 * Shared position book: compounding equity, trade log and mark-to-market curve.
 * Trade pnl% is per unit of notional (net of 2 × cost); equity moves by size × pnl%.
 */
class Book {
  readonly trades: Trade[] = [];
  readonly curve: number[];
  equity = 1;
  pos: OpenPosition | null = null;
  barsInPos = 0;

  constructor(private bars: Bars, private costPct: number, private reasons: (string | null)[] | null | undefined) {
    this.curve = new Array<number>(bars.length).fill(0);
  }

  private note(i: number): string | undefined {
    return this.reasons?.[i] ?? undefined;
  }

  open(side: Side, size: number, i: number, price: number, stopsFrom: number, levels?: { sl: number | null; tp: number | null; trailDist: number | null }) {
    this.pos = {
      side, size, entryIdx: i, entryPrice: price,
      sl: levels?.sl ?? null, tp: levels?.tp ?? null, trailDist: levels?.trailDist ?? null,
      extreme: price, stopsFrom,
    };
  }

  close(i: number, price: number, reason: ExitReason) {
    const p = this.pos;
    if (!p) return;
    const gross = (sideSign(p.side) * (price - p.entryPrice) / p.entryPrice) * 100;
    const pnlPct = gross - 2 * this.costPct;
    this.trades.push({
      side: p.side,
      entryIdx: p.entryIdx,
      entryTime: this.bars.time[p.entryIdx],
      entryPrice: p.entryPrice,
      exitIdx: i,
      exitTime: this.bars.time[i],
      exitPrice: price,
      pnlPct,
      bars: i - p.entryIdx,
      exitReason: reason,
      size: p.size,
      entryNote: this.note(p.entryIdx === 0 ? 0 : p.entryIdx - (p.stopsFrom === p.entryIdx ? 1 : 0)),
      exitNote: this.note(i),
    });
    this.equity = Math.max(0, this.equity * (1 + (p.size * pnlPct) / 100));
    this.pos = null;
  }

  mark(i: number) {
    const p = this.pos;
    if (p) {
      const unreal = (sideSign(p.side) * (this.bars.close[i] - p.entryPrice)) / p.entryPrice;
      this.curve[i] = (this.equity * (1 + p.size * unreal) - 1) * 100;
      this.barsInPos++;
    } else {
      this.curve[i] = (this.equity - 1) * 100;
    }
  }

  /** Force-close at the last bar; returns the side that was still open */
  finish(): Side | null {
    const n = this.bars.length;
    const openSide = this.pos?.side ?? null;
    if (this.pos && n > 0) {
      this.close(n - 1, this.bars.close[n - 1], "end");
      this.curve[n - 1] = (this.equity - 1) * 100;
    }
    return openSide;
  }
}

/**
 * Signal engine — per-bar +1 / −1 signals.
 *
 *   mode "long"  : +1 opens Long,  −1 closes Long
 *   mode "short" : −1 opens Short, +1 closes Short
 *   mode "both"  : +1 closes Short & opens Long, −1 closes Long & opens Short
 *
 * fill "close"    : act at the close of the signal bar (stops checked from the next bar)
 * fill "nextOpen" : act at the open of the following bar (stops checked from that bar)
 * Stop before take-profit when both are touched in one bar; gaps fill at the open.
 */
export function runBacktest(bars: Bars, signals: ArrayLike<number>, cfg: BacktestConfig, opts: RunOptions = {}): BacktestResult {
  const n = bars.length;
  const { open, high, low, close } = bars;
  const start = Math.max(0, Math.min(opts.startIndex ?? 0, Math.max(0, n - 1)));
  const fill: FillMode = opts.fill ?? "close";
  const costPct = Math.max(0, cfg.feesPct) + Math.max(0, cfg.slippagePct);
  const allowLong = cfg.mode !== "short";
  const allowShort = cfg.mode !== "long";
  const book = new Book(bars, costPct, opts.reasons);

  const rules = [cfg.stopLoss, cfg.takeProfit, cfg.trailing];
  const atrArr = rules.some((r) => r.kind === "atr") ? atr(bars.klines, 14) : null;
  const distance = (rule: StopRule, price: number, idx: number): number | null => {
    if (rule.kind === "none" || !(rule.value > 0)) return null;
    if (rule.kind === "pct") return (price * rule.value) / 100;
    const a = idx >= 0 ? atrArr?.[idx] : null;
    return a == null ? null : a * rule.value;
  };
  const trailLevel = (p: OpenPosition): number | null => {
    const t = cfg.trailing;
    if (t.kind === "none" || !(t.value > 0)) return null;
    if (t.kind === "pct") return p.side === "long" ? p.extreme * (1 - t.value / 100) : p.extreme * (1 + t.value / 100);
    if (p.trailDist === null) return null;
    return p.side === "long" ? p.extreme - p.trailDist : p.extreme + p.trailDist;
  };

  const enter = (side: Side, i: number, price: number) => {
    // ATR must be known when the order is placed: the signal bar's ATR
    const atrIdx = fill === "nextOpen" ? i - 1 : i;
    const sign = sideSign(side);
    const slD = distance(cfg.stopLoss, price, atrIdx);
    const tpD = distance(cfg.takeProfit, price, atrIdx);
    book.open(side, 1, i, price, fill === "close" ? i + 1 : i, {
      sl: slD === null ? null : price - sign * slD,
      tp: tpD === null ? null : price + sign * tpD,
      trailDist: cfg.trailing.kind === "atr" ? distance(cfg.trailing, price, atrIdx) : null,
    });
  };

  const regime = opts.regime ?? null;
  let blocked = 0;
  /** sigIdx = bar the signal was decided on (i for close fill, i − 1 for next-open fill) */
  const act = (sig: number, i: number, price: number, sigIdx: number) => {
    const p = book.pos;
    // Exits are never filtered: a Sell still closes a Long while the higher timeframe is bullish
    if (p && cfg.exitOnOpposite && ((p.side === "long" && sig === -1) || (p.side === "short" && sig === 1))) {
      book.close(i, price, "signal");
    }
    if (!book.pos) {
      const wanted = (sig === 1 && allowLong) || (sig === -1 && allowShort);
      if (!wanted) return;
      if (regime && regime[sigIdx] !== sig) { blocked++; return; }
      enter(sig === 1 ? "long" : "short", i, price);
    }
  };

  let pending = 0;
  for (let i = start; i < n; i++) {
    // 1) Orders decided at the previous close
    if (fill === "nextOpen" && pending !== 0) { act(pending, i, open[i], i - 1); pending = 0; }

    // 2) Intrabar stop / take-profit / trailing
    const p = book.pos;
    if (p && i >= p.stopsFrom) {
      const tl = trailLevel(p);
      if (p.side === "long") {
        let stop = p.sl;
        let reason: ExitReason = "stopLoss";
        if (tl !== null && (stop === null || tl > stop)) { stop = tl; reason = "trailing"; }
        if (stop !== null && low[i] <= stop) book.close(i, Math.min(open[i], stop), reason);
        else if (p.tp !== null && high[i] >= p.tp) book.close(i, Math.max(open[i], p.tp), "takeProfit");
        else p.extreme = Math.max(p.extreme, high[i]);
      } else {
        let stop = p.sl;
        let reason: ExitReason = "stopLoss";
        if (tl !== null && (stop === null || tl < stop)) { stop = tl; reason = "trailing"; }
        if (stop !== null && high[i] >= stop) book.close(i, Math.max(open[i], stop), reason);
        else if (p.tp !== null && low[i] <= p.tp) book.close(i, Math.min(open[i], p.tp), "takeProfit");
        else p.extreme = Math.min(p.extreme, low[i]);
      }
    }

    // 3) Signal at the close
    const sig = signals[i];
    if (sig === 1 || sig === -1) {
      if (fill === "close") act(sig, i, close[i], i);
      else pending = sig;
    }

    book.mark(i);
  }

  const openSide = book.finish();
  const sigArr = Array.from(signals as ArrayLike<number>);
  for (let i = 0; i < start && i < sigArr.length; i++) sigArr[i] = 0;
  const stats = computeStats(bars, book, start, sigArr, openSide);
  return {
    ...stats,
    trades: book.trades,
    equityCurve: book.curve,
    signals: sigArr,
    reasons: opts.reasons ?? null,
    engine: "signal",
    fill,
    direction: cfg.mode,
    startIndex: start,
    warmupBars: opts.warmupBars ?? start,
    htf: htfReport(opts, start, n, blocked),
  };
}

/**
 * Exposure engine — the strategy states its target position per bar (decided at the
 * close, executed at the next bar's open), like the v3 `simulateExposure` "next_open" mode.
 * exitFill[i] closes the position inside bar i at that price (v4 SL/TP).
 * Cost is charged per side on the traded notional.
 */
export function runExposure(bars: Bars, out: ExposureOutput, cfg: BacktestConfig, direction: TradeMode, opts: RunOptions = {}): BacktestResult {
  const n = bars.length;
  const start = Math.max(0, Math.min(opts.startIndex ?? 0, Math.max(0, n - 1)));
  const costPct = Math.max(0, cfg.feesPct) + Math.max(0, cfg.slippagePct);
  const book = new Book(bars, costPct, opts.reasons);
  const { exposure, exitFill } = out;
  const target = (i: number) => (i >= start && i < n ? (Number.isFinite(exposure[i]) ? exposure[i] : 0) : 0);

  const regime = opts.regime ?? null;
  let blocked = 0;
  for (let i = start; i < n; i++) {
    // 1) Execute the target set at the previous close, at this bar's open
    let tgt = target(i - 1);
    const p = book.pos;
    if (regime && tgt !== 0) {
      // Higher-timeframe filter: a position already held on this side may stay (but not grow);
      // a new one opens only when the strategy itself enters, on the higher timeframe's side.
      const s = Math.sign(tgt);
      const ok = regime[i - 1] === s;
      if (p && sideSign(p.side) === s) {
        if (!ok) tgt = s * Math.min(Math.abs(tgt), p.size);
      } else if (!ok || target(i - 2) === tgt) {
        if (!ok && target(i - 2) !== tgt) blocked++;
        tgt = 0;
      }
    }
    const cur = p ? sideSign(p.side) * p.size : 0;
    if (tgt !== cur) {
      if (p && (tgt === 0 || Math.sign(tgt) !== sideSign(p.side))) book.close(i, bars.open[i], "signal");
      if (tgt !== 0 && !book.pos) {
        book.open(tgt > 0 ? "long" : "short", Math.abs(tgt), i, bars.open[i], i);
      } else if (tgt !== 0 && book.pos) {
        // Same side, different size: resize and pay cost on the change
        const delta = Math.abs(Math.abs(tgt) - book.pos.size);
        book.equity = Math.max(0, book.equity * (1 - (delta * costPct) / 100));
        book.pos.size = Math.abs(tgt);
      }
    }

    // 2) Exit inside the bar (stop / target touched)
    const ef = exitFill?.[i];
    const q = book.pos;
    if (q && ef != null && Number.isFinite(ef)) {
      const won = sideSign(q.side) * (ef - q.entryPrice) >= 0;
      book.close(i, ef, won ? "takeProfit" : "stopLoss");
    }

    book.mark(i);
  }

  const openSide = book.finish();
  // Derived event markers: +1 when exposure rises, −1 when it falls
  const sigArr = new Array<number>(n).fill(0);
  for (let i = Math.max(1, start); i < n; i++) {
    const d = target(i) - target(i - 1);
    if (d > 0) sigArr[i] = 1;
    else if (d < 0) sigArr[i] = -1;
  }
  const stats = computeStats(bars, book, start, sigArr, openSide);
  return {
    ...stats,
    trades: book.trades,
    equityCurve: book.curve,
    signals: sigArr,
    reasons: opts.reasons ?? null,
    engine: "exposure",
    fill: "nextOpen",
    direction,
    startIndex: start,
    warmupBars: opts.warmupBars ?? start,
    htf: htfReport(opts, start, n, blocked),
  };
}

function htfReport(opts: RunOptions, start: number, n: number, blocked: number): HtfReport | null {
  const r = opts.regime, f = opts.htf;
  if (!r || !f) return null;
  let bullBars = 0, bearBars = 0, unknownBars = 0;
  for (let i = start; i < n; i++) {
    if (r[i] === 1) bullBars++;
    else if (r[i] === -1) bearBars++;
    else unknownBars++;
  }
  return { interval: f.interval, fast: f.fast, slow: f.slow, blocked, bullBars, bearBars, unknownBars };
}

function sideStats(trades: Trade[]): SideStats {
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const compounded = trades.reduce((eq, t) => Math.max(0, eq * (1 + (t.size * t.pnlPct) / 100)), 1);
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    returnPct: (compounded - 1) * 100,
    avgPnlPct: trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0,
  };
}

function computeStats(bars: Bars, book: Book, start: number, signals: number[], openSide: Side | null): BacktestStats {
  const n = bars.length;
  const trades = book.trades;
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossWins = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));

  let peak = 1;
  let maxDD = 0;
  for (let i = start; i < n; i++) {
    const eq = 1 + book.curve[i] / 100;
    if (eq > peak) peak = eq;
    if (peak > 0) maxDD = Math.max(maxDD, ((peak - eq) / peak) * 100);
  }

  const rets = trades.map((t) => t.pnlPct);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;

  let lastSignal: BacktestStats["lastSignal"] = null;
  for (let i = signals.length - 1; i >= start; i--) {
    if (signals[i] === 1 || signals[i] === -1) {
      lastSignal = { dir: signals[i] as 1 | -1, barsAgo: signals.length - 1 - i };
      break;
    }
  }

  const c = bars.close;
  const evalBars = Math.max(0, n - start);
  return {
    totalReturnPct: (book.equity - 1) * 100,
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
    buyAndHoldPct: n - start >= 2 ? ((c[n - 1] - c[start]) / c[start]) * 100 : 0,
    exposurePct: evalBars ? (book.barsInPos / evalBars) * 100 : 0,
    long: sideStats(trades.filter((t) => t.side === "long")),
    short: sideStats(trades.filter((t) => t.side === "short")),
    openSide,
    lastSignal,
  };
}

export function toSummary(r: BacktestResult, points = 48): BacktestSummary {
  // Drop the heavy per-bar arrays and keep a sparkline of the evaluated window
  const { trades: _t, equityCurve, signals: _s, reasons: _r, ...stats } = r;
  void _t; void _s; void _r;
  const spark: number[] = [];
  const from = r.startIndex;
  const n = equityCurve.length;
  const len = n - from;
  if (len > 0) {
    const step = Math.max(1, Math.floor(len / points));
    for (let i = from; i < n; i += step) spark.push(equityCurve[i]);
    if ((n - 1 - from) % step !== 0) spark.push(equityCurve[n - 1]);
  }
  return { ...stats, spark };
}

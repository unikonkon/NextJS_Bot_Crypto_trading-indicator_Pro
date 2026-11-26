import type { KlineData } from "@/lib/types/kline";

// ═══════════════════════════════════════════════════════════════
// Bars — numeric OHLCV columns shared by every indicator
// ═══════════════════════════════════════════════════════════════
export interface Bars {
  length: number;
  time: number[];   // openTime (ms)
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  /** Original rows — for legacy indicator functions that take KlineData[] */
  klines: KlineData[];
}

// ═══════════════════════════════════════════════════════════════
// Indicator definition — one file per indicator, see lib/engine/indicators/
// ═══════════════════════════════════════════════════════════════
export type Category = "trend" | "momentum" | "volatility" | "volume" | "structure";

export const CATEGORY_LABELS: Record<Category, string> = {
  trend: "เทรนด์",
  momentum: "โมเมนตัม",
  volatility: "ความผันผวน",
  volume: "วอลุ่ม",
  structure: "โครงสร้างราคา",
};

export interface ParamDef {
  key: string;
  label: string;
  /** Short Thai hint shown under the input */
  hint?: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export type Params = Record<string, number>;

/**
 * Per-bar signal, evaluated at bar close:
 *   +1 = bullish (open Long / close Short)
 *   -1 = bearish (open Short / close Long)
 *    0 = nothing
 */
export type SignalArray = Int8Array;

// ─── Plot description (rendered generically by the chart) ─────
export interface LinePlot {
  kind: "line";
  title: string;
  color: string;
  values: (number | null)[];
  /** Optional per-bar color (overrides `color`); null = gap */
  colors?: (string | null)[];
  width?: 1 | 2 | 3 | 4;
  /** 0 solid, 1 dotted, 2 dashed, 3 large dashed */
  style?: 0 | 1 | 2 | 3;
  /** Draw straight lines across null values instead of leaving gaps (ZigZag) */
  connectGaps?: boolean;
  /** Draw dots only, no connecting line (Parabolic SAR) */
  points?: boolean;
}

export interface HistogramPlot {
  kind: "histogram";
  title: string;
  color: string;
  values: (number | null)[];
  colors?: (string | null)[];
}

export type SeriesPlot = LinePlot | HistogramPlot;

/** Horizontal segment between two bar indices (order blocks, break levels…) */
export interface SegmentPlot {
  from: number;
  to: number;
  value: number;
  color: string;
  width?: 1 | 2 | 3 | 4;
  style?: 0 | 1 | 2 | 3;
}

export interface MarkerPlot {
  index: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
}

export interface PanePlot {
  title: string;
  series: SeriesPlot[];
  /** Horizontal reference lines (e.g. RSI 30/70) */
  levels?: { value: number; color: string }[];
}

export interface PlotOutput {
  overlays?: SeriesPlot[];
  segments?: SegmentPlot[];
  panes?: PanePlot[];
  markers?: MarkerPlot[];
  /** Recolor candles (e.g. CDC ActionZone) — only applied for the active strategy */
  barColors?: (string | null)[];
}

export interface PlotContext {
  dark: boolean;
}

export interface IndicatorDef<R = unknown> {
  /** Stable id — used as key in storage, worker messages and URLs */
  id: string;
  name: string;
  category: Category;
  /** Thai: what triggers a bullish (+1) signal */
  longRule: string;
  /** Thai: what triggers a bearish (-1) signal */
  shortRule: string;
  params: ParamDef[];
  /** Minimum bars needed before the indicator produces anything meaningful */
  minBars: number;
  compute(bars: Bars, p: Params): R;
  signals(r: R, bars: Bars, p: Params): SignalArray;
  plot?(r: R, bars: Bars, p: Params, ctx: PlotContext): PlotOutput;
}

/** Identity helper that keeps the result type `R` inferred inside one definition */
export function defineIndicator<R>(def: IndicatorDef<R>): IndicatorDef<unknown> {
  return def as unknown as IndicatorDef<unknown>;
}

// ═══════════════════════════════════════════════════════════════
// Backtest
// ═══════════════════════════════════════════════════════════════
export type TradeMode = "long" | "short" | "both";
export type StopKind = "none" | "pct" | "atr";

export interface StopRule {
  kind: StopKind;
  /** % of entry price (pct) or ATR(14) multiple (atr) */
  value: number;
}

export interface BacktestConfig {
  mode: TradeMode;
  /** Fee per side, % */
  feesPct: number;
  /** Slippage per side, % */
  slippagePct: number;
  stopLoss: StopRule;
  takeProfit: StopRule;
  trailing: StopRule;
  /** Close a position when the opposite signal appears */
  exitOnOpposite: boolean;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  mode: "both",
  feesPct: 0.1,
  slippagePct: 0,
  stopLoss: { kind: "none", value: 2 },
  takeProfit: { kind: "none", value: 4 },
  trailing: { kind: "none", value: 2 },
  exitOnOpposite: true,
};

export type Side = "long" | "short";
export type ExitReason = "signal" | "stopLoss" | "takeProfit" | "trailing" | "end";

export interface Trade {
  side: Side;
  entryIdx: number;
  entryTime: number;
  entryPrice: number;
  exitIdx: number;
  exitTime: number;
  exitPrice: number;
  /** Net % after fees & slippage */
  pnlPct: number;
  bars: number;
  exitReason: ExitReason;
}

export interface SideStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Compounded return contributed by this side, % */
  returnPct: number;
  avgPnlPct: number;
}

export interface BacktestStats {
  /** Compounded total return, % */
  totalReturnPct: number;
  winRate: number;
  wins: number;
  losses: number;
  totalTrades: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBarsHeld: number;
  bestTradePct: number;
  worstTradePct: number;
  buyAndHoldPct: number;
  /** % of bars spent in a position */
  exposurePct: number;
  long: SideStats;
  short: SideStats;
  /** Side of the last signal-driven position still open at the final bar */
  openSide: Side | null;
  /** Most recent non-zero signal: +1 / -1, and how many bars ago */
  lastSignal: { dir: 1 | -1; barsAgo: number } | null;
}

export interface BacktestResult extends BacktestStats {
  trades: Trade[];
  /** Mark-to-market equity, % per bar */
  equityCurve: number[];
  signals: number[];
}

/** Light result for ranking many indicators at once */
export interface BacktestSummary extends BacktestStats {
  /** Downsampled equity curve for sparklines */
  spark: number[];
}

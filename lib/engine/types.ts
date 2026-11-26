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
  /** Rendered as an on/off switch (value 0 / 1) */
  toggle?: boolean;
  /** Only shown when another param has this value (e.g. filter settings when useFilter = 1) */
  visibleWhen?: { key: string; value: number };
  /** Shown but not editable (e.g. a mode the original source removed) */
  locked?: boolean;
  /** Choice list (value = option index) — rendered as a select instead of a number */
  options?: string[];
}

/** Where an indicator comes from — shown as a badge and usable as a filter */
export type Source = "v1" | "v2" | "v3" | "v4" | "v5" | "v6";

export const SOURCE_LABELS: Record<Source, string> = {
  v1: "V1 · ชุดเดิม",
  v2: "V2 · TradingView ยอดนิยม",
  v3: "V3 · OrderFlow",
  v4: "V4 · YouTube",
  v5: "V5 · SMC LuxAlgo",
  v6: "V6 · Pine Pennant",
};

/** How positions are filled: at the close of the signal bar, or at the next bar's open */
export type FillMode = "close" | "nextOpen";

/** Context passed to compute() — results depend on where evaluation starts */
export interface ComputeContext {
  /** First bar that may hold a position (everything before is warm-up) */
  startIndex: number;
  /** Detected bar spacing in minutes */
  tfMinutes: number;
}

/**
 * Target position per bar (decided at the close, executed at the next open):
 * +x = long x of equity, −x = short, 0 = flat.
 */
export interface ExposureOutput {
  exposure: number[];
  /** Price at which a position was closed *inside* the bar (SL/TP touched) — null otherwise */
  exitFill?: (number | null)[];
}

export type EngineKind =
  | { kind: "signal" }
  /** Strategy manages its own entries/exits; direction is fixed by the strategy */
  | { kind: "exposure"; direction: TradeMode; /** default next open */ fill?: FillMode };

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
  /** Value at `to` for a sloped segment (defaults to `value`) */
  value2?: number;
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
  /** Defaults to "v1" */
  source?: Source;
  /** Thai: what triggers a bullish (+1) signal */
  longRule?: string;
  /** Thai: what triggers a bearish (-1) signal */
  shortRule?: string;
  /** Thai: free-form description (used when long/short rules don't apply, e.g. exposure strategies) */
  description?: string;
  params: ParamDef[];
  /** Minimum bars needed before the indicator produces anything meaningful */
  minBars: number;
  /** Warm-up bars before evaluation should start (defaults to minBars) */
  warmupBars?(p: Params, tfMinutes: number): number;
  /** Fill timing when the user leaves it on "auto" (defaults to "close") */
  defaultFill?: FillMode;
  compute(bars: Bars, p: Params, ctx: ComputeContext): R;
  /** Used when engine(p) is "signal" (the default) */
  signals(r: R, bars: Bars, p: Params): SignalArray;
  /** Which engine runs this indicator for the given params (defaults to signal) */
  engine?(p: Params): EngineKind;
  /** Used when engine(p) is "exposure" */
  exposure?(r: R, bars: Bars, p: Params): ExposureOutput;
  /** Per-bar explanation of what the strategy did / why it waited */
  reasons?(r: R, p: Params): (string | null)[] | null;
  /** Cross-parameter validation — returns a Thai message when invalid */
  validate?(p: Params): string | null;
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

/** Higher timeframe used as a trend filter */
export type HtfInterval = "2h" | "4h" | "6h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";
/** Nominal length in minutes (1M = 30 days; real month ends come from the bars' closeTime) */
export const HTF_MINUTES: Record<HtfInterval, number> = {
  "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080, "1M": 43200,
};
export const HTF_LABELS: Record<HtfInterval, string> = {
  "2h": "2H", "4h": "4H", "6h": "6H", "8h": "8H", "12h": "12H", "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
};
export const HTF_INTERVALS = Object.keys(HTF_MINUTES) as HtfInterval[];

/**
 * Multi-timeframe trend filter: one indicator run on the higher timeframe decides the side.
 * After its Buy signal only Long entries are taken, after its Sell signal only Short entries
 * (the state between signals, like trading that indicator) — for strategies that manage their
 * own exits, the side they hold (flat = unknown). Signals against it can still close
 * a position; a position is never forced out when the higher timeframe flips.
 * Only *closed* higher-timeframe bars are used (no lookahead).
 */
export interface HtfFilter {
  enabled: boolean;
  interval: HtfInterval;
  /** Indicator id whose signals define the direction (any registered indicator) */
  indicator: string;
  /** Params per indicator id — missing keys use the indicator's defaults */
  params: Record<string, Params>;
  /** @deprecated EMA Cross lengths from the first version — read once into params.ema_cross */
  fast?: number;
  slow?: number;
}

export interface BacktestConfig {
  mode: TradeMode;
  /** "auto" = use the indicator's defaultFill */
  fill: "auto" | FillMode;
  /** Fee per side, % */
  feesPct: number;
  /** Slippage per side, % */
  slippagePct: number;
  stopLoss: StopRule;
  takeProfit: StopRule;
  trailing: StopRule;
  /** Close a position when the opposite signal appears */
  exitOnOpposite: boolean;
  /** Higher-timeframe trend filter (applies only when the chart timeframe is lower) */
  htf: HtfFilter;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  mode: "both",
  fill: "auto",
  feesPct: 0.1,
  slippagePct: 0,
  stopLoss: { kind: "none", value: 2 },
  takeProfit: { kind: "none", value: 4 },
  trailing: { kind: "none", value: 2 },
  exitOnOpposite: true,
  htf: { enabled: false, interval: "1d", indicator: "ema_cross", params: {} },
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
  /** Fraction of equity in the trade (1 = 100%) */
  size: number;
  /** The strategy's own explanation at entry / exit (v2–v5) */
  entryNote?: string;
  exitNote?: string;
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

export interface RunInfo {
  engine: "signal" | "exposure";
  fill: FillMode;
  /** Direction actually traded (exposure strategies lock it) */
  direction: TradeMode;
  /** First evaluated bar; bars before it are warm-up */
  startIndex: number;
  warmupBars: number;
  /** Higher-timeframe filter that was applied to this run (null = none) */
  htf: HtfReport | null;
}

export interface HtfReport {
  interval: HtfInterval;
  /** Indicator id used as the filter */
  indicator: string;
  /** Entries skipped because they went against the higher timeframe */
  blocked: number;
  /** Evaluated bars by higher-timeframe state */
  bullBars: number;
  bearBars: number;
  /** Bars without a known state (not enough higher-timeframe history) — no entries there */
  unknownBars: number;
}

export interface BacktestResult extends BacktestStats, RunInfo {
  trades: Trade[];
  /** Mark-to-market equity, % per bar */
  equityCurve: number[];
  signals: number[];
  /** Strategy's per-bar explanations (v2 filtered / v3–v5) */
  reasons: (string | null)[] | null;
}

/** Light result for ranking many indicators at once */
export interface BacktestSummary extends BacktestStats, RunInfo {
  /** Downsampled equity curve for sparklines */
  spark: number[];
}

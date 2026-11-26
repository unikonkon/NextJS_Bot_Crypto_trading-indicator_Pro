"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type UTCTimestamp,
  type Time,
  type MouseEventParams,
} from "lightweight-charts";
import { ComputeCache, planRun } from "@/lib/engine/registry";
import type { Bars, IndicatorDef, PanePlot, Params, PlotOutput, SeriesPlot, Trade } from "@/lib/engine/types";
import { ArrowsVertical } from "@phosphor-icons/react";
import { fmtPrice } from "../lib/format";

export interface ChartIndicator {
  def: IndicatorDef;
  params: Params;
  /** The indicator driving the backtest — its bar colors & markers are used */
  isStrategy: boolean;
}

interface Props {
  bars: Bars;
  indicators: ChartIndicator[];
  trades: Trade[] | null;
  showTrades: boolean;
  compact: boolean;
  /** Same evaluation window as the backtest, so stateful strategies plot identically */
  evalBars?: number;
  /** Extra price-pane lines (e.g. the higher-timeframe filter's lines) */
  extraOverlays?: SeriesPlot[];
  /** Extra thin panes under the price (e.g. the higher-timeframe direction strip) */
  extraPanes?: PanePlot[];
  /** Trade picked in the history: scroll to it and mark its entry / exit (`seq` re-focuses the same trade) */
  focus?: { trade: Trade; seq: number } | null;
  // ─── Live use (trading bot) — all optional, the backtest page passes none ───
  /** Keep the zoom / scroll position while `bars` is replaced; refit only when this key changes */
  fitKey?: string;
  /** Candle still in progress, drawn after the last bar without recomputing the indicators */
  liveBar?: LiveBar | null;
  /** Horizontal price lines (the bot's entry, stop-loss, take-profit…) */
  priceLines?: ChartPriceLine[];
  /** Do not draw an exit marker for the trade that is only closed by the end of the data (still open live) */
  hideEndExit?: boolean;
}

export interface LiveBar {
  /** Open time, ms */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartPriceLine {
  price: number;
  color: string;
  title: string;
}

const UP = "#10b981";
const DOWN = "#ef4444";
const toUTC = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

function themeOptions(dark: boolean) {
  const grid = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
  const cross = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
  const border = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
  return {
    layout: {
      background: { color: "transparent" },
      textColor: dark ? "#9ca3af" : "#6b7280",
      fontSize: 11,
      panes: { separatorColor: border, separatorHoverColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", enableResize: true },
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: cross, width: 1 as const, style: 3 as const },
      horzLine: { color: cross, width: 1 as const, style: 3 as const },
    },
    rightPriceScale: { borderColor: border },
    timeScale: { borderColor: border },
  };
}

const TRANSPARENT = "rgba(0,0,0,0)";
const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/**
 * lightweight-charts v5 joins a line across whitespace, and each segment takes the
 * color of its *starting* point. To render real gaps (e.g. Supertrend up/down halves)
 * the last point before every gap gets a transparent color.
 */
function plotData(times: UTCTimestamp[], s: SeriesPlot) {
  const out: ({ time: Time; value: number; color?: string } | { time: Time })[] = [];
  const breakGaps = s.kind === "line" && !s.connectGaps && !s.points;
  for (let i = 0; i < times.length; i++) {
    const v = s.values[i];
    if (!has(v)) {
      if (s.kind === "histogram") out.push({ time: times[i] });
      continue;
    }
    let c = s.colors?.[i] ?? undefined;
    if (breakGaps && i + 1 < times.length && !has(s.values[i + 1])) c = TRANSPARENT;
    out.push(c ? { time: times[i], value: v, color: c } : { time: times[i], value: v });
  }
  return out;
}

function writeLegend(el: HTMLDivElement | null, b: Bars, idx: number, live?: LiveBar | null) {
  if (!el || b.length === 0) return;
  const i = Math.max(0, Math.min(b.length - 1, idx));
  const useLive = !!live && idx >= b.length;
  const o = useLive ? live.open : b.open[i], h = useLive ? live.high : b.high[i], l = useLive ? live.low : b.low[i], c = useLive ? live.close : b.close[i];
  const chg = ((c - o) / o) * 100;
  const tone = c >= o ? UP : DOWN;
  // Values are numbers formatted by us — safe to inject
  el.innerHTML =
    `<span>O <b style="color:${tone}">${fmtPrice(o)}</b></span> ` +
    `<span>H <b style="color:${tone}">${fmtPrice(h)}</b></span> ` +
    `<span>L <b style="color:${tone}">${fmtPrice(l)}</b></span> ` +
    `<span>C <b style="color:${tone}">${fmtPrice(c)}</b></span> ` +
    `<b style="color:${tone}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</b>`;
}

export default function PriceChart({ bars, indicators, trades, showTrades, compact, evalBars, extraOverlays, extraPanes, focus, fitKey, liveBar, priceLines, hideEndExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const fittedBarsRef = useRef<Bars | string | null>(null);
  const focusLinesRef = useRef<IPriceLine[]>([]);
  const userLinesRef = useRef<IPriceLine[]>([]);
  const shownLenRef = useRef(0);
  const barsRef = useRef(bars);
  const liveRef = useRef<LiveBar | null>(liveBar ?? null);
  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);
  useEffect(() => {
    liveRef.current = liveBar ?? null;
  }, [liveBar]);

  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  // Indicator plots, computed on the main thread (only the few shown on the chart)
  const cache = useMemo(() => new ComputeCache(bars, 24), [bars]);
  const plots = useMemo(() => {
    const out: { ind: ChartIndicator; plot: PlotOutput; startIndex: number }[] = [];
    for (const ind of indicators) {
      if (!ind.def.plot || bars.length < ind.def.minBars) continue;
      try {
        const { ctx } = planRun(ind.def, ind.params, bars, evalBars);
        if (ctx.startIndex >= bars.length) continue;
        out.push({ ind, startIndex: ctx.startIndex, plot: ind.def.plot(cache.compute(ind.def, ind.params, ctx), bars, ind.params, { dark }) });
      } catch (err) {
        console.error(`[chart] plot failed for ${ind.def.id}`, err);
      }
    }
    return out;
  }, [cache, indicators, bars, dark, evalBars]);

  const paneCount = plots.reduce((n, p) => n + (p.plot.panes?.length ?? 0), 0);
  const stripCount = extraPanes?.length ?? 0;
  const height = (compact ? 320 : 460) + paneCount * (compact ? 110 : 140) + stripCount * 44;

  // ─── Create chart once ────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      ...themeOptions(true),
      timeScale: { ...themeOptions(true).timeScale, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScroll: { vertTouchDrag: false },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    markersRef.current = createSeriesMarkers(candle, []);

    const renderLegend = (param?: MouseEventParams<Time>) => {
      const b = barsRef.current;
      // Not hovering → the newest candle (the one in progress when there is one)
      let i = liveRef.current ? b.length : b.length - 1;
      if (param?.logical !== undefined && param.time !== undefined) i = Math.round(param.logical);
      writeLegend(legendRef.current, b, i, liveRef.current);
    };
    chart.subscribeCrosshairMove(renderLegend);

    chartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;
    return () => {
      chart.unsubscribeCrosshairMove(renderLegend);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      markersRef.current = null;
      focusLinesRef.current = [];
      userLinesRef.current = [];
      indicatorSeriesRef.current = [];
      fittedBarsRef.current = null;
      shownLenRef.current = 0;
    };
  }, []);

  // ─── Theme ────────────────────────────────────────────────
  useEffect(() => {
    chartRef.current?.applyOptions(themeOptions(dark));
  }, [dark]);

  // ─── Candles, volume and indicator series ─────────────────
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current, vol = volRef.current;
    if (!chart || !candle || !vol) return;
    const times = bars.time.map(toUTC);
    const barColors = plots.find((p) => p.ind.isStrategy)?.plot.barColors;
    // Live: remember where the user is looking, to follow new candles only when the newest one is in view
    const rangeBefore = fitKey !== undefined ? chart.timeScale().getVisibleLogicalRange() : null;
    const lenBefore = shownLenRef.current;
    shownLenRef.current = bars.length;

    candle.setData(times.map((time, i) => {
      const c = barColors?.[i];
      const base = { time, open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i] };
      return c ? { ...base, color: c, wickColor: c, borderColor: c } : base;
    }));
    vol.setData(times.map((time, i) => ({
      time,
      value: bars.volume[i],
      color: bars.close[i] >= bars.open[i] ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)",
    })));

    // Rebuild indicator series (the chart itself and the zoom are kept)
    for (const s of indicatorSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* already gone with its pane */ }
    }
    indicatorSeriesRef.current = [];
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

    const add = (s: SeriesPlot, pane: number, overlay: boolean) => {
      const common = { priceLineVisible: false, lastValueVisible: !overlay, title: overlay ? "" : s.title, crosshairMarkerVisible: !overlay };
      const api = s.kind === "histogram"
        ? chart.addSeries(HistogramSeries, { ...common, color: s.color }, pane)
        : chart.addSeries(LineSeries, {
            ...common,
            color: s.color,
            lineWidth: s.width ?? 1,
            lineStyle: s.style ?? 0,
            ...(s.points ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 } : {}),
          }, pane);
      api.setData(plotData(times, s) as never);
      indicatorSeriesRef.current.push(api);
      return api;
    };

    for (const o of extraOverlays ?? []) add(o, 0, true);
    let paneIdx = 1;
    const last = bars.length - 1;
    for (const { plot } of plots) {
      for (const o of plot.overlays ?? []) add(o, 0, true);
      for (const seg of (plot.segments ?? []).slice(-80)) {
        if (seg.from < 0 || seg.to > last || seg.from >= seg.to) continue;
        const api = chart.addSeries(LineSeries, {
          color: seg.color, lineWidth: seg.width ?? 1, lineStyle: seg.style ?? 0,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, 0);
        api.setData([{ time: times[seg.from], value: seg.value }, { time: times[seg.to], value: seg.value2 ?? seg.value }]);
        indicatorSeriesRef.current.push(api);
      }
      for (const pane of plot.panes ?? []) {
        const idx = paneIdx++;
        pane.series.forEach((s, j) => {
          const api = add(s, idx, false);
          if (j === 0) for (const lv of pane.levels ?? []) {
            api.createPriceLine({ price: lv.value, color: lv.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
          }
        });
      }
    }
    const firstStrip = paneIdx;
    for (const pane of extraPanes ?? []) {
      const idx = paneIdx++;
      for (const s of pane.series) add(s, idx, false);
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(compact ? 2.4 : 3.2);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(i >= firstStrip ? 0.25 : 1);

    const fitToken = fitKey ?? bars;
    if (fittedBarsRef.current !== fitToken && bars.length > 0) {
      fittedBarsRef.current = fitToken;
      writeLegend(legendRef.current, bars, bars.length - 1);
      const n = bars.length;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (compact ? 120 : 220)), to: n + 3 });
    } else if (rangeBefore && lenBefore > 0 && bars.length !== lenBefore) {
      // Same market, candles appended (or older ones dropped): keep the same candles in view
      const d = bars.length - lenBefore;
      if (d < 0 || rangeBefore.to >= lenBefore - 1) chart.timeScale().setVisibleLogicalRange({ from: rangeBefore.from + d, to: rangeBefore.to + d });
    }
  }, [bars, plots, compact, extraOverlays, extraPanes, fitKey]);

  // ─── Live: the candle in progress (after setData above, which drops it) ───
  useEffect(() => {
    const candle = candleRef.current, vol = volRef.current;
    const n = bars.length;
    if (!candle || !vol || !liveBar || n === 0 || liveBar.time <= bars.time[n - 1]) return;
    const time = toUTC(liveBar.time);
    try {
      candle.update({ time, open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close });
      vol.update({ time, value: liveBar.volume, color: liveBar.close >= liveBar.open ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)" });
    } catch {
      /* older than the newest drawn candle — the next full update fixes it */
    }
    writeLegend(legendRef.current, bars, n, liveBar);
  }, [bars, plots, compact, extraOverlays, extraPanes, liveBar]);

  // ─── Live: price lines (entry / stop-loss / take-profit) ──
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    for (const l of userLinesRef.current) candle.removePriceLine(l);
    userLinesRef.current = (priceLines ?? []).map((l) =>
      candle.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.title }));
  }, [priceLines]);

  // ─── Markers: trades (Long ▲ / Short ▼ / exits ●) or indicator markers ─
  useEffect(() => {
    const api = markersRef.current;
    if (!api) return;
    const markers: SeriesMarker<Time>[] = [];
    if (showTrades && trades && trades.length) {
      const withText = trades.length <= 250;
      const picked = focus?.trade;
      for (const t of trades) {
        const long = t.side === "long";
        const on = t === picked;
        markers.push({
          time: toUTC(t.entryTime),
          position: long ? "belowBar" : "aboveBar",
          color: long ? UP : DOWN,
          shape: long ? "arrowUp" : "arrowDown",
          text: on ? (long ? "เข้า Long" : "เข้า Short") : long ? "L" : "S",
          ...(on ? { size: 2 } : {}),
        });
        if (hideEndExit && t.exitReason === "end") continue;
        markers.push({
          time: toUTC(t.exitTime),
          position: long ? "aboveBar" : "belowBar",
          color: t.pnlPct >= 0 ? UP : DOWN,
          shape: "circle",
          text: withText || on ? `${on ? (t.exitReason === "end" ? "ถืออยู่ " : "ออก ") : ""}${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%` : undefined,
          ...(on ? { size: 2 } : {}),
        });
      }
    } else {
      for (const { plot } of plots) {
        for (const m of plot.markers ?? []) {
          if (m.index < 0 || m.index >= bars.length) continue;
          markers.push({ time: toUTC(bars.time[m.index]), position: m.position, color: m.color, shape: m.shape, text: m.text });
        }
      }
    }
    // Where the backtest starts counting (everything before is warm-up)
    const start = plots.find((p) => p.ind.isStrategy)?.startIndex ?? 0;
    if (start > 0 && start < bars.length) {
      markers.push({ time: toUTC(bars.time[start]), position: "aboveBar", color: "#f59e0b", shape: "square", text: "เริ่มประเมิน" });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    api.setMarkers(markers);
  }, [trades, showTrades, plots, bars, focus, hideEndExit]);

  // ─── Focus a trade picked in the history ──────────────────
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current, el = containerRef.current;
    if (!chart || !candle || !el) return;
    for (const l of focusLinesRef.current) candle.removePriceLine(l);
    focusLinesRef.current = [];
    const t = focus?.trade;
    if (!t || t.entryIdx < 0 || t.exitIdx >= bars.length) return;

    const long = t.side === "long";
    const win = t.pnlPct >= 0;
    focusLinesRef.current = [
      candle.createPriceLine({ price: t.entryPrice, color: long ? UP : DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: long ? "เข้า L" : "เข้า S" }),
      candle.createPriceLine({ price: t.exitPrice, color: win ? UP : DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `${t.exitReason === "end" ? "ถืออยู่" : "ออก"} ${win ? "+" : ""}${t.pnlPct.toFixed(1)}%` }),
    ];

    // Show the whole trade with some bars around it (at least a readable window)
    const len = t.exitIdx - t.entryIdx;
    const pad = Math.max(compact ? 20 : 30, Math.round(len * 0.4));
    // …but not into empty space past either end of the data (e.g. a position still open at the last bar)
    const range = { from: Math.max(-3, t.entryIdx - pad), to: Math.min(bars.length + 3, t.exitIdx + pad) };
    // On mobile the chart tab may still be hidden (width 0) — wait until it is laid out
    let tries = 0;
    let raf = 0;
    const apply = () => {
      if (el.clientWidth === 0 && tries++ < 60) { raf = requestAnimationFrame(apply); return; }
      chart.timeScale().setVisibleLogicalRange(range);
      // once more after the resize observer has applied the new width
      raf = requestAnimationFrame(() => chart.timeScale().setVisibleLogicalRange(range));
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [focus, bars, compact]);

  /** Fit the Y axis only: every pane's price scale back to auto-scale (the time range is left as it is) */
  const fitPriceAxis = () => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const pane of chart.panes()) {
      try { pane.priceScale("right").applyOptions({ autoScale: true }); } catch { /* pane without a right scale */ }
    }
    chart.priceScale("vol").applyOptions({ autoScale: true });
  };

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Sits in the empty corner where the time axis meets the price axis */}
      <button
        type="button"
        onClick={fitPriceAxis}
        title="ปรับแกนราคา (แกน Y) ให้พอดีกับแท่งที่เห็นอยู่ · ไม่เลื่อนช่วงเวลา"
        aria-label="ปรับแกนราคาให้พอดี"
        className="absolute bottom-0.5 right-0.5 z-10 flex h-6 items-center gap-1 border bg-background/90 px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-primary hover:text-foreground"
      >
        <ArrowsVertical size={12} weight="bold" /> พอดี
      </button>
      <div
        ref={legendRef}
        className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap gap-x-2 text-[10px] tabular-nums text-muted-foreground"
      />
    </div>
  );
}

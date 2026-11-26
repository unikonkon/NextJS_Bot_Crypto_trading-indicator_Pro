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
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type UTCTimestamp,
  type Time,
  type MouseEventParams,
} from "lightweight-charts";
import { ComputeCache, planRun } from "@/lib/engine/registry";
import type { Bars, IndicatorDef, Params, PlotOutput, SeriesPlot, Trade } from "@/lib/engine/types";
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

function writeLegend(el: HTMLDivElement | null, b: Bars, idx: number) {
  if (!el || b.length === 0) return;
  const i = Math.max(0, Math.min(b.length - 1, idx));
  const o = b.open[i], h = b.high[i], l = b.low[i], c = b.close[i];
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

export default function PriceChart({ bars, indicators, trades, showTrades, compact, evalBars }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const fittedBarsRef = useRef<Bars | null>(null);
  const barsRef = useRef(bars);
  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);

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
  const height = (compact ? 320 : 460) + paneCount * (compact ? 110 : 140);

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
      let i = b.length - 1;
      if (param?.logical !== undefined && param.time !== undefined) i = Math.round(param.logical);
      writeLegend(legendRef.current, b, i);
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
      indicatorSeriesRef.current = [];
      fittedBarsRef.current = null;
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
        api.setData([{ time: times[seg.from], value: seg.value }, { time: times[seg.to], value: seg.value }]);
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
    const panes = chart.panes();
    panes[0]?.setStretchFactor(compact ? 2.4 : 3.2);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    if (fittedBarsRef.current !== bars && bars.length > 0) {
      fittedBarsRef.current = bars;
      writeLegend(legendRef.current, bars, bars.length - 1);
      const n = bars.length;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (compact ? 120 : 220)), to: n + 3 });
    }
  }, [bars, plots, compact]);

  // ─── Markers: trades (Long ▲ / Short ▼ / exits ●) or indicator markers ─
  useEffect(() => {
    const api = markersRef.current;
    if (!api) return;
    const markers: SeriesMarker<Time>[] = [];
    if (showTrades && trades && trades.length) {
      const withText = trades.length <= 250;
      for (const t of trades) {
        const long = t.side === "long";
        markers.push({
          time: toUTC(t.entryTime),
          position: long ? "belowBar" : "aboveBar",
          color: long ? UP : DOWN,
          shape: long ? "arrowUp" : "arrowDown",
          text: long ? "L" : "S",
        });
        markers.push({
          time: toUTC(t.exitTime),
          position: long ? "aboveBar" : "belowBar",
          color: t.pnlPct >= 0 ? UP : DOWN,
          shape: "circle",
          text: withText ? `${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%` : undefined,
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
  }, [trades, showTrades, plots, bars]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={legendRef}
        className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap gap-x-2 text-[10px] tabular-nums text-muted-foreground"
      />
    </div>
  );
}

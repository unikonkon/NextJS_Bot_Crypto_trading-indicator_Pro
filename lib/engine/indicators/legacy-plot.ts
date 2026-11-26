import type { Bars, LinePlot, PlotOutput } from "../types";

type Series = (number | null)[];

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** True when the series lives on the price scale (e.g. EMA, stop) rather than an oscillator */
export function isPriceLike(values: Series, bars: Bars): boolean {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 400));
  for (let i = 0; i < values.length; i += step) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) sample.push(Math.abs(v));
  }
  const m = median(sample);
  const c = median(bars.close.filter((_, i) => i % step === 0));
  return m > 0 && c > 0 && m / c > 0.5 && m / c < 2;
}

/** Put a named series on the price chart or in its own pane depending on its scale */
export function autoPlot(values: Series | undefined, title: string, bars: Bars, color: string): PlotOutput {
  if (!values || !Array.isArray(values) || values.length !== bars.length) return {};
  const line: LinePlot = { kind: "line", title, color, values, width: 2 };
  return isPriceLike(values, bars) ? { overlays: [line] } : { panes: [{ title, series: [line] }] };
}

/** Stop / target levels of the open position as dashed lines */
export function levelLines(stop?: Series, target?: Series): LinePlot[] {
  const out: LinePlot[] = [];
  if (stop) out.push({ kind: "line", title: "Stop", color: "rgba(239,68,68,0.8)", style: 2, values: stop });
  if (target) out.push({ kind: "line", title: "Target", color: "rgba(16,185,129,0.8)", style: 2, values: target });
  return out;
}

export function mergePlots(...parts: PlotOutput[]): PlotOutput {
  return {
    overlays: parts.flatMap((p) => p.overlays ?? []),
    panes: parts.flatMap((p) => p.panes ?? []),
    segments: parts.flatMap((p) => p.segments ?? []),
    markers: parts.flatMap((p) => p.markers ?? []),
  };
}

"use client";

import { useId, useMemo } from "react";

interface Props {
  curve: number[];
  /** Optional comparison line (buy & hold %) of the same length */
  benchmark?: number[];
  height?: number;
}

const W = 1000;

function downsample(arr: number[], max: number): number[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

/** Responsive SVG equity curve — green above 0%, red below, dashed buy & hold */
export function EquityChart({ curve, benchmark, height = 180 }: Props) {
  const id = useId().replace(/:/g, "");
  const { path, area, bench, zeroY, max, min } = useMemo(() => {
    const c = downsample(curve, 500);
    const b = benchmark ? downsample(benchmark, 500) : null;
    const all = b ? [...c, ...b, 0] : [...c, 0];
    const max = Math.max(...all);
    const min = Math.min(...all);
    const range = max - min || 1;
    const y = (v: number) => ((max - v) / range) * height;
    const x = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
    const pts = c.map((v, i) => `${x(i, c.length).toFixed(1)},${y(v).toFixed(1)}`);
    const zeroY = y(0);
    return {
      path: `M${pts.join("L")}`,
      area: `M0,${zeroY}L${pts.join("L")}L${W},${zeroY}Z`,
      bench: b ? `M${b.map((v, i) => `${x(i, b.length).toFixed(1)},${y(v).toFixed(1)}`).join("L")}` : null,
      zeroY,
      max,
      min,
    };
  }, [curve, benchmark, height]);

  if (curve.length < 2) return null;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <clipPath id={`${id}-up`}><rect x="0" y="0" width={W} height={Math.max(0, zeroY)} /></clipPath>
          <clipPath id={`${id}-dn`}><rect x="0" y={zeroY} width={W} height={Math.max(0, height - zeroY)} /></clipPath>
        </defs>
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {bench && <path d={bench} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        <g clipPath={`url(#${id}-up)`}>
          <path d={area} fill="#10b981" fillOpacity="0.15" />
          <path d={path} fill="none" stroke="#10b981" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </g>
        <g clipPath={`url(#${id}-dn)`}>
          <path d={area} fill="#ef4444" fillOpacity="0.15" />
          <path d={path} fill="none" stroke="#ef4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <span className="absolute right-1 top-0 text-[9px] tabular-nums text-emerald-500">+{max.toFixed(1)}%</span>
      <span className="absolute bottom-0 right-1 text-[9px] tabular-nums text-red-500">{min.toFixed(1)}%</span>
    </div>
  );
}

/** Tiny sparkline for ranking rows */
export function Sparkline({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(((max - v) / range) * height).toFixed(1)}`);
  const zeroY = ((max - 0) / range) * height;
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden>
      <line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="2 2" />
      <polyline points={pts.join(" ")} fill="none" stroke={last >= 0 ? "#10b981" : "#ef4444"} strokeWidth="1.25" />
    </svg>
  );
}

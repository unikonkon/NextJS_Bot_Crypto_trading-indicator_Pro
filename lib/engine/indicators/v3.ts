/**
 * Adapters for V3_REGISTRY — OrderFlow / FlowGate (v3), Horizon Flow (v4) and SMC LuxAlgo (v5).
 * These strategies state a target exposure per bar and manage their own exits, so they run on
 * the exposure engine (next-open fills, intrabar exitFill for v4). Direction is fixed by the id.
 */
import { V3_REGISTRY, V3_PARAM_META, V3_STRATEGY_IDS, computeV3, type V3Result, type V3StrategyId } from "@/lib/indicators-v3";
import { defineIndicator, type Category, type IndicatorDef, type ParamDef, type Source, type TradeMode } from "../types";
import { autoPlot, levelLines, mergePlots } from "./legacy-plot";

function sourceOf(id: string): Source {
  if (id.startsWith("horizon_flow")) return "v4";
  if (id.startsWith("smc_luxalgo")) return "v5";
  return "v3";
}

const CATEGORY: Record<Source, Category> = { v1: "trend", v2: "trend", v3: "volume", v4: "trend", v5: "structure", v6: "structure" };

function directionOf(d: { allowLong: number; allowShort: number }): TradeMode {
  if (d.allowLong >= 0.5 && d.allowShort >= 0.5) return "both";
  return d.allowShort >= 0.5 ? "short" : "long";
}

function adapt(id: V3StrategyId): IndicatorDef {
  const def3 = V3_REGISTRY[id];
  const source = sourceOf(id);
  const direction = directionOf(def3.direction);
  const overlayField = def3.overlay.split(".")[1];

  const params: ParamDef[] = Object.entries(def3.defaults).map(([key, value]) => {
    const m = V3_PARAM_META[key];
    const min = Math.min(m?.min ?? 0, value);
    const max = Math.max(m?.max ?? Math.max(1, value * 10), value);
    return {
      key,
      label: m?.label ?? key,
      default: value,
      min,
      max,
      step: m?.step ?? (Number.isInteger(value) ? 1 : 0.01),
      toggle: !!m?.integer && m.min === 0 && m.max === 1,
    };
  });

  return defineIndicator<V3Result>({
    id,
    name: def3.name,
    category: CATEGORY[source],
    source,
    description: def3.th,
    params,
    minBars: 50,
    defaultFill: "nextOpen",
    warmupBars: (p, tf) => def3.warmupBars({ ...def3.defaults, ...p }, tf || undefined),
    validate: (p) => def3.validate({ ...def3.defaults, ...p }),
    compute: (b, p, ctx) => computeV3(id, b.klines, p, ctx.startIndex),
    engine: () => ({ kind: "exposure", direction }),
    signals: (r) => new Int8Array(r.exposure.length),
    exposure: (r) => ({ exposure: r.exposure, exitFill: r.exitFill }),
    reasons: (r) => r.reason,
    plot: (r, b) => {
      const series = (r as unknown as Record<string, unknown>)[overlayField] as (number | null)[] | undefined;
      return mergePlots(
        autoPlot(series, overlayField, b, "#a78bfa"),
        { overlays: levelLines(r.stop, r.target) },
        // OrderFlow: the net-flow signal itself is the most useful thing to see
        source === "v3" ? autoPlot(r.signalValue, "Net flow", b, "#22d3ee") : {},
      );
    },
  });
}

export const V3_DEFS: IndicatorDef[] = V3_STRATEGY_IDS.map(adapt);

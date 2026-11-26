/**
 * Adapters for lib/indicators-v2.ts — 20 TradingView-popular indicators.
 * The original math is used unchanged; this file only describes each one to the engine.
 *
 *  • "useFilter" = 0 → raw `signal` through the signal engine (Long / Short / both, user's choice).
 *    Inverted strategies (supertrend_v2) keep the original's BUY↔SELL swap via v2SignalOf().
 *  • "useFilter" = 1 → `signalFiltered` (trend/ADX/volatility filter + ATR stop, trailing, max hold)
 *    run as an exposure strategy: long-only, exits decided by the filter, filled at the next open —
 *    exactly as the original engine runs `<id>_filtered`.
 *  • Plain modes the original removed from its strategy list are locked to the filtered mode.
 */
import {
  V2_INDICATORS,
  V2_PARAM_META,
  TRADE_FILTER_DEFAULTS,
  INVERTED_V2_STRATEGIES,
  isV2StrategyId,
  v2SignalOf,
  v2WarmupBars,
  validateV2Params,
  type V2Base,
  type V2IndicatorDef,
  type V2StrategyId,
} from "@/lib/indicators-v2";
import { defineIndicator, type Category, type IndicatorDef, type ParamDef, type Params } from "../types";
import { fromBuySell } from "../math";
import { autoPlot, levelLines, mergePlots } from "./legacy-plot";

function categoryOf(group: string): Category {
  if (group.includes("ปริมาณ")) return "volume";
  if (group.includes("ผันผวน")) return "volatility";
  if (group.includes("โครงสร้าง")) return "structure";
  if (group.startsWith("โมเมนตัม") || group.includes("ML")) return "momentum";
  return "trend";
}

function paramFromMeta(key: string, def: number, meta?: { label: string; min: number; max: number; step: number; integer: boolean }): ParamDef {
  const m = meta ?? { label: key, min: Math.min(0, def), max: Math.max(1, def * 10), step: Number.isInteger(def) ? 1 : 0.01, integer: Number.isInteger(def) };
  return {
    key,
    label: m.label,
    default: def,
    min: Math.min(m.min, def),
    max: Math.max(m.max, def),
    step: m.step,
    toggle: m.integer && m.min === 0 && m.max === 1,
  };
}

const filterOn = (p: Params) => (p.useFilter ?? 0) >= 0.5;
const strategyId = (d: V2IndicatorDef, p: Params) => (filterOn(p) ? `${d.id}_filtered` : d.id) as V2StrategyId;

function adapt(d: V2IndicatorDef): IndicatorDef {
  const plainAllowed = isV2StrategyId(d.id);
  const inverted = INVERTED_V2_STRATEGIES.has(d.id as V2StrategyId);
  const overlayField = d.overlay.split(".")[1];

  const params: ParamDef[] = [
    ...Object.entries(d.core).map(([k, v]) => paramFromMeta(k, v, V2_PARAM_META[k])),
    {
      key: "useFilter",
      label: "ใช้ตัวกรอง + ATR stop (ขาขึ้นอย่างเดียว)",
      hint: plainAllowed ? "เปิด = กรองด้วย EMA/ADX/ความผันผวน และออกด้วย stop/trailing/เวลาถือ" : "ต้นฉบับถอดโหมดสัญญาณดิบของตัวนี้ออก จึงใช้ได้เฉพาะโหมดกรอง",
      default: plainAllowed ? 0 : 1,
      min: plainAllowed ? 0 : 1,
      max: 1,
      step: 1,
      toggle: true,
      locked: !plainAllowed,
    },
    ...Object.entries(TRADE_FILTER_DEFAULTS).map(([k, v]) => ({
      ...paramFromMeta(k, v, V2_PARAM_META[k]),
      visibleWhen: { key: "useFilter", value: 1 },
    })),
  ];

  return defineIndicator<V2Base>({
    id: d.id,
    name: d.name,
    category: categoryOf(d.group),
    source: "v2",
    description: `${d.descriptionTh}${inverted ? " · โหมดสัญญาณดิบสลับ BUY↔SELL ตามต้นฉบับ" : ""}`,
    params,
    minBars: 50,
    defaultFill: "nextOpen",
    warmupBars: (p) => v2WarmupBars(strategyId(d, p), p),
    validate: (p) => validateV2Params(strategyId(d, p), p),
    compute: (b, p, ctx) => d.compute(b.klines, p, ctx.startIndex),
    engine: (p) => (filterOn(p) ? { kind: "exposure", direction: "long" } : { kind: "signal" }),
    signals: (r, _b, p) => fromBuySell(v2SignalOf(strategyId(d, p), r)),
    exposure: (r) => {
      // BUY opens, SELL closes — hold the state in between (long-only)
      let state = 0;
      return { exposure: r.signalFiltered.map((s) => (state = s === "BUY" ? 1 : s === "SELL" ? 0 : state)) };
    },
    reasons: (r, p) => (filterOn(p) ? r.filterReason : null),
    plot: (r, b, p) => {
      const series = (r as unknown as Record<string, unknown>)[overlayField] as (number | null)[] | undefined;
      return mergePlots(
        autoPlot(series, d.name.replace(/ V2$/, ""), b, "#a78bfa"),
        filterOn(p) ? { overlays: levelLines(r.filterStop) } : {},
      );
    },
  });
}

export const V2_DEFS: IndicatorDef[] = V2_INDICATORS.map(adapt);

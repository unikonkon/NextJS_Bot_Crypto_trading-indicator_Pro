import { INDICATORS } from "./indicators";
import type { Bars, Category, IndicatorDef, Params, SignalArray } from "./types";

const BY_ID = new Map<string, IndicatorDef>();
for (const def of INDICATORS) {
  if (BY_ID.has(def.id)) throw new Error(`Duplicate indicator id: ${def.id}`);
  BY_ID.set(def.id, def);
}

export function listIndicators(): IndicatorDef[] {
  return INDICATORS;
}

export function getIndicator(id: string): IndicatorDef | undefined {
  return BY_ID.get(id);
}

export function defaultParams(def: IndicatorDef): Params {
  const p: Params = {};
  for (const pd of def.params) p[pd.key] = pd.default;
  return p;
}

/** Fill missing keys with defaults and clamp to each param's range */
export function normalizeParams(def: IndicatorDef, input?: Partial<Params>): Params {
  const p: Params = {};
  for (const pd of def.params) {
    const raw = input?.[pd.key];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : pd.default;
    p[pd.key] = Math.min(pd.max, Math.max(pd.min, v));
  }
  return p;
}

export function paramsKey(id: string, p: Params): string {
  return `${id}|${Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join(",")}`;
}

export function categoriesInUse(): Category[] {
  return Array.from(new Set(INDICATORS.map((d) => d.category)));
}

/**
 * Small LRU cache of compute() results keyed by indicator+params.
 * One instance per dataset — create a new one when the bars change.
 */
export class ComputeCache {
  private map = new Map<string, unknown>();
  constructor(private bars: Bars, private max = 40) {}

  get dataBars(): Bars {
    return this.bars;
  }

  compute(def: IndicatorDef, p: Params): unknown {
    const key = paramsKey(def.id, p);
    if (this.map.has(key)) {
      const v = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, v);
      return v;
    }
    const v = def.compute(this.bars, p);
    this.map.set(key, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
    return v;
  }

  signals(def: IndicatorDef, p: Params): SignalArray {
    return def.signals(this.compute(def, p), this.bars, p);
  }
}

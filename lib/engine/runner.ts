import { runBacktest, runExposure, toSummary } from "./backtest";
import { ComputeCache, engineOf, getIndicator, normalizeParams, planRun } from "./registry";
import type { BacktestConfig, BacktestResult, BacktestSummary, FillMode, Params } from "./types";

export interface RunJob {
  indicatorId: string;
  params?: Partial<Params>;
  config: BacktestConfig;
  /** true → full result (trades + equity); false → light summary for ranking */
  full: boolean;
  /** Evaluate only the last N bars (warm-up comes from the bars before). Omit = whole dataset. */
  evalBars?: number;
}

export type JobOutput = BacktestResult | BacktestSummary;

/** Shared by the Web Worker and the main-thread fallback */
export function runJob(cache: ComputeCache, job: RunJob): JobOutput {
  const def = getIndicator(job.indicatorId);
  if (!def) throw new Error(`Unknown indicator: ${job.indicatorId}`);
  const params = normalizeParams(def, job.params);
  const invalid = def.validate?.(params);
  if (invalid) throw new Error(invalid);

  const bars = cache.dataBars;
  const { ctx, warmup } = planRun(def, params, bars, job.evalBars);
  if (bars.length - ctx.startIndex < 30) {
    throw new Error(`ข้อมูลไม่พอ: ต้องอุ่นเครื่อง ${warmup.toLocaleString()} แท่ง + ประเมินอย่างน้อย 30 แท่ง (มี ${bars.length.toLocaleString()})`);
  }

  const r = cache.compute(def, params, ctx);
  const reasons = def.reasons?.(r, params) ?? null;
  const engine = engineOf(def, params);
  let result: BacktestResult;
  if (engine.kind === "exposure") {
    if (!def.exposure) throw new Error(`${def.id}: exposure() missing`);
    result = runExposure(bars, def.exposure(r, bars, params), job.config, engine.direction, {
      startIndex: ctx.startIndex, reasons, warmupBars: warmup,
    });
  } else {
    const fill: FillMode = job.config.fill === "auto" ? def.defaultFill ?? "close" : job.config.fill;
    result = runBacktest(bars, def.signals(r, bars, params), job.config, {
      startIndex: ctx.startIndex, fill, reasons, warmupBars: warmup,
    });
  }
  return job.full ? result : toSummary(result);
}

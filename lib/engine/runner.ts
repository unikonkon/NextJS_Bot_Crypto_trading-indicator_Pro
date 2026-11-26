import { runBacktest, toSummary } from "./backtest";
import { ComputeCache, getIndicator, normalizeParams } from "./registry";
import type { BacktestConfig, BacktestResult, BacktestSummary, Params } from "./types";

export interface RunJob {
  indicatorId: string;
  params?: Partial<Params>;
  config: BacktestConfig;
  /** true → full result (trades + equity); false → light summary for ranking */
  full: boolean;
}

export type JobOutput = BacktestResult | BacktestSummary;

/** Shared by the Web Worker and the main-thread fallback */
export function runJob(cache: ComputeCache, job: RunJob): JobOutput {
  const def = getIndicator(job.indicatorId);
  if (!def) throw new Error(`Unknown indicator: ${job.indicatorId}`);
  const params = normalizeParams(def, job.params);
  const signals = cache.signals(def, params);
  const result = runBacktest(cache.dataBars, signals, job.config);
  return job.full ? result : toSummary(result);
}

import type { KlineData } from "@/lib/types/kline";
import type { JobOutput, RunJob } from "../runner";
import type { HtfInterval } from "../types";

export type WorkerRequest =
  | { type: "load"; datasetId: number; klines: KlineData[] }
  /** Higher-timeframe bars for the trend filter (null clears them) */
  | { type: "htf"; htfId: number; sets: { interval: HtfInterval; klines: KlineData[] }[] }
  | { type: "run"; jobId: number; datasetId: number; job: RunJob };

export type WorkerResponse =
  | { type: "result"; jobId: number; result: JobOutput }
  | { type: "error"; jobId: number; error: string };

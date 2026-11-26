import type { KlineData } from "@/lib/types/kline";
import type { JobOutput, RunJob } from "../runner";

export type WorkerRequest =
  | { type: "load"; datasetId: number; klines: KlineData[] }
  | { type: "run"; jobId: number; datasetId: number; job: RunJob };

export type WorkerResponse =
  | { type: "result"; jobId: number; result: JobOutput }
  | { type: "error"; jobId: number; error: string };

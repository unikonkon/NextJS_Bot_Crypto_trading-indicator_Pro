/// <reference lib="webworker" />
import { toBars } from "../math";
import { ComputeCache } from "../registry";
import { runJob } from "../runner";
import type { Bars, HtfInterval } from "../types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

let datasetId = -1;
let cache: ComputeCache | null = null;
let htf: { interval: HtfInterval | null; bars: Bars | null } = { interval: null, bars: null };

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "load") {
    datasetId = msg.datasetId;
    cache = new ComputeCache(toBars(msg.klines));
    cache.setHtf(htf.interval, htf.bars);
    return;
  }
  if (msg.type === "htf") {
    htf = { interval: msg.interval, bars: msg.klines ? toBars(msg.klines) : null };
    cache?.setHtf(htf.interval, htf.bars);
    return;
  }
  if (msg.type === "run") {
    try {
      if (!cache || msg.datasetId !== datasetId) throw new Error("Dataset not loaded in worker");
      post({ type: "result", jobId: msg.jobId, result: runJob(cache, msg.job) });
    } catch (err) {
      post({ type: "error", jobId: msg.jobId, error: err instanceof Error ? err.message : String(err) });
    }
  }
};

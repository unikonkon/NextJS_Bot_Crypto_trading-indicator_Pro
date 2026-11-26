import type { KlineData } from "@/lib/types/kline";
import { toBars } from "../math";
import { ComputeCache } from "../registry";
import { runJob, type JobOutput, type RunJob } from "../runner";
import type { BacktestResult, BacktestSummary, HtfInterval } from "../types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

interface Task {
  id: number;
  datasetId: number;
  htfId: number;
  job: RunJob;
  resolve: (r: JobOutput) => void;
  reject: (e: unknown) => void;
  aborted: boolean;
}

interface Slot {
  worker: Worker;
  task: Task | null;
  datasetId: number;
  htfId: number;
}

export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

/**
 * Pool of Web Workers that run backtests off the main thread.
 * The dataset is sent to each worker once (lazily) and cached there together
 * with indicator results, so re-running with new stop/fee settings is cheap.
 * Falls back to running on the main thread when workers are unavailable.
 */
export class BacktestPool {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private nextId = 1;
  private datasetId = 0;
  private klines: KlineData[] = [];
  private htfId = 0;
  private htf: { interval: HtfInterval | null; klines: KlineData[] | null } = { interval: null, klines: null };
  private inlineCache: ComputeCache | null = null;
  private inlineMode = false;
  private inlineBusy = false;
  readonly size: number;

  constructor(size?: number) {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    this.size = size ?? Math.max(1, Math.min(8, cores - 1));
    if (typeof Worker === "undefined") {
      this.inlineMode = true;
      return;
    }
    try {
      for (let i = 0; i < this.size; i++) this.slots.push(this.spawn());
    } catch {
      this.inlineMode = true;
    }
  }

  private spawn(): Slot {
    const worker = new Worker(new URL("./backtest.worker.ts", import.meta.url), { type: "module" });
    const slot: Slot = { worker, task: null, datasetId: -1, htfId: -1 };
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const task = slot.task;
      slot.task = null;
      if (task && task.id === e.data.jobId && !task.aborted) {
        if (task.htfId !== this.htfId) task.reject(new AbortedError());
        else if (e.data.type === "result") task.resolve(e.data.result);
        else task.reject(new Error(e.data.error));
      }
      this.pump();
    };
    worker.onerror = (e) => {
      // Worker failed to load or crashed → switch to main-thread mode
      e.preventDefault?.();
      const task = slot.task;
      slot.task = null;
      this.inlineMode = true;
      if (task && !task.aborted) this.queue.unshift(task);
      this.pump();
    };
    return slot;
  }

  /** Replace the dataset. Queued jobs for the previous dataset are cancelled. */
  setData(klines: KlineData[]): void {
    this.datasetId++;
    this.klines = klines;
    this.inlineCache = null;
    const stale = this.queue;
    this.queue = [];
    for (const t of stale) { t.aborted = true; t.reject(new AbortedError()); }
    for (const s of this.slots) if (s.task) { s.task.aborted = true; s.task.reject(new AbortedError()); }
  }

  /** Replace the higher-timeframe bars used by the trend filter. Queued jobs are cancelled. */
  setHtf(interval: HtfInterval | null, klines: KlineData[] | null): void {
    this.htfId++;
    this.htf = { interval, klines };
    this.inlineCache?.setHtf(interval, klines ? toBars(klines) : null);
    const stale = this.queue;
    this.queue = [];
    for (const t of stale) { t.aborted = true; t.reject(new AbortedError()); }
  }

  run(job: RunJob & { full: true }, signal?: AbortSignal): Promise<BacktestResult>;
  run(job: RunJob & { full: false }, signal?: AbortSignal): Promise<BacktestSummary>;
  run(job: RunJob, signal?: AbortSignal): Promise<JobOutput> {
    return new Promise<JobOutput>((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortedError());
      const task: Task = { id: this.nextId++, datasetId: this.datasetId, htfId: this.htfId, job, resolve, reject, aborted: false };
      signal?.addEventListener("abort", () => {
        if (task.aborted) return;
        task.aborted = true;
        this.queue = this.queue.filter((t) => t !== task);
        reject(new AbortedError());
      }, { once: true });
      this.queue.push(task);
      this.pump();
    });
  }

  /** Run many jobs in parallel, reporting progress. Failed jobs resolve to an Error. */
  async runMany<T extends RunJob>(
    jobs: T[],
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<(JobOutput | Error)[]> {
    let done = 0;
    return Promise.all(
      jobs.map((job) =>
        this.run(job as RunJob & { full: false }, signal)
          .then((r): JobOutput | Error => r)
          .catch((err): JobOutput | Error => {
            if (err instanceof AbortedError) throw err;
            return err instanceof Error ? err : new Error(String(err));
          })
          .finally(() => onProgress?.(++done, jobs.length)),
      ),
    );
  }

  private pump(): void {
    if (this.inlineMode) {
      this.pumpInline();
      return;
    }
    for (const slot of this.slots) {
      if (slot.task) continue;
      const task = this.queue.shift();
      if (!task) return;
      if (task.datasetId !== this.datasetId || task.htfId !== this.htfId) { task.reject(new AbortedError()); continue; }
      if (slot.htfId !== this.htfId) {
        slot.worker.postMessage({ type: "htf", htfId: this.htfId, ...this.htf } satisfies WorkerRequest);
        slot.htfId = this.htfId;
      }
      if (slot.datasetId !== this.datasetId) {
        slot.worker.postMessage({ type: "load", datasetId: this.datasetId, klines: this.klines } satisfies WorkerRequest);
        slot.datasetId = this.datasetId;
      }
      slot.task = task;
      slot.worker.postMessage({ type: "run", jobId: task.id, datasetId: this.datasetId, job: task.job } satisfies WorkerRequest);
    }
  }

  private pumpInline(): void {
    if (this.inlineBusy) return;
    const task = this.queue.shift();
    if (!task) return;
    this.inlineBusy = true;
    // Yield to the UI between jobs
    setTimeout(() => {
      try {
        if (task.datasetId === this.datasetId && !task.aborted) {
          if (!this.inlineCache) {
            this.inlineCache = new ComputeCache(toBars(this.klines));
            this.inlineCache.setHtf(this.htf.interval, this.htf.klines ? toBars(this.htf.klines) : null);
          }
          task.resolve(runJob(this.inlineCache, task.job));
        }
      } catch (err) {
        task.reject(err);
      } finally {
        this.inlineBusy = false;
        this.pump();
      }
    }, 0);
  }

  terminate(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    this.queue = [];
  }
}

let shared: BacktestPool | null = null;
export function getPool(): BacktestPool {
  if (!shared) shared = new BacktestPool();
  return shared;
}

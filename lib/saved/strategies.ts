/**
 * Strategies saved from /klines: the indicator, every setting that produced the result, the market and
 * data it was tested on, and the result itself. Kept in the local database (IndexedDB) and listed on /saved.
 *
 * One of them can be the "startup" strategy: /klines then opens with it instead of the last used setup.
 */
import type { Interval } from "@/lib/types/kline";
import { toSummary } from "@/lib/engine/backtest";
import type { BacktestConfig, BacktestResult, BacktestSummary, Bars, Params } from "@/lib/engine/types";
import { dbDelete, dbGet, dbGetAll, dbPut } from "./db";

/** Which bars the strategy was tested on (and is loaded with again) */
export type SavedData =
  | { kind: "latest"; limit: number }
  /** `toNow`: the range ended at "now" when it was loaded — reopened up to the present */
  | { kind: "range"; start: number; end: number; toNow: boolean }
  | { kind: "csv"; file: string };

export interface SavedResult extends BacktestSummary {
  /** Evaluated range (after warm-up) */
  from: number;
  to: number;
  bars: number;
  firstPrice: number;
  lastPrice: number;
}

export interface SavedStrategy {
  id: string;
  savedAt: number;
  /** Shown in the list — the indicator name unless renamed */
  name: string;
  note?: string;
  indicatorId: string;
  /** Name when it was saved (the registry name is used while the indicator still exists) */
  indicatorName: string;
  params: Params;
  config: BacktestConfig;
  symbol: string;
  interval: Interval;
  data: SavedData;
  /** Extra indicators drawn on the chart, with the params they had */
  overlays: { id: string; params: Params }[];
  result: SavedResult;
}

const DEFAULT_KEY = "klines.defaultSaved";
const OPEN_KEY = "klines.openSaved";
/** Tells the other open pages of this browser that the list changed */
const PING_KEY = "klines.savedChanged";

/** Same indicator + settings + market + data → saving again updates that entry instead of adding one */
export function setupKey(s: Pick<SavedStrategy, "indicatorId" | "params" | "config" | "symbol" | "interval" | "data">): string {
  const d = s.data;
  const data = d.kind === "latest" ? `latest:${d.limit}` : d.kind === "csv" ? `csv:${d.file}` : d.toNow ? `range:${d.start}:now` : `range:${d.start}:${d.end}`;
  return `${s.indicatorId}|${JSON.stringify(s.params)}|${JSON.stringify(s.config)}|${s.symbol}|${s.interval}|${data}`;
}

export function makeSaved(input: {
  indicatorId: string;
  indicatorName: string;
  params: Params;
  config: BacktestConfig;
  symbol: string;
  interval: Interval;
  data: SavedData;
  overlays: { id: string; params: Params }[];
  result: BacktestResult;
  bars: Bars;
}): SavedStrategy {
  const { result: r, bars } = input;
  const last = bars.length - 1;
  const start = Math.min(Math.max(0, r.startIndex), last);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
    name: input.indicatorName,
    indicatorId: input.indicatorId,
    indicatorName: input.indicatorName,
    params: { ...input.params },
    config: JSON.parse(JSON.stringify(input.config)) as BacktestConfig,
    symbol: input.symbol,
    interval: input.interval,
    data: { ...input.data },
    overlays: input.overlays.map((o) => ({ id: o.id, params: { ...o.params } })),
    result: {
      ...toSummary(r, 96),
      from: bars.time[start],
      to: bars.time[last],
      bars: bars.length - start,
      firstPrice: bars.open[start],
      lastPrice: bars.close[last],
    },
  };
}

function ping() {
  try {
    window.localStorage.setItem(PING_KEY, String(Date.now()));
  } catch {
    /* storage blocked — other tabs just refresh on their next visit */
  }
}

/** Calls `fn` when another tab saves / removes a strategy */
export function onSavedChange(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === PING_KEY || e.key === DEFAULT_KEY) fn(); };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function valid(s: unknown): s is SavedStrategy {
  const x = s as SavedStrategy | null;
  return !!x && typeof x.id === "string" && typeof x.indicatorId === "string" && !!x.result && !!x.data;
}

/** Newest first */
export async function listSaved(): Promise<SavedStrategy[]> {
  const all = await dbGetAll<SavedStrategy>("saved");
  return all.filter(valid).sort((a, b) => b.savedAt - a.savedAt);
}

export async function getSaved(id: string): Promise<SavedStrategy | null> {
  const s = await dbGet<SavedStrategy>("saved", id);
  return valid(s) ? s : null;
}

/** Save; an entry with the same setup keeps its id, name and note and gets the new result */
export async function putSaved(entry: SavedStrategy): Promise<SavedStrategy> {
  const key = setupKey(entry);
  const prev = (await listSaved()).find((s) => setupKey(s) === key);
  const next: SavedStrategy = prev ? { ...entry, id: prev.id, name: prev.name, note: prev.note } : entry;
  await dbPut("saved", next);
  ping();
  return next;
}

export async function updateSaved(id: string, patch: Partial<Pick<SavedStrategy, "name" | "note">>): Promise<void> {
  const cur = await getSaved(id);
  if (!cur) return;
  await dbPut("saved", { ...cur, ...patch });
  ping();
}

export async function removeSaved(id: string): Promise<void> {
  await dbDelete("saved", id);
  if (getDefaultId() === id) setDefaultId(null);
  ping();
}

// ─── Startup strategy ────────────────────────────────────────

/** The startup strategy is applied once per page load — not again on every in-app navigation back to /klines */
let startupApplied = false;

export function getDefaultId(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_KEY) || null;
  } catch {
    return null;
  }
}

export function setDefaultId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(DEFAULT_KEY, id);
    else window.localStorage.removeItem(DEFAULT_KEY);
  } catch {
    /* storage blocked */
  }
  // A newly chosen startup strategy is shown the next time /klines opens
  startupApplied = false;
}

/** "Open on the chart" from /saved: /klines applies this entry when it mounts */
export function requestOpen(id: string) {
  try {
    window.sessionStorage.setItem(OPEN_KEY, id);
  } catch {
    /* storage blocked */
  }
}

/**
 * What /klines should open with: an entry just picked on /saved, otherwise the startup strategy on the
 * first visit of this page load. Has no side effects — call `startupDone()` once it has been applied.
 */
export async function readStartup(): Promise<SavedStrategy | null> {
  let open: string | null = null;
  try {
    open = window.sessionStorage.getItem(OPEN_KEY);
  } catch {
    /* storage blocked */
  }
  const id = open ?? (startupApplied ? null : getDefaultId());
  return id ? getSaved(id) : null;
}

export function startupDone() {
  startupApplied = true;
  try {
    window.sessionStorage.removeItem(OPEN_KEY);
  } catch {
    /* storage blocked */
  }
}

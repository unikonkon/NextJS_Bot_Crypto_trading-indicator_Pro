"use client";

import { useMemo, useState } from "react";
import { Play, Stop, TrendUp, TrendDown, Warning, Cpu, Check, X, Plus, Funnel } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { listIndicators, categoriesInUse, sourcesInUse, sourceOf, getIndicator } from "@/lib/engine/registry";
import { HTF_CHOICES, htfBest } from "@/lib/engine/htf";
import {
  CATEGORY_LABELS, HTF_LABELS, SOURCE_LABELS,
  type BacktestSummary, type Category, type HtfInterval, type IndicatorDef, type Source, type TradeMode,
} from "@/lib/engine/types";
import { SourceBadge } from "./indicator-picker";
import { Sparkline } from "./equity-chart";
import { fmtPct, toneClass } from "../lib/format";

export type RankScope = "all" | "fav" | Category | Source;

const SOURCE_SET = new Set<string>(["v1", "v2", "v3", "v4", "v5", "v6"]);
export function inScope(d: IndicatorDef, scope: RankScope, favorites: string[]): boolean {
  if (scope === "all") return true;
  if (scope === "fav") return favorites.includes(d.id);
  if (SOURCE_SET.has(scope)) return sourceOf(d) === scope;
  return d.category === scope;
}

export interface RankFilter {
  indicator: string;
  interval: HtfInterval;
}

export interface RankRow {
  id: string;
  name: string;
  source: Source;
  category: Category;
  summary: BacktestSummary | null;
  error?: string;
  /** Higher-timeframe filter of this run (null = no filter) */
  filter: RankFilter | null;
}

/** Grid of higher-timeframe filters the ranking tries (persisted) */
export interface RankHtf {
  enabled: boolean;
  filters: string[];
  intervals: HtfInterval[];
}
export const DEFAULT_RANK_HTF: RankHtf = { enabled: false, filters: HTF_CHOICES.map((c) => c.id), intervals: ["1d", "3d", "1w"] };
const RECOMMENDED_TFS = new Set<HtfInterval>(HTF_CHOICES.map((c) => c.best));

type SortKey = "return" | "winRate" | "pf" | "dd" | "sharpe" | "trades";
type View = "filters" | "best" | "all";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "return", label: "กำไร" },
  { value: "winRate", label: "อัตราชนะ" },
  { value: "pf", label: "Profit Factor" },
  { value: "dd", label: "Drawdown ต่ำ" },
  { value: "sharpe", label: "Sharpe" },
  { value: "trades", label: "จำนวนเทรด" },
];

function sortValue(s: BacktestSummary, k: SortKey): number {
  switch (k) {
    case "return": return s.totalReturnPct;
    case "winRate": return s.winRate;
    case "pf": return s.profitFactor === Infinity ? 1e9 : s.profitFactor;
    case "dd": return -s.maxDrawdownPct;
    case "sharpe": return s.sharpeRatio;
    case "trades": return s.totalTrades;
  }
}

const MODE_LABEL: Record<TradeMode, string> = { long: "ขาขึ้นอย่างเดียว", short: "ขาลงอย่างเดียว", both: "ทั้งสองทาง" };
const filterKey = (f: RankFilter | null) => (f ? `${f.indicator}@${f.interval}` : "none");
const filterName = (f: RankFilter) => getIndicator(f.indicator)?.name ?? f.indicator;
const isRecommendedPair = (f: RankFilter) => htfBest(f.indicator) === f.interval;

interface Props {
  rows: RankRow[] | null;
  running: boolean;
  progress: { done: number; total: number } | null;
  stale: boolean;
  scope: RankScope;
  onScope: (s: RankScope) => void;
  favorites: string[];
  mode: TradeMode;
  workers: number;
  barCount: number;
  currentId: string;
  /** Filter currently applied to the single run */
  applied: RankFilter | null;
  /** The rows come from a filter grid */
  grid: boolean;
  rankHtf: RankHtf;
  onRankHtf: (v: RankHtf | ((p: RankHtf) => RankHtf)) => void;
  /** Timeframes larger than the chart's */
  tfChoices: HtfInterval[];
  chartTf: string;
  runs: number;
  strategies: number;
  /** Interval being downloaded before the ranking can start */
  htfLoading: HtfInterval | null;
  onPickFilters: () => void;
  onRun: () => void;
  onCancel: () => void;
  onApply: (row: RankRow) => void;
  onApplyFilter: (f: RankFilter | null) => void;
}

// ─── Filter grid settings ────────────────────────────────────
function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-background shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function SmallButton({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("h-7 shrink-0 border px-2 text-[10px] font-medium transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

function HtfGrid(p: Props) {
  const v = p.rankHtf;
  const set = (patch: Partial<RankHtf>) => p.onRankHtf((prev) => ({ ...prev, ...patch }));
  const allIds = listIndicators().map((d) => d.id);
  const recIds = HTF_CHOICES.map((c) => c.id);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const tfs = v.intervals.filter((i) => p.tfChoices.includes(i));
  const shown = v.filters.slice(0, 12);

  return (
    <section className={cn("space-y-3 border px-3 py-3", v.enabled && "border-primary/50 bg-muted/30")}>
      <label className="flex cursor-pointer items-start gap-3">
        <Switch on={v.enabled} onClick={() => set({ enabled: !v.enabled })} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold"><Funnel size={13} /> ตัวกรองเทรนด์ใหญ่ (Multi-timeframe)</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            หาคู่ที่ดีที่สุด: ทุกกลยุทธ์ × ทุกตัวกรอง × ทุก timeframe ที่เลือก เทียบกับไม่กรอง · ตัวกรองให้เปิดไม้ได้เฉพาะฝั่งเดียวกับทิศของมันบน TF ใหญ่
          </span>
        </span>
      </label>

      {v.enabled && (
        <>
          {/* 1) filter indicators */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium">ตัวกรอง <span className="text-muted-foreground">{v.filters.length} ตัว</span></span>
            <div className="flex flex-wrap gap-1">
              <SmallButton active={sameSet(v.filters, recIds)} onClick={() => set({ filters: recIds })}>แนะนำ {recIds.length}</SmallButton>
              <SmallButton active={sameSet(v.filters, allIds)} onClick={() => set({ filters: allIds })}>ทั้งหมด {allIds.length}</SmallButton>
              <SmallButton onClick={p.onPickFilters}><Plus size={10} className="mr-0.5 inline" />เลือกเอง…</SmallButton>
              {v.filters.length > 0 && <SmallButton onClick={() => set({ filters: [] })}>ล้าง</SmallButton>}
            </div>
            {v.filters.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {shown.map((id) => {
                  const best = htfBest(id);
                  return (
                    <span key={id} className="inline-flex h-6 items-center gap-1 border bg-background pl-1.5 text-[10px]">
                      {getIndicator(id)?.name ?? id}
                      {best && <span className="text-[9px] text-amber-500">★{HTF_LABELS[best]}</span>}
                      <button type="button" aria-label="เอาออก" onClick={() => set({ filters: v.filters.filter((x) => x !== id) })}
                        className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground"><X size={9} /></button>
                    </span>
                  );
                })}
                {v.filters.length > shown.length && (
                  <button type="button" onClick={p.onPickFilters} className="h-6 border border-dashed px-1.5 text-[10px] text-muted-foreground">+{v.filters.length - shown.length} ตัว</button>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-amber-500">ยังไม่ได้เลือกตัวกรอง</p>
            )}
          </div>

          {/* 2) timeframes */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium">Timeframe ที่ใช้คิด <span className="text-muted-foreground">{tfs.length} ค่า · ใหญ่กว่ากราฟ ({p.chartTf})</span></span>
              <span className="flex gap-1">
                <SmallButton onClick={() => set({ intervals: p.tfChoices })} active={tfs.length === p.tfChoices.length && tfs.length > 0}>ทั้งหมด</SmallButton>
                <SmallButton onClick={() => set({ intervals: p.tfChoices.filter((t) => RECOMMENDED_TFS.has(t)) })}>★ แนะนำ</SmallButton>
              </span>
            </div>
            {p.tfChoices.length === 0 ? (
              <p className="text-[10px] text-amber-500">ไม่มี timeframe ที่ใหญ่กว่ากราฟ — เปลี่ยนกราฟเป็น timeframe ที่เล็กลง</p>
            ) : (
              <div className="grid grid-cols-5 gap-1">
                {p.tfChoices.map((tf) => {
                  const on = v.intervals.includes(tf);
                  return (
                    <button key={tf} type="button" aria-pressed={on}
                      onClick={() => set({ intervals: on ? v.intervals.filter((x) => x !== tf) : [...v.intervals, tf] })}
                      className={cn("relative h-8 border text-[11px] font-medium tabular-nums transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {HTF_LABELS[tf]}
                      {RECOMMENDED_TFS.has(tf) && <span className={cn("absolute right-0.5 top-0 text-[8px]", on ? "text-primary-foreground" : "text-amber-500")}>★</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">★ = timeframe ที่ตัวกรองชุดแนะนำทำกำไรมากสุด (Trendlines 1W · CM MacD/CCI/OBV 3D · VWAP/EMA/CDC 1D)</p>
          </div>

          {/* 3) size of the run */}
          <p className={cn("border-l-2 px-2 py-1 text-[10px] tabular-nums", p.runs > 5000 ? "border-amber-500 text-amber-500" : "border-primary/50 text-muted-foreground")}>
            {p.strategies} กลยุทธ์ × ({v.filters.length} ตัวกรอง × {tfs.length} TF + ไม่กรอง) = <b>{p.runs.toLocaleString()}</b> รอบ
            {p.runs > 5000 && " · หลายพันรอบ อาจใช้เวลาหลายสิบวินาที"}
          </p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            ทิศของตัวกรอง = สัญญาณล่าสุด (หลังซื้อ = Long ได้ · หลังขาย = Short ได้) · ตัวที่ “ออกเอง” ใช้ฝั่งที่ถืออยู่ ·
            ใช้แท่ง TF ใหญ่ที่ปิดแล้วเท่านั้น · พารามิเตอร์ของตัวกรองตามที่ตั้งไว้ในแท็บกลยุทธ์
          </p>
        </>
      )}
    </section>
  );
}

// ─── Result rows ─────────────────────────────────────────────
function FilterBadge({ f }: { f: RankFilter | null }) {
  if (!f) return <span className="shrink-0 border px-1 text-[9px] text-muted-foreground">ไม่กรอง</span>;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 border border-primary/40 px-1 text-[9px] text-primary">
      <Funnel size={9} className="shrink-0" />
      <span className="truncate">{filterName(f)}</span>
      <b className="shrink-0">{HTF_LABELS[f.interval]}</b>
      {isRecommendedPair(f) && <span className="shrink-0 text-amber-500">★</span>}
    </span>
  );
}

function RowItem({ row, rank, base, active, onApply }: { row: RankRow; rank: number | null; base: number | undefined; active: boolean; onApply: () => void }) {
  const s = row.summary;
  const delta = s && row.filter && base !== undefined ? s.totalReturnPct - base : null;
  return (
    <li>
      <button type="button" onClick={onApply} title="ใช้เป็นกลยุทธ์ (พร้อมตัวกรองนี้) และแสดงบนกราฟ"
        className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50", active && "bg-muted/60")}>
        <span className={cn("w-6 shrink-0 self-start text-center text-[11px] tabular-nums", rank !== null && rank <= 3 ? "font-bold" : "text-muted-foreground")}>
          {active ? <Check size={12} className="mx-auto text-primary" /> : rank ?? "–"}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            <SourceBadge source={row.source} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.name}</span>
            <span className={cn("shrink-0 text-xs font-semibold tabular-nums", s ? toneClass(s.totalReturnPct) : "text-muted-foreground")}>
              {s ? fmtPct(s.totalReturnPct, 1) : "—"}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <FilterBadge f={row.filter} />
            {delta !== null && <span className={cn("shrink-0 text-[10px] tabular-nums", toneClass(delta))}>{fmtPct(delta, 1)} จากไม่กรอง</span>}
          </div>
          {s ? (
            <div className="flex items-center gap-2">
              <p className="flex min-w-0 flex-1 flex-wrap gap-x-2 text-[10px] tabular-nums text-muted-foreground">
                <span>ชนะ {s.winRate.toFixed(0)}%</span>
                <span>PF {s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}</span>
                <span>DD −{s.maxDrawdownPct.toFixed(0)}%</span>
                <span>{s.totalTrades} เทรด</span>
                {s.long.trades > 0 && <span className="inline-flex items-center gap-0.5"><TrendUp size={10} className="text-emerald-500" /><span className={toneClass(s.long.returnPct)}>{fmtPct(s.long.returnPct, 0)}</span></span>}
                {s.short.trades > 0 && <span className="inline-flex items-center gap-0.5"><TrendDown size={10} className="text-red-500" /><span className={toneClass(s.short.returnPct)}>{fmtPct(s.short.returnPct, 0)}</span></span>}
              </p>
              <Sparkline values={s.spark} width={64} height={20} />
            </div>
          ) : (
            <p className="truncate text-[10px] text-red-500">{row.error ?? "ข้อมูลไม่พอ"}</p>
          )}
        </div>
      </button>
    </li>
  );
}

interface FilterStat {
  filter: RankFilter | null;
  /** Share of evaluated bars where the filter had no direction (not enough higher-timeframe history) */
  unknown: number;
  n: number;
  improved: number;
  avgReturn: number;
  avgDelta: number;
  best: RankRow | null;
}

const PAGE = 100;

export function RankingPanel(p: Props) {
  const [sort, setSort] = useState<SortKey>("return");
  const [view, setView] = useState<View>("filters");
  const [limit, setLimit] = useState(PAGE);
  const all = listIndicators();
  const scopeCount = (s: RankScope) => all.filter((d) => inScope(d, s, p.favorites)).length;
  const scopes: RankScope[] = ["all", "fav", ...sourcesInUse(), ...categoriesInUse()];
  const scopeLabel = (s: RankScope) =>
    s === "all" ? "ทั้งหมด" : s === "fav" ? "★ โปรด" : SOURCE_SET.has(s) ? SOURCE_LABELS[s as Source].split(" · ")[0] : CATEGORY_LABELS[s as Category];
  const activeView: View = p.grid ? view : "all";

  // No-filter return of each strategy — the baseline every filter is compared with
  const base = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of p.rows ?? []) if (!r.filter && r.summary) m.set(r.id, r.summary.totalReturnPct);
    return m;
  }, [p.rows]);

  const list = useMemo(() => {
    if (!p.rows) return null;
    let rows = p.rows;
    if (activeView === "best") {
      // The best run of each strategy (its own no-filter run included); failures listed once
      const bestBy = new Map<string, RankRow>();
      for (const r of rows) {
        if (!r.summary) continue;
        const cur = bestBy.get(r.id);
        if (!cur || sortValue(r.summary, sort) > sortValue(cur.summary!, sort)) bestBy.set(r.id, r);
      }
      rows = [...bestBy.values(), ...rows.filter((r) => !r.filter && !r.summary)];
    }
    const ok = rows.filter((r) => r.summary).sort((a, b) => sortValue(b.summary!, sort) - sortValue(a.summary!, sort));
    return [...ok, ...rows.filter((r) => !r.summary)];
  }, [p.rows, sort, activeView]);

  const filterStats = useMemo<FilterStat[] | null>(() => {
    if (!p.rows || !p.grid) return null;
    const groups = new Map<string, FilterStat & { sumRet: number; sumDelta: number; sumUnknown: number }>();
    for (const r of p.rows) {
      if (!r.summary) continue;
      const b = base.get(r.id);
      if (b === undefined) continue;
      const k = filterKey(r.filter);
      let g = groups.get(k);
      if (!g) { g = { filter: r.filter, unknown: 0, n: 0, improved: 0, avgReturn: 0, avgDelta: 0, best: null, sumRet: 0, sumDelta: 0, sumUnknown: 0 }; groups.set(k, g); }
      const h = r.summary.htf;
      if (h) g.sumUnknown += h.unknownBars / Math.max(1, h.bullBars + h.bearBars + h.unknownBars);
      const ret = r.summary.totalReturnPct;
      g.n++;
      g.sumRet += ret;
      g.sumDelta += ret - b;
      if (r.filter && ret > b) g.improved++;
      if (!g.best || ret > g.best.summary!.totalReturnPct) g.best = r;
    }
    return [...groups.values()]
      .map((g) => ({ ...g, avgReturn: g.sumRet / g.n, avgDelta: g.sumDelta / g.n, unknown: g.sumUnknown / g.n }))
      .sort((a, b) => b.avgDelta - a.avgDelta || b.avgReturn - a.avgReturn);
  }, [p.rows, p.grid, base]);

  const insight = useMemo(() => {
    if (!list) return null;
    // the grid's "all pairs" view would count each strategy many times — use the unfiltered runs there
    const src = p.grid && activeView !== "best" ? (p.rows ?? []).filter((r) => !r.filter) : list;
    const ok = src.filter((r) => r.summary).map((r) => r.summary!);
    if (!ok.length) return null;
    return {
      label: p.grid && activeView !== "best" ? "ไม่กรอง" : activeView === "best" ? "คู่ที่ดีสุด" : "",
      profitable: ok.filter((s) => s.totalReturnPct > 0).length,
      beatHold: ok.filter((s) => s.totalReturnPct > s.buyAndHoldPct).length,
      total: ok.length,
      hold: ok[0].buyAndHoldPct,
    };
  }, [p.rows, list, activeView, p.grid]);

  const pct = p.progress ? Math.round((p.progress.done / Math.max(1, p.progress.total)) * 100) : 0;
  const gridReady = !p.rankHtf.enabled || (p.rankHtf.filters.length > 0 && p.rankHtf.intervals.some((i) => p.tfChoices.includes(i)));
  const isApplied = (r: RankRow) => r.id === p.currentId && filterKey(r.filter) === filterKey(p.applied);

  return (
    <div className="space-y-4 p-4">
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1 · กลยุทธ์ที่จะจัดอันดับ</h3>
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => {
            const n = scopeCount(s);
            return (
              <button key={s} type="button" disabled={n === 0} onClick={() => p.onScope(s)}
                className={cn("h-8 border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40",
                  p.scope === s ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {scopeLabel(s)} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Cpu size={12} /> ใช้ {p.workers} worker · ทุกตัวประเมินช่วงเดียวกัน · indicator สัญญาณใช้โหมด {MODE_LABEL[p.mode]} + SL/TP ตามแท็บกลยุทธ์ · กลยุทธ์ที่ “ออกเอง” ใช้กฎของตัวเอง
        </p>
      </section>

      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">2 · ตัวกรองเทรนด์ใหญ่ (ไม่บังคับ)</h3>
        <HtfGrid {...p} />
      </div>

      {p.running ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] tabular-nums">
            <span>
              {p.htfLoading ? `กำลังโหลดข้อมูล ${HTF_LABELS[p.htfLoading]}…`
                : p.progress ? `กำลังรัน ${p.progress.done.toLocaleString()}/${p.progress.total.toLocaleString()} รอบ`
                  : "กำลังเตรียมข้อมูล…"}
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-1.5 w-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
          <Button variant="destructive" size="lg" className="w-full" onClick={p.onCancel}><Stop size={14} weight="fill" /> ยกเลิก</Button>
        </div>
      ) : (
        <Button size="lg" className="h-11 w-full text-sm" onClick={() => { setLimit(PAGE); p.onRun(); }} disabled={p.strategies === 0 || p.barCount < 50 || !gridReady}>
          <Play size={14} weight="fill" /> {p.rankHtf.enabled ? `รัน ${p.runs.toLocaleString()} รอบ (หาคู่ที่ดีที่สุด)` : `รัน Backtest ${p.strategies} indicator`}
        </Button>
      )}
      {p.barCount > 0 && p.barCount < 50 && <p className="text-[11px] text-amber-500">ต้องมีอย่างน้อย 50 แท่งเทียน</p>}

      {p.stale && list && (
        <p className="flex gap-1.5 border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-500">
          <Warning size={13} className="shrink-0" /> ข้อมูลหรือการตั้งค่าเปลี่ยนไป — กดรันใหม่เพื่ออัปเดตอันดับ
        </p>
      )}

      {insight && (
        <div className="space-y-1">
          {insight.label && <p className="text-[10px] text-muted-foreground">สรุปของ: {insight.label}</p>}
          <div className="grid grid-cols-3 gap-px border bg-border text-center">
            <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">มีกำไร</p><p className="text-sm font-semibold tabular-nums">{insight.profitable}/{insight.total}</p></div>
            <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">ชนะซื้อถือ</p><p className="text-sm font-semibold tabular-nums">{insight.beatHold}/{insight.total}</p></div>
            <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">ซื้อถือ</p><p className={cn("text-sm font-semibold tabular-nums", toneClass(insight.hold))}>{fmtPct(insight.hold, 1)}</p></div>
          </div>
        </div>
      )}

      {list && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">อันดับ</h3>
            {activeView !== "filters" && (
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="เรียงตาม"
                className="h-8 border bg-background px-2 text-[11px] outline-none focus:border-ring">
                {SORTS.map((s) => <option key={s.value} value={s.value}>เรียงตาม: {s.label}</option>)}
              </select>
            )}
          </div>
          {p.grid && (
            <Segmented<View>
              size="sm"
              value={view}
              onChange={(v) => { setView(v); setLimit(PAGE); }}
              options={[
                { value: "filters", label: "สรุปตามตัวกรอง" },
                { value: "best", label: "ดีสุดต่อกลยุทธ์" },
                { value: "all", label: `ทุกคู่ ${(p.rows?.length ?? 0).toLocaleString()}` },
              ]}
            />
          )}

          {activeView === "filters" && filterStats ? (
            <>
              <ol className="divide-y border">
                {filterStats.map((g, i) => {
                  const active = filterKey(g.filter) === filterKey(p.applied);
                  return (
                    <li key={filterKey(g.filter)}>
                      <button type="button" onClick={() => p.onApplyFilter(g.filter)} title="ใช้ตัวกรองนี้กับกลยุทธ์ปัจจุบัน"
                        className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50", active && "bg-muted/60")}>
                        <span className={cn("w-6 shrink-0 self-start text-center text-[11px] tabular-nums", i < 3 ? "font-bold" : "text-muted-foreground")}>
                          {active ? <Check size={12} className="mx-auto text-primary" /> : i + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="flex min-w-0 flex-1"><FilterBadge f={g.filter} /></span>
                            <span className={cn("shrink-0 text-xs font-semibold tabular-nums", g.filter ? toneClass(g.avgDelta) : "text-muted-foreground")}>
                              {g.filter ? fmtPct(g.avgDelta, 1) : "เกณฑ์"}
                            </span>
                          </div>
                          <p className="flex flex-wrap gap-x-2 text-[10px] tabular-nums text-muted-foreground">
                            <span>กำไรเฉลี่ย <span className={toneClass(g.avgReturn)}>{fmtPct(g.avgReturn, 1)}</span></span>
                            {g.filter && <span>ดีขึ้น {g.improved}/{g.n} กลยุทธ์</span>}
                            {g.unknown > 0.2 && <span className="text-amber-500">ไม่มีทิศ {Math.round(g.unknown * 100)}% ของช่วง (ข้อมูล TF ใหญ่ไม่พอ)</span>}
                            {g.best && <span className="truncate">ดีสุด: {g.best.name} <span className={toneClass(g.best.summary!.totalReturnPct)}>{fmtPct(g.best.summary!.totalReturnPct, 1)}</span></span>}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="text-[10px] text-muted-foreground">
                ตัวเลขขวา = กำไรที่เปลี่ยนไปเทียบกับไม่กรอง เฉลี่ยทุกกลยุทธ์ · แตะแถวเพื่อใช้ตัวกรองนั้นกับกลยุทธ์ปัจจุบัน · คู่ที่ดีที่สุดรายตัวอยู่ที่ “ดีสุดต่อกลยุทธ์”
              </p>
            </>
          ) : (
            <>
              <ol className="divide-y border">
                {list.slice(0, limit).map((row, i) => (
                  <RowItem key={`${row.id}|${filterKey(row.filter)}`} row={row} rank={row.summary ? i + 1 : null}
                    base={base.get(row.id)} active={isApplied(row)} onApply={() => p.onApply(row)} />
                ))}
              </ol>
              {list.length > limit && (
                <Button variant="outline" size="lg" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                  แสดงเพิ่ม (เหลือ {(list.length - limit).toLocaleString()} แถว)
                </Button>
              )}
              <p className="text-[10px] text-muted-foreground">แตะแถวเพื่อใช้กลยุทธ์ + ตัวกรองนั้นบนกราฟ</p>
            </>
          )}
        </section>
      )}

      {!list && !p.running && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          รัน indicator หลายตัวพร้อมกันบน Web Worker (ไม่ทำให้หน้าเว็บค้าง) แล้วจัดอันดับตามผลตอบแทน
          {p.rankHtf.enabled && " · เปิดตัวกรองไว้: จะหาว่าตัวกรอง + timeframe ไหนช่วยกลยุทธ์ไหนได้มากที่สุด"}
        </p>
      )}
    </div>
  );
}

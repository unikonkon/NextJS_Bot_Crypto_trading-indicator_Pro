"use client";

import { useMemo, useState } from "react";
import { Play, Stop, TrendUp, TrendDown, Warning, Cpu } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listIndicators, categoriesInUse, sourcesInUse, sourceOf } from "@/lib/engine/registry";
import { CATEGORY_LABELS, SOURCE_LABELS, type BacktestSummary, type Category, type IndicatorDef, type Source, type TradeMode } from "@/lib/engine/types";
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

export interface RankRow {
  id: string;
  name: string;
  source: Source;
  category: Category;
  summary: BacktestSummary | null;
  error?: string;
}

type SortKey = "return" | "winRate" | "pf" | "dd" | "sharpe" | "trades";

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

interface Props {
  rows: RankRow[] | null;
  running: boolean;
  progress: { done: number; total: number } | null;
  stale: boolean;
  scope: RankScope;
  onScope: (s: RankScope) => void;
  favorites: string[];
  mode: TradeMode;
  /** Active higher-timeframe filter, e.g. "ตัวกรอง EMA 9/21 1D" */
  htfNote: string | null;
  workers: number;
  barCount: number;
  currentId: string;
  onRun: () => void;
  onCancel: () => void;
  onApply: (id: string) => void;
}

export function RankingPanel(p: Props) {
  const [sort, setSort] = useState<SortKey>("return");
  const all = listIndicators();
  const scopeCount = (s: RankScope) => all.filter((d) => inScope(d, s, p.favorites)).length;
  const scopes: RankScope[] = ["all", "fav", ...sourcesInUse(), ...categoriesInUse()];
  const scopeLabel = (s: RankScope) =>
    s === "all" ? "ทั้งหมด" : s === "fav" ? "★ โปรด" : SOURCE_SET.has(s) ? SOURCE_LABELS[s as Source].split(" · ")[0] : CATEGORY_LABELS[s as Category];

  const sorted = useMemo(() => {
    if (!p.rows) return null;
    const ok = p.rows.filter((r) => r.summary);
    const bad = p.rows.filter((r) => !r.summary);
    ok.sort((a, b) => sortValue(b.summary!, sort) - sortValue(a.summary!, sort));
    return [...ok, ...bad];
  }, [p.rows, sort]);

  const insight = useMemo(() => {
    if (!p.rows) return null;
    const ok = p.rows.filter((r) => r.summary).map((r) => r.summary!);
    if (!ok.length) return null;
    return {
      profitable: ok.filter((s) => s.totalReturnPct > 0).length,
      beatHold: ok.filter((s) => s.totalReturnPct > s.buyAndHoldPct).length,
      total: ok.length,
      hold: ok[0].buyAndHoldPct,
    };
  }, [p.rows]);

  const count = scopeCount(p.scope);
  const pct = p.progress ? Math.round((p.progress.done / Math.max(1, p.progress.total)) * 100) : 0;

  return (
    <div className="space-y-4 p-4">
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">เลือก indicator ที่จะรันพร้อมกัน</h3>
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => {
            const n = scopeCount(s);
            return (
              <button
                key={s}
                type="button"
                disabled={n === 0}
                onClick={() => p.onScope(s)}
                className={cn(
                  "h-8 border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40",
                  p.scope === s ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {scopeLabel(s)} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Cpu size={12} /> ใช้ {p.workers} worker · ทุกตัวประเมินช่วงเดียวกัน · indicator สัญญาณใช้โหมด {MODE_LABEL[p.mode]} + SL/TP ตามแท็บกลยุทธ์ · กลยุทธ์ที่ “ออกเอง” ใช้กฎของตัวเอง
          {p.htfNote && ` · ${p.htfNote}: ทุกตัวเปิดไม้ได้เฉพาะฝั่งเดียวกับเทรนด์ใหญ่`}
        </p>
      </section>

      {p.running ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] tabular-nums">
            <span>กำลังรัน {p.progress?.done ?? 0}/{p.progress?.total ?? count}</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-1.5 w-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
          <Button variant="destructive" size="lg" className="w-full" onClick={p.onCancel}><Stop size={14} weight="fill" /> ยกเลิก</Button>
        </div>
      ) : (
        <Button size="lg" className="h-11 w-full text-sm" onClick={p.onRun} disabled={count === 0 || p.barCount < 50}>
          <Play size={14} weight="fill" /> รัน Backtest {count} indicator
        </Button>
      )}
      {p.barCount > 0 && p.barCount < 50 && <p className="text-[11px] text-amber-500">ต้องมีอย่างน้อย 50 แท่งเทียน</p>}

      {p.stale && sorted && (
        <p className="flex gap-1.5 border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-500">
          <Warning size={13} className="shrink-0" /> ข้อมูลหรือการตั้งค่าเปลี่ยนไป — กดรันใหม่เพื่ออัปเดตอันดับ
        </p>
      )}

      {insight && (
        <div className="grid grid-cols-3 gap-px border bg-border text-center">
          <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">มีกำไร</p><p className="text-sm font-semibold tabular-nums">{insight.profitable}/{insight.total}</p></div>
          <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">ชนะซื้อถือ</p><p className="text-sm font-semibold tabular-nums">{insight.beatHold}/{insight.total}</p></div>
          <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">ซื้อถือ</p><p className={cn("text-sm font-semibold tabular-nums", toneClass(insight.hold))}>{fmtPct(insight.hold, 1)}</p></div>
        </div>
      )}

      {sorted && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">อันดับ</h3>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 border bg-background px-2 text-[11px] outline-none focus:border-ring"
              aria-label="เรียงตาม"
            >
              {SORTS.map((s) => <option key={s.value} value={s.value}>เรียงตาม: {s.label}</option>)}
            </select>
          </div>
          <ol className="divide-y border">
            {sorted.map((row, i) => {
              const s = row.summary;
              const active = row.id === p.currentId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => p.onApply(row.id)}
                    className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50", active && "bg-muted/60")}
                    title="ใช้เป็นกลยุทธ์และแสดงบนกราฟ"
                  >
                    <span className={cn("w-5 shrink-0 self-start text-center text-[11px] tabular-nums", i < 3 && s ? "font-bold" : "text-muted-foreground")}>{s ? i + 1 : "–"}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-baseline gap-2">
                        <SourceBadge source={row.source} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.name}</span>
                        <span className={cn("shrink-0 text-xs font-semibold tabular-nums", s ? toneClass(s.totalReturnPct) : "text-muted-foreground")}>
                          {s ? fmtPct(s.totalReturnPct, 1) : "—"}
                        </span>
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
            })}
          </ol>
          <p className="text-[10px] text-muted-foreground">แตะแถวเพื่อใช้เป็นกลยุทธ์และดูบนกราฟ</p>
        </section>
      )}

      {!sorted && !p.running && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          รัน indicator หลายตัวพร้อมกันบน Web Worker (ไม่ทำให้หน้าเว็บค้าง) แล้วจัดอันดับตามผลตอบแทน
        </p>
      )}
    </div>
  );
}

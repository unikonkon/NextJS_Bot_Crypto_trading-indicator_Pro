"use client";

import { useMemo, useState } from "react";
import { TrendUp, TrendDown, CaretLeft, CaretRight, CaretDown } from "@phosphor-icons/react";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { BacktestResult, Bars, IndicatorDef, SideStats, Trade, TradeMode } from "@/lib/engine/types";
import { EquityChart } from "./equity-chart";
import { KlineTable } from "./kline-table";
import { EXIT_REASON_LABEL, fmtDate, fmtPct, fmtPrice, toneClass } from "../lib/format";

interface Props {
  result: BacktestResult | null;
  def: IndicatorDef;
  mode: TradeMode;
  bars: Bars;
  running: boolean;
}

const MODE_LABEL: Record<TradeMode, string> = { long: "ขาขึ้น (Long)", short: "ขาลง (Short)", both: "ทั้งสองทาง" };

function Stat({ label, value, className, sub }: { label: string; value: string; className?: string; sub?: string }) {
  return (
    <div className="bg-background px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", className)}>{value}</p>
      {sub && <p className="text-[10px] tabular-nums text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SideCard({ side, s }: { side: "long" | "short"; s: SideStats }) {
  const long = side === "long";
  return (
    <div className={cn("border p-3", long ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5")}>
      <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold", long ? "text-emerald-500" : "text-red-500")}>
        {long ? <TrendUp size={14} weight="bold" /> : <TrendDown size={14} weight="bold" />}
        {long ? "ฝั่ง Long (ขาขึ้น)" : "ฝั่ง Short (ขาลง)"}
      </p>
      {s.trades === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">ไม่มีเทรด</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums">
          <span className="text-muted-foreground">ผลตอบแทน</span><span className={cn("text-right font-semibold", toneClass(s.returnPct))}>{fmtPct(s.returnPct)}</span>
          <span className="text-muted-foreground">เทรด</span><span className="text-right">{s.trades} <span className="text-muted-foreground">({s.wins}W/{s.losses}L)</span></span>
          <span className="text-muted-foreground">อัตราชนะ</span><span className={cn("text-right", s.winRate >= 50 ? "text-emerald-500" : "text-red-500")}>{s.winRate.toFixed(1)}%</span>
          <span className="text-muted-foreground">เฉลี่ย/เทรด</span><span className={cn("text-right", toneClass(s.avgPnlPct))}>{fmtPct(s.avgPnlPct)}</span>
        </div>
      )}
    </div>
  );
}

const PAGE = 20;

function TradeList({ trades }: { trades: Trade[] }) {
  const hasNotes = trades.some((t) => t.entryNote || t.exitNote);
  const [filter, setFilter] = useState<"all" | "long" | "short">("all");
  const [page, setPage] = useState(0);
  const list = useMemo(() => {
    const f = filter === "all" ? trades : trades.filter((t) => t.side === filter);
    return [...f].reverse(); // newest first
  }, [trades, filter]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = list.slice(cur * PAGE, cur * PAGE + PAGE);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          size="sm"
          className="w-56"
          value={filter}
          onChange={(v) => { setFilter(v); setPage(0); }}
          options={[
            { value: "all", label: `ทั้งหมด ${trades.length}` },
            { value: "long", label: "Long", activeClass: "bg-emerald-500 text-white" },
            { value: "short", label: "Short", activeClass: "bg-red-500 text-white" },
          ]}
        />
        {pages > 1 && (
          <div className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
            <button type="button" className="grid size-8 place-items-center border disabled:opacity-40" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="ก่อนหน้า"><CaretLeft size={12} /></button>
            <span className="w-14 text-center">{cur + 1}/{pages}</span>
            <button type="button" className="grid size-8 place-items-center border disabled:opacity-40" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="ถัดไป"><CaretRight size={12} /></button>
          </div>
        )}
      </div>

      {/* Mobile: cards */}
      <ul className="divide-y border md:hidden">
        {rows.map((t, i) => (
          <li key={`${t.entryIdx}-${i}`} className="flex items-center gap-3 px-3 py-2">
            <span className={cn("grid size-7 shrink-0 place-items-center text-white", t.side === "long" ? "bg-emerald-500" : "bg-red-500")}>
              {t.side === "long" ? <TrendUp size={14} weight="bold" /> : <TrendDown size={14} weight="bold" />}
            </span>
            <div className="min-w-0 flex-1 text-[10px] tabular-nums text-muted-foreground">
              <p className="truncate">{fmtDate(t.entryTime)} → {fmtDate(t.exitTime)}</p>
              <p className="truncate">{fmtPrice(t.entryPrice)} → {fmtPrice(t.exitPrice)} · {t.bars} แท่ง · {EXIT_REASON_LABEL[t.exitReason]}</p>
              {t.exitNote && <p className="truncate text-foreground/70" title={`${t.entryNote ?? ""}\n${t.exitNote}`}>{t.exitNote}</p>}
            </div>
            <span className={cn("shrink-0 text-xs font-semibold tabular-nums", toneClass(t.pnlPct))}>{fmtPct(t.pnlPct)}</span>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto border md:block">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="border-b bg-muted/40 text-[10px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">ฝั่ง</th>
              <th className="px-2 py-1.5 text-left font-medium">เข้า</th>
              <th className="px-2 py-1.5 text-right font-medium">ราคาเข้า</th>
              <th className="px-2 py-1.5 text-left font-medium">ออก</th>
              <th className="px-2 py-1.5 text-right font-medium">ราคาออก</th>
              <th className="px-2 py-1.5 text-right font-medium">แท่ง</th>
              <th className="px-2 py-1.5 text-left font-medium">เหตุผลออก</th>
              {hasNotes && <th className="px-2 py-1.5 text-left font-medium">เหตุผลจากกลยุทธ์ (เข้า → ออก)</th>}
              <th className="px-2 py-1.5 text-right font-medium">กำไร/ขาดทุน</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((t, i) => (
              <tr key={`${t.entryIdx}-${i}`} className="hover:bg-muted/30">
                <td className="px-2 py-1.5">
                  <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-white", t.side === "long" ? "bg-emerald-500" : "bg-red-500")}>
                    {t.side === "long" ? "LONG" : "SHORT"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{fmtDate(t.entryTime, true)}</td>
                <td className="px-2 py-1.5 text-right">{fmtPrice(t.entryPrice)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{fmtDate(t.exitTime, true)}</td>
                <td className="px-2 py-1.5 text-right">{fmtPrice(t.exitPrice)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{t.bars}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{EXIT_REASON_LABEL[t.exitReason]}</td>
                {hasNotes && (
                  <td className="max-w-[320px] px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                    {t.entryNote && <p className="truncate" title={t.entryNote}>▸ {t.entryNote}</p>}
                    {t.exitNote && <p className="truncate" title={t.exitNote}>◂ {t.exitNote}</p>}
                  </td>
                )}
                <td className={cn("px-2 py-1.5 text-right font-semibold", toneClass(t.pnlPct))}>{fmtPct(t.pnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">ไม่มีเทรด</p>}
    </div>
  );
}

export function ResultsPanel({ result, def, mode, bars, running }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  const start = result?.startIndex ?? 0;
  const benchmark = useMemo(() => {
    const c0 = bars.close[start];
    return bars.close.slice(start).map((c) => ((c - c0) / c0) * 100);
  }, [bars, start]);
  const curve = useMemo(() => result?.equityCurve.slice(start) ?? [], [result, start]);

  if (!result) {
    return (
      <div className="border bg-card p-8 text-center text-xs text-muted-foreground">
        {running ? "กำลังทดสอบย้อนหลัง…" : "ยังไม่มีผลทดสอบ — เลือก indicator ในแท็บกลยุทธ์"}
      </div>
    );
  }

  const r = result;
  const beat = r.totalReturnPct - r.buyAndHoldPct;
  const lastReason = r.reasons?.[r.reasons.length - 1] ?? null;
  const evalCount = bars.length - r.startIndex;
  const exitCounts = r.trades.reduce<Record<string, number>>((m, t) => { m[t.exitReason] = (m[t.exitReason] ?? 0) + 1; return m; }, {});

  return (
    <div className={cn("space-y-4", running && "opacity-60 transition-opacity")}>
      {/* Hero */}
      <div className="border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground">{def.name} · {MODE_LABEL[r.engine === "exposure" ? r.direction : mode]}</p>
            <p className={cn("text-3xl font-bold tabular-nums", toneClass(r.totalReturnPct))}>{fmtPct(r.totalReturnPct)}</p>
            <p className="text-[11px] text-muted-foreground">
              ซื้อแล้วถือ <span className={toneClass(r.buyAndHoldPct)}>{fmtPct(r.buyAndHoldPct)}</span>
              {" · "}
              <span className={toneClass(beat)}>{beat >= 0 ? "ชนะ" : "แพ้"} {fmtPct(Math.abs(beat), 2, false)}</span>
            </p>
          </div>
          <div className="text-right text-[11px]">
            {r.openSide ? (
              <p className={cn("inline-flex items-center gap-1 px-2 py-1 font-semibold text-white", r.openSide === "long" ? "bg-emerald-500" : "bg-red-500")}>
                {r.openSide === "long" ? <TrendUp size={13} weight="bold" /> : <TrendDown size={13} weight="bold" />}
                ถือ {r.openSide === "long" ? "Long" : "Short"} อยู่
              </p>
            ) : (
              <p className="inline-block border px-2 py-1 text-muted-foreground">ไม่มีสถานะ</p>
            )}
            {r.lastSignal && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                สัญญาณล่าสุด <span className={r.lastSignal.dir === 1 ? "text-emerald-500" : "text-red-500"}>{r.lastSignal.dir === 1 ? "▲ ขาขึ้น" : "▼ ขาลง"}</span>{" "}
                {r.lastSignal.barsAgo === 0 ? "แท่งล่าสุด" : `${r.lastSignal.barsAgo} แท่งก่อน`}
              </p>
            )}
          </div>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          ประเมิน {evalCount.toLocaleString()} แท่ง ตั้งแต่ {fmtDate(bars.time[r.startIndex], true)}
          {r.startIndex > 0 && ` (อุ่นเครื่องก่อนหน้า ${r.startIndex.toLocaleString()} แท่ง)`}
          {" · "}เข้า-ออกที่{r.fill === "nextOpen" ? "ราคาเปิดแท่งถัดไป" : "ราคาปิดแท่งสัญญาณ"}
          {r.engine === "exposure" && " · กลยุทธ์จัดการการออกเอง"}
        </p>
        {lastReason && (
          <p className="mt-1.5 border-l-2 border-primary/50 bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
            <span className="text-[10px] text-muted-foreground">สถานะล่าสุดจากกลยุทธ์: </span>{lastReason}
          </p>
        )}
        <div className="mt-3">
          <EquityChart curve={curve} benchmark={benchmark} />
          <p className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
            <span><span className="mr-1 inline-block h-0.5 w-3 bg-emerald-500 align-middle" />กลยุทธ์ (ทบต้น, รวมกำไรที่ยังไม่ปิด)</span>
            <span><span className="mr-1 inline-block w-3 border-t border-dashed border-current align-middle" />ซื้อแล้วถือ</span>
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-4">
        <Stat label="อัตราชนะ" value={`${r.winRate.toFixed(1)}%`} className={r.winRate >= 50 ? "text-emerald-500" : "text-red-500"} sub={`${r.wins}W / ${r.losses}L`} />
        <Stat label="Profit Factor" value={r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)} className={r.profitFactor > 1 ? "text-emerald-500" : "text-red-500"} />
        <Stat label="Max Drawdown" value={`−${r.maxDrawdownPct.toFixed(2)}%`} className="text-red-500" />
        <Stat label="จำนวนเทรด" value={String(r.totalTrades)} sub={`ถือเฉลี่ย ${r.avgBarsHeld.toFixed(1)} แท่ง`} />
        <Stat label="กำไรเฉลี่ย" value={fmtPct(r.avgWinPct)} className="text-emerald-500" />
        <Stat label="ขาดทุนเฉลี่ย" value={fmtPct(r.avgLossPct)} className="text-red-500" />
        <Stat label="เทรดดีสุด / แย่สุด" value={fmtPct(r.bestTradePct, 1)} className="text-emerald-500" sub={fmtPct(r.worstTradePct, 1)} />
        <Stat label="Sharpe (ต่อเทรด)" value={r.sharpeRatio.toFixed(3)} className={toneClass(r.sharpeRatio)} sub={`อยู่ในตลาด ${r.exposurePct.toFixed(0)}%`} />
      </div>

      {/* Long vs Short */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SideCard side="long" s={r.long} />
        <SideCard side="short" s={r.short} />
      </div>

      {Object.keys(exitCounts).length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="text-muted-foreground">ปิดสถานะด้วย:</span>
          {Object.entries(exitCounts).map(([k, v]) => (
            <span key={k} className="border px-1.5 py-0.5 tabular-nums">{EXIT_REASON_LABEL[k]} {v}</span>
          ))}
        </div>
      )}

      {/* Trades */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold">ประวัติการเทรด</h3>
        <TradeList key={r.trades.length + mode} trades={r.trades} />
      </div>

      {/* Raw data */}
      <div className="border">
        <button type="button" onClick={() => setShowRaw((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium hover:bg-muted/50">
          ข้อมูลแท่งเทียนดิบ ({bars.length.toLocaleString()} แท่ง)
          <CaretDown size={14} className={cn("transition-transform", showRaw && "rotate-180")} />
        </button>
        {showRaw && <KlineTable bars={bars} signals={r.signals} reasons={r.reasons} />}
      </div>
    </div>
  );
}

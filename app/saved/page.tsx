"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookmarkSimple, CaretDown, ChartLineUp, Database, HardDrives, House, PencilSimple, ShieldCheck, Trash, Warning, X } from "@phosphor-icons/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { engineOf, getIndicator, normalizeParams, sourceOf } from "@/lib/engine/registry";
import { HTF_LABELS, type IndicatorDef, type Params, type StopRule, type TradeMode } from "@/lib/engine/types";
import {
  getDefaultId, listSaved, onSavedChange, removeSaved, requestOpen, setDefaultId, updateSaved,
  type SavedData, type SavedStrategy,
} from "@/lib/saved/strategies";
import {
  BYTES_PER_BAR, KEEP_BARS_KEY, clearStoredBars, deleteStoredBars, listStoredBars, requestPersist, storageInfo,
  type StorageInfo, type StoredBarsMeta,
} from "@/app/klines/lib/kline-store";
import { useLocalState } from "@/app/klines/lib/use-local-state";
import { fmtBytes, fmtDate, fmtDays, fmtNum, fmtPct, fmtPrice, toneClass } from "@/app/klines/lib/format";
import { SourceBadge } from "@/app/klines/ui/indicator-picker";

type Sort = "new" | "return";
type Tab = "strategies" | "data";

const DIRECTION: Record<TradeMode, string> = { long: "Long อย่างเดียว", short: "Short อย่างเดียว", both: "Long + Short" };

function dataLabel(d: SavedData): string {
  if (d.kind === "latest") return `${d.limit.toLocaleString()} แท่งล่าสุด`;
  if (d.kind === "csv") return `ไฟล์ ${d.file.replace(/\.csv$/, "")}`;
  return d.toNow ? `ย้อนหลัง ${fmtDays(d.end - d.start)} ถึงปัจจุบัน` : `${fmtDate(d.start, true)} → ${fmtDate(d.end, true)}`;
}

const stopLabel = (r: StopRule) => (r.kind === "none" ? "ปิด" : r.kind === "pct" ? `${r.value}%` : `${r.value} × ATR(14)`);

/** The saved params as the strategy tab shows them (hidden ones left out) */
function paramRows(def: IndicatorDef, saved: Params) {
  const p = normalizeParams(def, saved);
  return def.params
    .filter((pd) => !pd.visibleWhen || (p[pd.visibleWhen.key] ?? 0) === pd.visibleWhen.value)
    .map((pd) => {
      const v = p[pd.key];
      return {
        key: pd.key,
        label: pd.label,
        value: pd.toggle ? (v >= 0.5 ? "เปิด" : "ปิด") : pd.options ? pd.options[Math.round(v)] ?? String(v) : String(v),
        changed: v !== pd.default,
      };
    });
}

/** Equity curve of the saved test, stretched to the card width */
function Curve({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-12" />;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const y = (v: number) => (((max - v) / range) * 30 + 1).toFixed(2);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${y(v)}`).join(" ");
  const up = values[values.length - 1] >= 0;
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn("block h-12 w-full", up ? "text-up" : "text-down")} aria-hidden>
      <line x1="0" x2="100" y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,${y(0)} ${pts} 100,${y(0)}`} fill="currentColor" fillOpacity="0.08" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-xs font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function Row({ label, value, changed }: { label: string; value: string; changed?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className={cn("shrink-0 text-right tabular-nums", changed && "font-semibold text-foreground")}>{value}</dd>
    </div>
  );
}

function SavedCard({ item, isDefault, onOpen, onDefault, onRemove, onRename }: {
  item: SavedStrategy;
  isDefault: boolean;
  onOpen: () => void;
  onDefault: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const def = getIndicator(item.indicatorId);
  const r = item.result;
  const cfg = item.config;
  const exposure = def ? engineOf(def, normalizeParams(def, item.params)).kind === "exposure" : r.engine === "exposure";
  const filter = r.htf ? `กรอง ${getIndicator(r.htf.indicator)?.name ?? r.htf.indicator} ${HTF_LABELS[r.htf.interval]}` : null;
  const indicatorName = def?.name ?? item.indicatorName;
  const beatHold = r.totalReturnPct > r.buyAndHoldPct;

  const commitName = () => {
    const name = (draft ?? "").trim();
    if (name && name !== item.name) onRename(name);
    setDraft(null);
  };

  return (
    <article className={cn("flex min-w-0 flex-col border bg-card", isDefault && "border-primary")}>
      <div className="flex items-start gap-3 px-3 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {def && <SourceBadge source={sourceOf(def)} />}
            {draft !== null ? (
              <input
                autoFocus
                value={draft}
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setDraft(null); }}
                aria-label="ชื่อรายการ"
                className="h-7 min-w-0 flex-1 border bg-background px-1.5 text-sm font-semibold outline-none focus:border-ring"
              />
            ) : (
              <>
                <h3 className="truncate text-sm font-semibold">{item.name}</h3>
                <button type="button" onClick={() => setDraft(item.name)} aria-label={`เปลี่ยนชื่อ ${item.name}`} title="เปลี่ยนชื่อ"
                  className="grid size-6 shrink-0 place-items-center text-muted-foreground hover:text-foreground">
                  <PencilSimple size={12} />
                </button>
              </>
            )}
            {isDefault && <span className="shrink-0 bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">หน้าแรก</span>}
          </div>
          {item.name !== indicatorName && <p className="truncate text-[10px] text-muted-foreground">{indicatorName}</p>}
          <p className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
            <span className="border px-1.5 py-0.5 font-semibold">{item.symbol}</span>
            <span className="border px-1.5 py-0.5 tabular-nums">{item.interval}</span>
            <span className="border px-1.5 py-0.5 tabular-nums text-muted-foreground">{dataLabel(item.data)}</span>
            <span className="border px-1.5 py-0.5 text-muted-foreground">{DIRECTION[r.direction]}</span>
            {filter && <span className="border border-primary/40 px-1.5 py-0.5 text-primary">{filter}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-xl font-bold leading-tight tabular-nums", toneClass(r.totalReturnPct))}>{fmtPct(r.totalReturnPct, 1)}</p>
          <p className="text-[10px] tabular-nums text-muted-foreground">
            ซื้อถือ <span className={toneClass(r.buyAndHoldPct)}>{fmtPct(r.buyAndHoldPct, 1)}</span>
          </p>
          {beatHold && <p className="text-[10px] font-medium text-up">ชนะซื้อถือ</p>}
        </div>
      </div>

      {!def && (
        <p className="mx-3 mt-2 flex gap-1.5 border border-warn/30 bg-warn/5 px-2 py-1.5 text-[10px] text-warn">
          <Warning size={13} className="shrink-0" /> indicator นี้ไม่มีในระบบแล้ว — ดูผลที่บันทึกได้ แต่เปิดบนกราฟไม่ได้
        </p>
      )}

      <div className="mt-2 px-3"><Curve values={r.spark} /></div>

      <div className="mx-3 mt-2 grid grid-cols-4 gap-px border bg-border">
        <Stat label="เทรด" value={r.totalTrades.toLocaleString()} />
        <Stat label="ชนะ" value={`${r.winRate.toFixed(0)}%`} />
        <Stat label="Max DD" value={`−${r.maxDrawdownPct.toFixed(1)}%`} tone="text-down" />
        <Stat label="PF" value={fmtNum(r.profitFactor)} />
      </div>

      <p className="mt-2 px-3 text-[10px] leading-relaxed tabular-nums text-muted-foreground">
        ทดสอบ {fmtDate(r.from, true)} → {fmtDate(r.to, true)} · {r.bars.toLocaleString()} แท่ง · ราคา {fmtPrice(r.firstPrice)} → {fmtPrice(r.lastPrice)}
        <br />บันทึกเมื่อ {fmtDate(item.savedAt, true)}
      </p>

      <details className="group mx-3 mt-2 border text-[11px]">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <CaretDown size={11} className="transition-transform group-open:rotate-180" /> ค่าที่ตั้งไว้และสถิติทั้งหมด
        </summary>
        <div className="grid gap-x-6 gap-y-3 border-t px-2 py-2 sm:grid-cols-2">
          <dl>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">พารามิเตอร์</p>
            {def && paramRows(def, item.params).map((p) => <Row key={p.key} label={p.label} value={p.value} changed={p.changed} />)}
            {def && def.params.length === 0 && <p className="text-[10px] text-muted-foreground">ไม่มีพารามิเตอร์</p>}
            {!def && Object.entries(item.params).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
            {item.overlays.length > 0 && (
              <Row label="Indicator เพิ่มบนกราฟ" value={item.overlays.map((o) => getIndicator(o.id)?.name ?? o.id).join(", ")} />
            )}
          </dl>
          <dl>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">การเทรด</p>
            {exposure ? (
              <p className="py-0.5 text-[10px] text-muted-foreground">กลยุทธ์นี้กำหนดจุดเข้า-ออกและ stop เอง</p>
            ) : (
              <>
                <Row label="Stop Loss" value={stopLabel(cfg.stopLoss)} changed={cfg.stopLoss.kind !== "none"} />
                <Row label="Take Profit" value={stopLabel(cfg.takeProfit)} changed={cfg.takeProfit.kind !== "none"} />
                <Row label="Trailing Stop" value={stopLabel(cfg.trailing)} changed={cfg.trailing.kind !== "none"} />
                <Row label="ปิดเมื่อสัญญาณกลับทาง" value={cfg.exitOnOpposite ? "ใช่" : "ไม่"} />
              </>
            )}
            <Row label="ราคาเข้า-ออก" value={r.fill === "close" ? "ปิดแท่งสัญญาณ" : "เปิดแท่งถัดไป"} />
            <Row label="ค่าธรรมเนียม / Slippage" value={`${cfg.feesPct}% / ${cfg.slippagePct}%`} />
            <Row label="อุ่นเครื่อง" value={`${r.warmupBars.toLocaleString()} แท่ง`} />
          </dl>
          <dl className="sm:col-span-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">สถิติ</p>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Row label="Long" value={`${fmtPct(r.long.returnPct, 1)} · ${r.long.trades} เทรด · ชนะ ${r.long.winRate.toFixed(0)}%`} />
              <Row label="Short" value={`${fmtPct(r.short.returnPct, 1)} · ${r.short.trades} เทรด · ชนะ ${r.short.winRate.toFixed(0)}%`} />
              <Row label="กำไรเฉลี่ย / ขาดทุนเฉลี่ย" value={`${fmtPct(r.avgWinPct, 2)} / ${fmtPct(r.avgLossPct, 2)}`} />
              <Row label="ดีสุด / แย่สุด" value={`${fmtPct(r.bestTradePct, 1)} / ${fmtPct(r.worstTradePct, 1)}`} />
              <Row label="Profit factor (PF) / Sharpe" value={`${fmtNum(r.profitFactor)} / ${fmtNum(r.sharpeRatio)}`} />
              <Row label="ถือสถานะ" value={`${r.exposurePct.toFixed(0)}% ของเวลา · เฉลี่ย ${r.avgBarsHeld.toFixed(0)} แท่ง/เทรด`} />
              {r.htf && <Row label="ไม้ที่ตัวกรองกันไว้" value={r.htf.blocked.toLocaleString()} />}
            </div>
          </dl>
        </div>
      </details>

      <div className="mt-3 flex items-center gap-1.5 border-t px-3 py-2">
        {confirm ? (
          <>
            <p className="min-w-0 flex-1 text-[11px]">ลบรายการนี้?</p>
            <Button variant="destructive" size="lg" onClick={onRemove}><Trash size={14} /> ลบ</Button>
            <Button variant="outline" size="lg" onClick={() => setConfirm(false)}>ยกเลิก</Button>
          </>
        ) : (
          <>
            <Button size="lg" className="min-w-0 flex-1" onClick={onOpen} disabled={!def}>
              <ChartLineUp size={14} /> เปิดบนกราฟ
            </Button>
            <Button variant="outline" size="lg" onClick={onDefault} disabled={!def && !isDefault} aria-pressed={isDefault}
              className={cn(isDefault && "border-primary text-primary dark:border-primary")}
              title={isDefault ? "ยกเลิกการแสดงเป็นอันแรกเมื่อเปิดหน้ากราฟ" : "แสดงกลยุทธ์นี้เป็นอันแรกเมื่อเปิดหน้ากราฟ"}>
              <House size={14} weight={isDefault ? "fill" : "regular"} /> {isDefault ? "เป็นหน้าแรกอยู่" : "ตั้งเป็นหน้าแรก"}
            </Button>
            <Button variant="outline" size="icon-lg" onClick={() => setConfirm(true)} aria-label={`ลบ ${item.name}`} title="ลบ">
              <Trash size={14} />
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

/** Delete button that asks once more: the first press arms it, the second one deletes */
function ConfirmDelete({ onConfirm, label, children, className, icon }: {
  onConfirm: () => void;
  /** aria-label / tooltip of the unarmed button */
  label: string;
  children?: React.ReactNode;
  className?: string;
  icon?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed) {
    return (
      <Button variant="destructive" size="sm" className={className} onClick={() => { setArmed(false); onConfirm(); }} onBlur={() => setArmed(false)} autoFocus>
        <Trash size={12} /> ยืนยันลบ
      </Button>
    );
  }
  return (
    <Button variant="outline" size={icon ? "icon-sm" : "sm"} className={className} onClick={() => setArmed(true)} aria-label={label} title={label}>
      <Trash size={12} />{children}
    </Button>
  );
}

/** Stored candlestick bars: space used / left, and every coin with its timeframes */
function StoredData({ list, space, keepOn, onKeep, onDelete, onClear, onPersist, persistDenied }: {
  list: StoredBarsMeta[];
  space: StorageInfo | null;
  keepOn: boolean;
  onKeep: (v: boolean) => void;
  onDelete: (symbol: string, interval?: string) => void;
  onClear: () => void;
  onPersist: () => void;
  /** The browser was asked for durable storage and declined */
  persistDenied: boolean;
}) {
  const coins = useMemo(() => {
    const by = new Map<string, StoredBarsMeta[]>();
    for (const m of list) by.set(m.symbol, [...(by.get(m.symbol) ?? []), m]);
    // Most recently updated coin first
    return [...by].map(([symbol, sets]) => ({ symbol, sets, bars: sets.reduce((n, m) => n + m.bars, 0), at: Math.max(...sets.map((m) => m.savedAt)) }))
      .sort((a, b) => b.at - a.at);
  }, [list]);
  const totalBars = list.reduce((n, m) => n + m.bars, 0);
  const left = space ? Math.max(0, space.quota - space.usage) : null;
  const usedPct = space ? Math.min(100, (space.usage / space.quota) * 100) : 0;

  return (
    <div className="space-y-4">
      <section className="border bg-card" aria-labelledby="space-title">
        <h2 id="space-title" className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-semibold">
          <HardDrives size={14} /> พื้นที่เก็บข้อมูลในเครื่อง
        </h2>
        <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="flex items-start gap-3 p-3">
            <Switch checked={keepOn} onChange={onKeep} aria-label="เก็บข้อมูลแท่งเทียนไว้ในเครื่อง" className="mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium">เก็บข้อมูลแท่งเทียนไว้ในเครื่อง</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                ข้อมูลที่โหลดในหน้ากราฟจะถูกเก็บลงฐานข้อมูลของเบราว์เซอร์ (IndexedDB) แยกตามเหรียญและช่วงเวลา
                เปิดครั้งถัดไปจึงดึงเฉพาะแท่งใหม่มาต่อ · เก็บได้หลายเหรียญจนกว่าพื้นที่จะเต็ม และไม่ถูกลบเองเมื่อดูเหรียญอื่น
              </p>
              {!keepOn && <p className="mt-1 text-[10px] text-warn">ปิดอยู่ — ข้อมูลที่เก็บไว้จะไม่ถูกใช้และไม่อัปเดต หน้ากราฟจะโหลดใหม่ทั้งหมดทุกครั้ง</p>}
            </div>
          </div>

          <div className="space-y-2 p-3">
            {space && left !== null ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[11px] font-medium">พื้นที่ที่เหลือ</p>
                  <p className="text-sm font-bold tabular-nums">{fmtBytes(left)}</p>
                </div>
                <div className="h-1.5 w-full bg-muted" role="progressbar" aria-label="พื้นที่ที่ใช้ไป" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
                  <div className={cn("h-full", usedPct > 85 ? "bg-down" : usedPct > 60 ? "bg-warn" : "bg-primary")} style={{ width: `${Math.max(usedPct, space.usage > 0 ? 1 : 0)}%` }} />
                </div>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  ใช้ไป {fmtBytes(space.usage)} จากที่เบราว์เซอร์ให้เว็บนี้ {fmtBytes(space.quota)} ({usedPct < 0.1 ? "< 0.1" : usedPct.toFixed(1)}%)
                  {totalBars > 0 && ` · เป็นข้อมูลแท่งเทียน ≈ ${fmtBytes(Math.min(space.usage, totalBars * BYTES_PER_BAR))}`}
                </p>
                {space.persisted ? (
                  <p className="flex items-center gap-1 text-[10px] text-up"><ShieldCheck size={12} weight="fill" /> เก็บแบบถาวร — เบราว์เซอร์จะไม่ลบข้อมูลนี้เอง</p>
                ) : persistDenied ? (
                  <p className="text-[10px] leading-snug text-warn">
                    เบราว์เซอร์ยังไม่อนุญาตให้เก็บแบบถาวร — ข้อมูลยังอยู่ตามปกติ แต่อาจถูกลบเมื่อพื้นที่เครื่องเหลือน้อยมาก
                    (Chrome จะอนุญาตเองเมื่อบุ๊กมาร์กหรือติดตั้งเว็บนี้เป็นแอป หรือใช้งานเป็นประจำ)
                  </p>
                ) : (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-snug text-muted-foreground">
                    <span className="min-w-0 flex-1">เบราว์เซอร์อาจลบข้อมูลเองได้เมื่อพื้นที่เครื่องเหลือน้อยมาก</span>
                    <Button variant="outline" size="xs" onClick={onPersist}><ShieldCheck size={12} /> ขอเก็บแบบถาวร</Button>
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">เบราว์เซอร์นี้ไม่บอกขนาดพื้นที่ที่เหลือ{totalBars > 0 && ` · ข้อมูลแท่งเทียนที่เก็บ ≈ ${fmtBytes(totalBars * BYTES_PER_BAR)}`}</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="coins-title">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="coins-title" className="text-xs font-semibold">
            เหรียญที่เก็บไว้
            {coins.length > 0 && (
              <span className="ml-1 font-normal tabular-nums text-muted-foreground">
                ({coins.length} เหรียญ · {list.length} ช่วงเวลา · {totalBars.toLocaleString()} แท่ง)
              </span>
            )}
          </h2>
          {coins.length > 1 && <ConfirmDelete onConfirm={onClear} label="ลบข้อมูลแท่งเทียนทั้งหมด" className="ml-auto">ลบทั้งหมด</ConfirmDelete>}
        </div>

        {coins.length === 0 ? (
          <div className="grid place-items-center gap-2 border border-dashed px-4 py-10 text-center">
            <Database size={26} className="text-muted-foreground" />
            <p className="text-sm font-semibold">ยังไม่มีข้อมูลแท่งเทียนที่เก็บไว้</p>
            <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              {keepOn ? "เมื่อโหลดข้อมูลเหรียญใดในหน้ากราฟ เหรียญและช่วงเวลานั้นจะมาอยู่ที่นี่โดยอัตโนมัติ" : "เปิดสวิตช์ด้านบนก่อน แล้วโหลดข้อมูลในหน้ากราฟ"}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {coins.map((c) => (
              <li key={c.symbol} className="min-w-0 border bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.symbol}</p>
                    <p className="text-[10px] tabular-nums text-muted-foreground">
                      {c.sets.length} ช่วงเวลา · {c.bars.toLocaleString()} แท่ง · ≈ {fmtBytes(c.bars * BYTES_PER_BAR)}
                    </p>
                  </div>
                  <ConfirmDelete onConfirm={() => onDelete(c.symbol)} label={`ลบ ${c.symbol} ทุกช่วงเวลา`}>ลบเหรียญ</ConfirmDelete>
                </div>
                <ul className="divide-y">
                  {c.sets.map((m) => (
                    <li key={m.interval} className="flex items-center gap-2.5 px-3 py-1.5">
                      <span className="w-9 shrink-0 bg-muted py-0.5 text-center text-[11px] font-semibold tabular-nums">{m.interval}</span>
                      <div className="min-w-0 flex-1 text-[10px] tabular-nums">
                        <p>
                          <span className="font-medium">{m.bars.toLocaleString()} แท่ง</span>
                          <span className="text-muted-foreground"> · ≈ {fmtBytes(m.bars * BYTES_PER_BAR)} · {fmtDays(m.to - m.from)}</span>
                        </p>
                        <p className="text-muted-foreground">{fmtDate(m.from, true)} → {fmtDate(m.to, true)} · อัปเดต {fmtDate(m.savedAt)}</p>
                      </div>
                      <ConfirmDelete icon onConfirm={() => onDelete(m.symbol, m.interval)} label={`ลบ ${m.symbol} ${m.interval}`} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Everything this page shows, read from the local database in one go */
interface LocalData {
  items: SavedStrategy[];
  stored: StoredBarsMeta[];
  space: StorageInfo | null;
  defaultId: string | null;
}

const NO_BARS: StoredBarsMeta[] = [];

async function readLocal(): Promise<LocalData> {
  const [items, stored, space] = await Promise.all([listSaved(), listStoredBars(), storageInfo()]);
  return { items, stored, space, defaultId: getDefaultId() };
}

export default function SavedPage() {
  const router = useRouter();
  const [db, setDb] = useState<LocalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keepOn, setKeepOn] = useLocalState(KEEP_BARS_KEY, true);
  const [sort, setSort] = useLocalState<Sort>("saved.sort", "new");
  const [coin, setCoin] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("strategies");
  const [persistDenied, setPersistDenied] = useState(false);

  const reload = useCallback(() => readLocal()
    .then((d) => setDb(d))
    .catch((err) => {
      setDb((prev) => prev ?? { items: [], stored: [], space: null, defaultId: null });
      setError(err instanceof Error ? err.message : String(err));
    }), []);

  useEffect(() => {
    const load = () => { void reload(); };
    // /saved?tab=data — the "manage" link of the data sheet on /klines
    void reload().then(() => { if (new URLSearchParams(window.location.search).get("tab") === "data") setTab("data"); });
    // Bars are stored from /klines (possibly in another tab) → refresh when coming back to this one
    window.addEventListener("focus", load);
    const off = onSavedChange(load);
    return () => { window.removeEventListener("focus", load); off(); };
  }, [reload]);

  const list = db?.items ?? null;
  const stored = db?.stored ?? NO_BARS;
  const defaultId = db?.defaultId ?? null;
  const storedCoins = useMemo(() => new Set(stored.map((m) => m.symbol)).size, [stored]);

  const coins = useMemo(() => Array.from(new Set((list ?? []).map((s) => s.symbol))).sort(), [list]);
  const coinNow = coin && coins.includes(coin) ? coin : null;
  const shown = useMemo(() => {
    const items = (list ?? []).filter((s) => !coinNow || s.symbol === coinNow);
    return sort === "return" ? [...items].sort((a, b) => b.result.totalReturnPct - a.result.totalReturnPct) : items;
  }, [list, coinNow, sort]);
  const startup = list?.find((s) => s.id === defaultId) ?? null;

  /** The tab is part of the address so a refresh (or a shared link) opens the same one */
  const pickTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "data" ? "/saved?tab=data" : "/saved");
  };
  const open = (item: SavedStrategy) => {
    requestOpen(item.id);
    router.push("/klines");
  };
  const makeDefault = (id: string | null) => {
    setDefaultId(id);
    setDb((prev) => (prev ? { ...prev, defaultId: id } : prev));
  };
  const act = (work: Promise<unknown>) => work.then(reload).catch((err) => setError(err instanceof Error ? err.message : String(err)));

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-5xl items-center gap-x-3 px-3 py-2 lg:px-4">
          <Link href="/klines" className="flex h-9 items-center gap-1 border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft size={13} /> กราฟ
          </Link>
          <h1 className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
            <BookmarkSimple size={15} weight="fill" className="shrink-0 text-primary" /> ที่บันทึกไว้
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Link href="/trading/Binance" className="hidden h-9 items-center whitespace-nowrap border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex">
              Binance Trading
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-3 py-4 lg:px-4">
        {error && (
          <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <Warning size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="ปิด"><X size={14} /></button>
          </div>
        )}

        <Segmented<Tab>
          value={tab}
          onChange={pickTab}
          aria-label="ส่วนของหน้า"
          options={[
            { value: "strategies", label: <><BookmarkSimple size={14} /> กลยุทธ์{list ? ` (${list.length})` : ""}</> },
            { value: "data", label: <><Database size={14} /> ข้อมูลแท่งเทียน{db ? ` (${storedCoins})` : ""}</> },
          ]}
        />

        {tab === "data" && (
          <StoredData
            list={stored}
            space={db?.space ?? null}
            keepOn={keepOn}
            onKeep={setKeepOn}
            onDelete={(symbol, interval) => void act(deleteStoredBars(symbol, interval))}
            onClear={() => void act(clearStoredBars())}
            onPersist={() => void act(requestPersist().then((ok) => setPersistDenied(!ok)))}
            persistDenied={persistDenied}
          />
        )}

        {tab === "strategies" && (
          <>
            {/* ═══ What /klines opens with ═══ */}
            <section className="border bg-card" aria-labelledby="startup-title">
              <h2 id="startup-title" className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-semibold">
                <House size={14} /> กลยุทธ์ที่แสดงเมื่อเปิดหน้ากราฟ
              </h2>
              <div className="space-y-2 p-3">
                {startup ? (
                  <>
                    <div className="flex items-center gap-3 border border-primary/50 bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{startup.name}</p>
                        <p className="truncate text-[10px] tabular-nums text-muted-foreground">
                          {startup.symbol} · {startup.interval} · {dataLabel(startup.data)}
                        </p>
                      </div>
                      <span className={cn("shrink-0 text-sm font-bold tabular-nums", toneClass(startup.result.totalReturnPct))}>{fmtPct(startup.result.totalReturnPct, 1)}</span>
                      <Button variant="outline" size="sm" onClick={() => makeDefault(null)}>ยกเลิก</Button>
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      เปิดเว็บหรือรีเฟรชหน้ากราฟครั้งถัดไป จะแสดง indicator นี้พร้อมค่าที่ตั้งไว้ เหรียญ ช่วงเวลา และข้อมูลแท่งเทียนชุดนี้ทันที
                    </p>
                  </>
                ) : (
                  <div className="border border-dashed px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
                    ยังไม่ได้เลือก — หน้ากราฟจะเปิดด้วยค่าที่ใช้ครั้งล่าสุด
                    <span className="mt-0.5 block text-[10px]">กด <b className="font-medium text-foreground">ตั้งเป็นหน้าแรก</b> ที่รายการด้านล่างเพื่อเลือก</span>
                  </div>
                )}
              </div>
            </section>

            {/* ═══ Saved strategies ═══ */}
            <section className="space-y-3" aria-labelledby="list-title">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 id="list-title" className="text-xs font-semibold">
                  กลยุทธ์ที่บันทึกไว้{list && list.length > 0 && <span className="ml-1 font-normal tabular-nums text-muted-foreground">({list.length})</span>}
                </h2>
                {list && list.length > 1 && (
                  <Segmented<Sort>
                    size="sm"
                    className="ml-auto"
                    value={sort}
                    onChange={setSort}
                    aria-label="เรียงตาม"
                    options={[{ value: "new", label: "ล่าสุด" }, { value: "return", label: "กำไรสูงสุด" }]}
                  />
                )}
              </div>

              {coins.length > 1 && (
                <div className="-mx-3 flex gap-1 overflow-x-auto px-3 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
                  {[null, ...coins].map((c) => (
                    <button key={c ?? "all"} type="button" onClick={() => setCoin(c)} aria-pressed={coinNow === c}
                      className={cn("h-8 shrink-0 border px-2.5 text-[11px] font-medium", coinNow === c ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                      {c ? c.replace(/USDT$/, "") : "ทุกเหรียญ"}
                    </button>
                  ))}
                </div>
              )}

              {list === null ? (
                <p className="py-10 text-center text-xs text-muted-foreground">กำลังโหลด…</p>
              ) : list.length === 0 ? (
                <div className="grid place-items-center gap-3 border border-dashed px-4 py-12 text-center">
                  <BookmarkSimple size={28} className="text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">ยังไม่มีกลยุทธ์ที่บันทึก</p>
                    <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                      ในหน้ากราฟ เลือก indicator และตั้งค่าจนได้ผลทดสอบที่ต้องการ แล้วกดปุ่ม <b className="font-medium text-foreground">บันทึก</b> — ค่าที่ตั้งและผลทดสอบจะมาอยู่ที่นี่
                    </p>
                  </div>
                  <Link href="/klines" className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                    <ChartLineUp size={14} /> ไปหน้ากราฟ
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {shown.map((item) => (
                    <SavedCard
                      key={item.id}
                      item={item}
                      isDefault={item.id === defaultId}
                      onOpen={() => open(item)}
                      onDefault={() => makeDefault(item.id === defaultId ? null : item.id)}
                      onRemove={() => void act(removeSaved(item.id))}
                      onRename={(name) => void act(updateSaved(item.id, { name }))}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          ข้อมูลทั้งหมดในหน้านี้เก็บอยู่ในฐานข้อมูลของเบราว์เซอร์เครื่องนี้ (IndexedDB) — ไม่ถูกส่งออกไปที่ใด และจะหายถ้าล้างข้อมูลเว็บไซต์ของเบราว์เซอร์
        </p>
      </main>
    </div>
  );
}

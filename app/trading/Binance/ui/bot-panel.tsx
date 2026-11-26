"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, ChartLineUp, CircleNotch, Clock, Flask, Funnel, Lightning, MagnifyingGlass, Play, Robot, Stop, Trash,
  TrendDown, TrendUp, Warning, X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { getIndicator, normalizeParams } from "@/lib/engine/registry";
import { normalizeHtf } from "@/lib/engine/htf";
import { HTF_LABELS, type StopRule } from "@/lib/engine/types";
import type { BotPreset } from "@/lib/trading/presets";
import { presetBlocker, presetDirection } from "@/lib/trading/live";
import { fmtPct, fmtPrice, toneClass } from "@/app/klines/lib/format";
import { CLOSE_REASON_LABEL, type Bot, type BotLog } from "../lib/use-bot";
import { Empty, Field, Notice, Section, Stat, fmtCountdown, fmtQty, fmtTime, fmtUsd, selectClass } from "./parts";

const POLL_OPTIONS = [5, 10, 15, 30, 60, 120, 300];
const MODE_TEXT = { long: "Long อย่างเดียว", short: "Short อย่างเดียว", both: "Long + Short" } as const;

function stopText(r: StopRule): string {
  if (r.kind === "none" || !(r.value > 0)) return "ไม่ใช้";
  return r.kind === "pct" ? `${r.value}%` : `${r.value}× ATR`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// ─── Step 1: strategy presets from /klines ────────────────────
function PresetCard({ p, selected, disabled, onPick, onRemove }: {
  p: BotPreset; selected: boolean; disabled: boolean; onPick: () => void; onRemove: () => void;
}) {
  const def = getIndicator(p.indicatorId);
  const b = p.backtest;
  const dir = presetDirection(p);
  const htf = normalizeHtf(p.config.htf);
  return (
    <li className={cn("border transition-colors", selected ? "border-primary bg-muted/50" : "hover:bg-muted/30")}>
      <button type="button" onClick={onPick} disabled={disabled} className="w-full px-3 py-2.5 text-left disabled:cursor-not-allowed">
        <div className="flex items-start gap-2">
          <span className={cn("mt-1 size-3 shrink-0 border", selected ? "border-primary bg-primary" : "border-muted-foreground/40")} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{def?.name ?? p.indicatorName}</p>
            <p className="text-[10px] text-muted-foreground">
              <b className="text-foreground">{p.symbol}</b> · {p.interval} · {MODE_TEXT[dir]}
              {htf.enabled && <> · <Funnel size={10} className="inline" /> {getIndicator(htf.indicator)?.name ?? htf.indicator} {HTF_LABELS[htf.interval]}</>}
            </p>
          </div>
          {b && (
            <div className="shrink-0 text-right">
              <p className={cn("text-sm font-bold tabular-nums", toneClass(b.totalReturnPct))}>{fmtPct(b.totalReturnPct)}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">{b.totalTrades} เทรด · ชนะ {b.winRate.toFixed(0)}%</p>
            </div>
          )}
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-dashed px-3 py-1 text-[10px] text-muted-foreground">
        <span>ส่งมาเมื่อ {new Date(p.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
          {b && <> · DD −{b.maxDrawdownPct.toFixed(1)}% · ถือเฉยๆ {fmtPct(b.buyAndHoldPct)}</>}</span>
        <button type="button" onClick={onRemove} disabled={disabled} aria-label="ลบกลยุทธ์นี้" className="p-1 hover:text-red-500 disabled:opacity-40">
          <Trash size={12} />
        </button>
      </div>
    </li>
  );
}

function PresetDetail({ p }: { p: BotPreset }) {
  const def = getIndicator(p.indicatorId);
  if (!def) return null;
  const params = normalizeParams(def, p.params);
  const htf = normalizeHtf(p.config.htf);
  return (
    <details className="group border text-[11px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium hover:bg-muted/40">
        <MagnifyingGlass size={12} /> ค่าที่บอทจะใช้ (เหมือนที่ทดสอบ)
        <span className="ml-auto text-[10px] text-muted-foreground group-open:hidden">แสดง</span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2.5">
        {(def.longRule || def.description) && (
          <p className="leading-relaxed text-muted-foreground">
            {def.longRule && <><b className="text-emerald-500">ซื้อ:</b> {def.longRule}<br /></>}
            {def.shortRule && <><b className="text-red-500">ขาย:</b> {def.shortRule}<br /></>}
            {!def.longRule && def.description}
          </p>
        )}
        {def.params.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
            {def.params.filter((pd) => !pd.visibleWhen || params[pd.visibleWhen.key] === pd.visibleWhen.value).map((pd) => (
              <div key={pd.key} className="flex justify-between gap-2">
                <span className="truncate text-muted-foreground">{pd.label}</span>
                <span className="font-medium">{pd.options ? pd.options[params[pd.key]] ?? params[pd.key] : pd.toggle ? (params[pd.key] ? "เปิด" : "ปิด") : params[pd.key]}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t pt-2">
          <span className="text-muted-foreground">Stop Loss</span><span className="text-right">{stopText(p.config.stopLoss)}</span>
          <span className="text-muted-foreground">Take Profit</span><span className="text-right">{stopText(p.config.takeProfit)}</span>
          <span className="text-muted-foreground">Trailing Stop</span><span className="text-right">{stopText(p.config.trailing)}</span>
          <span className="text-muted-foreground">ตัวกรองเทรนด์</span>
          <span className="text-right">{htf.enabled ? `${getIndicator(htf.indicator)?.name ?? htf.indicator} ${HTF_LABELS[htf.interval]}` : "ไม่ใช้"}</span>
        </div>
      </div>
    </details>
  );
}

// ─── Status ───────────────────────────────────────────────────
function StatusHero({ bot, now }: { bot: Bot; now: number }) {
  const { running, phase, position: pos, unrealized, price, busy, error, nextBarAt, lastCheck, settings } = bot;
  const tone = !running ? "idle" : pos ? (pos.side === "long" ? "long" : "short") : "wait";
  const title = !running
    ? pos ? "หยุดอยู่ · ยังถือสถานะ" : "บอทหยุดอยู่"
    : phase === "starting" ? "กำลังเริ่ม…"
    : pos ? `กำลังถือ ${pos.side === "long" ? "Long" : "Short"}` : "กำลังรอสัญญาณเข้า";
  const sub = !running
    ? pos ? "บอทไม่ได้ดูแลสถานะนี้อยู่ — กดเริ่มเพื่อให้ดูแลต่อ หรือปิดสถานะเอง" : "เลือกกลยุทธ์และตั้งค่า แล้วกดเริ่ม"
    : pos ? "จะปิดเมื่อกลยุทธ์ให้สัญญาณออก หรือชน Stop/TP" : "ตรวจทุกครั้งที่แท่งเทียนปิด และเข้าเมื่อกลยุทธ์ให้สัญญาณใหม่";

  return (
    <section className={cn("border",
      tone === "long" ? "border-emerald-500/50" : tone === "short" ? "border-red-500/50" : tone === "wait" ? "border-sky-500/50" : "")}>
      <div className={cn("flex items-center gap-3 px-4 py-3",
        tone === "long" ? "bg-emerald-500/10" : tone === "short" ? "bg-red-500/10" : tone === "wait" ? "bg-sky-500/10" : "bg-muted/40")}>
        <span className="relative flex size-3 shrink-0">
          {running && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60",
            tone === "long" ? "bg-emerald-500" : tone === "short" ? "bg-red-500" : "bg-sky-500")} />}
          <span className={cn("relative inline-flex size-3 rounded-full",
            !running ? "bg-muted-foreground/40" : tone === "long" ? "bg-emerald-500" : tone === "short" ? "bg-red-500" : "bg-sky-500")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <span className={cn("shrink-0 px-2 py-1 text-[10px] font-bold",
          settings.test ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "bg-red-500 text-white")}>
          {settings.test ? "ทดสอบ" : "เงินจริง"}
        </span>
      </div>

      {pos && (
        <div className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4">
          <Stat label="จำนวน" value={`${fmtQty(pos.qty)}`} sub={pos.symbol} />
          <Stat label="ราคาเข้า" value={fmtPrice(pos.entryPrice)} sub={fmtTime(pos.entryTime)} />
          <Stat label="ราคาตอนนี้" value={price !== null ? fmtPrice(price) : "—"} />
          <Stat label="กำไร/ขาดทุน (ยังไม่ปิด)"
            value={unrealized ? `${unrealized.usdt >= 0 ? "+" : ""}${fmtUsd(unrealized.usdt)} USDT` : "—"}
            sub={unrealized ? fmtPct(unrealized.pct) : undefined}
            valueClass={unrealized ? toneClass(unrealized.usdt) : undefined} />
        </div>
      )}
      {pos?.stops && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] tabular-nums">
          {pos.stops.sl !== null && <span>Stop Loss <b className="text-red-500">{fmtPrice(pos.stops.sl)}</b></span>}
          {pos.stops.tp !== null && <span>Take Profit <b className="text-emerald-500">{fmtPrice(pos.stops.tp)}</b></span>}
          {unrealized?.trail != null && <span>Trailing <b className="text-amber-500">{fmtPrice(unrealized.trail)}</b></span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[10px] text-muted-foreground">
        {busy ? (
          <span className="flex items-center gap-1 font-medium text-foreground"><CircleNotch size={12} className="animate-spin" /> {busy}</span>
        ) : running && nextBarAt ? (
          <span className="flex items-center gap-1"><Clock size={12} /> แท่งถัดไปปิดใน <b className="tabular-nums text-foreground">{fmtCountdown(nextBarAt - now)}</b></span>
        ) : null}
        {lastCheck && <span>ตรวจล่าสุด {fmtTime(lastCheck, false)}</span>}
        {error && <span className="flex items-center gap-1 text-red-500"><Warning size={12} /> {error}</span>}
      </div>

      {pos && (
        <div className="flex flex-wrap gap-2 border-t px-4 py-2.5">
          <Button variant="outline" size="sm" onClick={() => void bot.closeNow()} disabled={!!busy}>
            <X size={12} weight="bold" /> ปิดสถานะตอนนี้
          </Button>
          {!running && (
            <Button variant="ghost" size="sm" onClick={bot.forgetPosition} disabled={!!busy}
              title="ใช้เมื่อปิดสถานะเองที่ Binance แล้ว — บอทจะลืมสถานะนี้โดยไม่ส่งคำสั่ง">
              ล้างสถานะ (ไม่ส่งคำสั่ง)
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function StrategyNow({ bot }: { bot: Bot }) {
  const ev = bot.evalInfo;
  if (!ev) {
    return (
      <Section title="กลยุทธ์ตอนนี้บอกอะไร" desc="ผลจากแท่งเทียนที่ปิดแล้วล่าสุด — แสดงเมื่อบอทเริ่ม หรือกด “ดูสัญญาณตอนนี้”">
        <Empty icon={<ChartLineUp size={22} />} title="ยังไม่ได้คำนวณ" />
      </Section>
    );
  }
  const target = bot.settings.market === "spot" && ev.target === "short" ? null : ev.target;
  return (
    <Section title="กลยุทธ์ตอนนี้บอกอะไร" desc={`แท่งที่ปิดล่าสุด ${fmtTime(ev.lastClosedTime)} · ราคาปิด ${fmtPrice(ev.lastClose)}`}>
      <div className="space-y-3">
        <div className={cn("flex items-center gap-3 border px-3 py-2.5",
          target === "long" ? "border-emerald-500/40 bg-emerald-500/5" : target === "short" ? "border-red-500/40 bg-red-500/5" : "")}>
          {target === "long" ? <TrendUp size={22} weight="bold" className="text-emerald-500" />
            : target === "short" ? <TrendDown size={22} weight="bold" className="text-red-500" />
            : <Clock size={22} className="text-muted-foreground" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {target === "long" ? "กลยุทธ์อยู่ฝั่ง Long (ถือขึ้น)" : target === "short" ? "กลยุทธ์อยู่ฝั่ง Short (ถือลง)" : "กลยุทธ์ไม่ถือสถานะ"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {ev.heldSince ? `เข้าตั้งแต่ ${fmtTime(ev.heldSince.time)} ที่ ${fmtPrice(ev.heldSince.price)}` : "รอสัญญาณเข้า"}
              {ev.target === "short" && bot.settings.market === "spot" && " · (Spot เปิด Short ไม่ได้ → ถือเงินสด)"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-border text-[11px]">
          <Stat label="สัญญาณล่าสุด"
            value={ev.lastSignal ? (ev.lastSignal.dir === 1 ? "ซื้อ / ขาขึ้น" : "ขาย / ขาลง") : "—"}
            valueClass={ev.lastSignal ? (ev.lastSignal.dir === 1 ? "text-emerald-500" : "text-red-500") : undefined}
            sub={ev.lastSignal ? (ev.lastSignal.barsAgo === 0 ? "แท่งล่าสุด" : `${ev.lastSignal.barsAgo} แท่งก่อน`) : undefined} />
          <Stat label={ev.htfLabel ? `ตัวกรอง ${ev.htfLabel}` : "ตัวกรองเทรนด์"}
            value={ev.htfState === null ? "ไม่ใช้" : ev.htfState === 1 ? "อนุญาตเฉพาะ Long" : ev.htfState === -1 ? "อนุญาตเฉพาะ Short" : "ยังไม่ทราบทิศ"}
            valueClass={ev.htfState === 1 ? "text-emerald-500" : ev.htfState === -1 ? "text-red-500" : undefined} />
          <Stat label="Backtest ช่วงล่าสุด"
            value={fmtPct(ev.windowReturnPct)} valueClass={toneClass(ev.windowReturnPct)} sub={`${ev.windowTrades} เทรด (แท่งล่าสุด ≤ 500)`} />
          <Stat label="ข้อมูลที่ใช้" value={`${ev.bars.toLocaleString()} แท่ง`} sub={`อุ่นเครื่อง ${ev.warmup.toLocaleString()} แท่ง`} />
        </div>
        {ev.reason && <p className="border-l-2 border-primary/50 pl-2 text-[11px] leading-relaxed text-muted-foreground">{ev.reason}</p>}
      </div>
    </Section>
  );
}

const LOG_STYLE: Record<BotLog["kind"], string> = {
  info: "text-muted-foreground",
  signal: "text-sky-600 dark:text-sky-400",
  open: "text-emerald-600 dark:text-emerald-400",
  close: "text-amber-600 dark:text-amber-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};
const LOG_TAG: Record<BotLog["kind"], string> = { info: "ข้อมูล", signal: "สัญญาณ", open: "เปิด", close: "ปิด", warn: "เตือน", error: "ผิดพลาด" };

function Activity({ bot }: { bot: Bot }) {
  const [tab, setTab] = useState<"log" | "trades">("log");
  const trades = bot.trades;
  return (
    <Section title="บันทึกการทำงาน"
      desc={`สรุป${bot.settings.test ? "โหมดทดสอบ" : "เงินจริง"}: ${bot.stats.count} ไม้ · ชนะ ${bot.stats.winRate.toFixed(0)}% · รวม ${bot.stats.pnlUsdt >= 0 ? "+" : ""}${fmtUsd(bot.stats.pnlUsdt)} USDT (ก่อนค่าธรรมเนียม)`}
      action={(bot.logs.length > 0 || trades.length > 0) && !bot.running && (
        <Button variant="ghost" size="sm" onClick={bot.clearHistory}>ล้าง</Button>
      )}>
      <Segmented size="sm" className="mb-3 w-56" value={tab} onChange={setTab}
        options={[{ value: "log", label: `เหตุการณ์ (${bot.logs.length})` }, { value: "trades", label: `ไม้ที่ปิดแล้ว (${trades.length})` }]} />
      {tab === "log" ? (
        bot.logs.length === 0 ? (
          <Empty title="ยังไม่มีเหตุการณ์">เมื่อบอททำงาน ทุกการตัดสินใจจะถูกบันทึกที่นี่ พร้อมเหตุผล</Empty>
        ) : (
          <ol className="max-h-[420px] divide-y overflow-y-auto border">
            {bot.logs.map((l) => (
              <li key={l.id} className="flex gap-2 px-3 py-2 text-[11px]">
                <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{fmtTime(l.time, false)}</span>
                <span className={cn("w-12 shrink-0 font-semibold", LOG_STYLE[l.kind])}>{LOG_TAG[l.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className={l.kind === "info" ? "" : LOG_STYLE[l.kind]}>{l.text}</span>
                  {l.detail && <span className="block text-[10px] text-muted-foreground">{l.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        )
      ) : trades.length === 0 ? (
        <Empty title="ยังไม่มีไม้ที่ปิด" />
      ) : (
        <div className="max-h-[420px] overflow-auto border">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-muted text-[10px] text-muted-foreground">
              <tr><th className="px-2 py-1.5 text-left">ปิดเมื่อ</th><th className="px-2 text-left">ฝั่ง</th><th className="px-2 text-right">เข้า → ออก</th><th className="px-2 text-right">กำไร</th><th className="px-2 text-left">เหตุผล</th></tr>
            </thead>
            <tbody className="divide-y">
              {trades.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-2 py-1.5">{fmtTime(t.exitTime)}{t.test && <span className="ml-1 text-[9px] text-sky-500">ทดสอบ</span>}</td>
                  <td className={cn("px-2 font-semibold", t.side === "long" ? "text-emerald-500" : "text-red-500")}>{t.side === "long" ? "Long" : "Short"}</td>
                  <td className="whitespace-nowrap px-2 text-right">{fmtPrice(t.entryPrice)} → {fmtPrice(t.exitPrice)}</td>
                  <td className={cn("whitespace-nowrap px-2 text-right font-semibold", toneClass(t.pnlUsdt))}>
                    {t.pnlUsdt >= 0 ? "+" : ""}{fmtUsd(t.pnlUsdt)} <span className="font-normal">({fmtPct(t.pnlPct)})</span>
                  </td>
                  <td className="px-2 text-muted-foreground">{CLOSE_REASON_LABEL[t.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Panel ────────────────────────────────────────────────────
export function BotPanel({ bot, presets, onRemovePreset, connected, onGoConnect }: {
  bot: Bot;
  presets: BotPreset[];
  onRemovePreset: (id: string) => void;
  connected: boolean;
  onGoConnect: () => void;
}) {
  const { settings: s, setSettings, preset, running } = bot;
  const now = useNow(running);
  // The live confirmation belongs to these exact settings — changing any of them asks again
  const liveKey = `${s.test}|${s.market}|${s.amountUsdt}|${s.leverage}|${s.presetId}`;
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const confirmLive = confirmedKey === liveKey;
  const setConfirmLive = (v: boolean) => setConfirmedKey(v ? liveKey : null);
  const locked = running || !!bot.busy;

  const spotBlocked = preset ? presetBlocker(preset, "spot") : null;
  const direction = preset ? presetDirection(preset) : null;
  const notional = s.market === "futures" ? s.amountUsdt * s.leverage : s.amountUsdt;
  const canStart = bot.blockers.length === 0 && (s.test || confirmLive) && !bot.busy;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* ── Setup ── */}
      <div className="space-y-4">
        {!connected && (
          <Notice tone="warn" title="ยังไม่ได้เชื่อมต่อ Binance">
            ดูสัญญาณได้ แต่ต้องเชื่อมต่อก่อนจึงจะเริ่มบอทได้{" "}
            <button type="button" onClick={onGoConnect} className="font-medium text-foreground underline underline-offset-2">ไปเชื่อมต่อ</button>
          </Notice>
        )}

        <Section step={1} done={!!preset} title="เลือกกลยุทธ์ที่ทดสอบแล้ว"
          desc="กลยุทธ์ที่กด “ส่งไปบอทเทรด” จากหน้า Backtest — บอทใช้ indicator, ค่าพารามิเตอร์, Stop/TP และตัวกรองเทรนด์ชุดเดียวกัน">
          {presets.length === 0 ? (
            <Empty icon={<Robot size={24} />} title="ยังไม่มีกลยุทธ์">
              <p>ไปหน้า Backtest → เลือก indicator และปรับค่าจนพอใจ → กดปุ่ม <b>“ส่งไปบอทเทรด”</b> ในแผงกลยุทธ์</p>
              <Link href="/klines" className="mt-3 inline-flex items-center gap-1 border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                ไปหน้า Backtest <ArrowRight size={12} />
              </Link>
            </Empty>
          ) : (
            <div className="space-y-3">
              <ul className="max-h-[340px] space-y-2 overflow-y-auto">
                {presets.map((p) => (
                  <PresetCard key={p.id} p={p} selected={p.id === s.presetId} disabled={locked}
                    onPick={() => setSettings({ presetId: p.id, ...(presetBlocker(p, "spot") && s.market === "spot" ? { market: "futures" } : {}) })}
                    onRemove={() => onRemovePreset(p.id)} />
                ))}
              </ul>
              {preset && <PresetDetail p={preset} />}
              <Link href="/klines" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                ทดสอบกลยุทธ์เพิ่มที่หน้า Backtest <ArrowRight size={11} />
              </Link>
            </div>
          )}
        </Section>

        <Section step={2} title="ตั้งค่าการเทรด" desc={running ? "หยุดบอทก่อนจึงจะแก้ค่าได้" : "ตลาด จำนวนเงินต่อไม้ และโหมด"}>
          <div className="space-y-4">
            <Field label="ตลาด" hint={s.market === "spot"
              ? "Spot: ซื้อเหรียญจริง เปิดได้เฉพาะ Long — สัญญาณ Short จะใช้แค่ขายปิด"
              : "Futures (USDⓈ-M): เปิดได้ทั้ง Long และ Short · บอทตั้ง Isolated margin และต้องเป็น One-way mode"}>
              <Segmented value={s.market} onChange={(v) => !locked && setSettings({ market: v })}
                options={[
                  { value: "spot", label: "Spot" },
                  { value: "futures", label: "Futures" },
                ]} />
            </Field>
            {s.market === "spot" && spotBlocked && <Notice tone="warn">{spotBlocked}</Notice>}
            {s.market === "spot" && direction === "both" && (
              <Notice tone="info">กลยุทธ์นี้ทดสอบแบบ Long + Short — บน Spot บอทจะเทรดเฉพาะฝั่ง Long (ผลจะใกล้เคียงโหมด “ขาขึ้น” ในหน้า Backtest)</Notice>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={s.market === "futures" ? "Margin ต่อไม้ (USDT)" : "เงินต่อไม้ (USDT)"}>
                <Input type="number" inputMode="decimal" min={1} step="any" value={Number.isFinite(s.amountUsdt) ? s.amountUsdt : ""} disabled={locked}
                  onChange={(e) => setSettings({ amountUsdt: parseFloat(e.target.value) })} className="h-9 tabular-nums" />
              </Field>
              {s.market === "futures" ? (
                <Field label="Leverage">
                  <select className={selectClass} value={s.leverage} disabled={locked} onChange={(e) => setSettings({ leverage: Number(e.target.value) })}>
                    {[1, 2, 3, 5, 10, 15, 20].map((l) => <option key={l} value={l}>{l}x</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="ตรวจราคาทุก">
                  <select className={selectClass} value={s.pollSec} disabled={locked} onChange={(e) => setSettings({ pollSec: Number(e.target.value) })}>
                    {POLL_OPTIONS.map((p) => <option key={p} value={p}>{p < 60 ? `${p} วินาที` : `${p / 60} นาที`}</option>)}
                  </select>
                </Field>
              )}
            </div>
            {s.market === "futures" && (
              <Field label="ตรวจราคาทุก" hint="ใช้เช็ค Stop Loss / Take Profit ระหว่างแท่ง — การเข้า/ออกตามสัญญาณเกิดตอนแท่งปิดเสมอ">
                <select className={selectClass} value={s.pollSec} disabled={locked} onChange={(e) => setSettings({ pollSec: Number(e.target.value) })}>
                  {POLL_OPTIONS.map((p) => <option key={p} value={p}>{p < 60 ? `${p} วินาที` : `${p / 60} นาที`}</option>)}
                </select>
              </Field>
            )}
            <p className="text-[11px] text-muted-foreground">
              {s.market === "futures"
                ? <>มูลค่าสถานะต่อไม้ ≈ <b className="text-foreground">{fmtUsd(notional)} USDT</b> ({fmtUsd(s.amountUsdt)} × {s.leverage}x){s.leverage > 1 && <span className="text-amber-500"> · ราคาสวน {(100 / s.leverage).toFixed(1)}% อาจโดน Liquidate</span>}</>
                : <>บอทจะซื้อครั้งละ ≈ <b className="text-foreground">{fmtUsd(notional)} USDT</b> และขายคืนจำนวนเหรียญที่ซื้อมาทั้งหมด</>}
            </p>

            <Field label="โหมด">
              <Segmented value={s.test ? "test" : "live"} onChange={(v) => !locked && setSettings({ test: v === "test" })}
                options={[
                  { value: "test", label: <><Flask size={14} /> ทดสอบ (ไม่ใช้เงิน)</>, activeClass: "bg-sky-500 text-white" },
                  { value: "live", label: <><Lightning size={14} weight="fill" /> เงินจริง</>, activeClass: "bg-red-500 text-white" },
                ]} />
            </Field>
            {s.test ? (
              <p className="text-[11px] text-muted-foreground">Binance จะตรวจคำสั่งแต่ไม่ซื้อขายจริง · บอทจำลองสถานะด้วยราคาตลาดให้ดูผล</p>
            ) : (
              <Notice tone="danger" title="โหมดเงินจริง">
                บอทจะส่งคำสั่งซื้อขายจริงด้วยเงินในบัญชีคุณ ผลจริงอาจต่างจาก Backtest (ค่าธรรมเนียม, slippage, ตลาดเปลี่ยน)
                · บอททำงานเฉพาะตอนเปิดแท็บนี้ไว้ — ปิดแท็บ/คอมหลับ = บอทหยุด
              </Notice>
            )}
          </div>
        </Section>

        <Section step={3} title="เริ่มบอท">
          <div className="space-y-3">
            {bot.blockers.length > 0 && !running && (
              <ul className="space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
                {bot.blockers.map((b) => <li key={b} className="flex gap-1.5"><Warning size={13} className="mt-px shrink-0" />{b}</li>)}
              </ul>
            )}
            {!s.test && !running && bot.blockers.length === 0 && (
              <label className="flex cursor-pointer items-start gap-2 border border-red-500/40 p-2.5 text-[11px]">
                <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} className="mt-0.5 accent-red-500" />
                <span>ยืนยันให้บอทเทรด <b>{preset?.symbol}</b> ด้วยเงินจริง ครั้งละ ≈ <b>{fmtUsd(notional)} USDT</b>
                  {s.market === "futures" && <> (Futures {s.leverage}x)</>} — ฉันยอมรับความเสี่ยงขาดทุน</span>
              </label>
            )}
            {running ? (
              <Button size="lg" variant="outline" className="h-11 w-full border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400" onClick={() => bot.stop()}>
                <Stop size={16} weight="fill" /> หยุดบอท
              </Button>
            ) : (
              <Button size="lg" className={cn("h-11 w-full text-white", s.test ? "bg-sky-600 hover:bg-sky-700" : "bg-red-600 hover:bg-red-700")}
                disabled={!canStart} onClick={() => void bot.start()}>
                {bot.phase === "starting" ? <CircleNotch size={16} className="animate-spin" /> : <Play size={16} weight="fill" />}
                {s.test ? "เริ่มบอท (ทดสอบ)" : "เริ่มบอท (เงินจริง)"}
              </Button>
            )}
            <Button variant="outline" size="lg" className="w-full" disabled={!preset || !!bot.busy || running} onClick={() => void bot.preview()}>
              <MagnifyingGlass size={14} /> ดูสัญญาณตอนนี้ (ไม่ส่งคำสั่ง)
            </Button>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              บอทจะ<b>ไม่ซื้อทันที</b>ถ้ากลยุทธ์ถือสถานะอยู่แล้ว — รอสัญญาณรอบใหม่หลังกดเริ่ม · ตัดสินใจจากแท่งที่ปิดแล้วเท่านั้น (ไม่ repaint)
            </p>
          </div>
        </Section>
      </div>

      {/* ── Status ── */}
      <div className="space-y-4">
        <StatusHero bot={bot} now={now} />
        <StrategyNow bot={bot} />
        <Activity bot={bot} />
      </div>
    </div>
  );
}

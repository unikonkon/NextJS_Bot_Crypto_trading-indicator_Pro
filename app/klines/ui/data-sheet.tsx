"use client";

import { useState } from "react";
import { Check, DownloadSimple, FileCsv, Files, Play, Ranking, Stop, Warning } from "@phosphor-icons/react";
import { Sheet } from "@/components/ui/sheet";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { INTERVAL_MINUTES, type Interval } from "@/lib/types/kline";
import type { CsvFileInfo } from "@/app/api/dataShowUI/route";
import type { DataSource } from "../lib/use-kline-data";
import { fmtDate, fmtPct, fmtPrice, toneClass } from "../lib/format";

const LIMITS = [200, 500, 1000, 2000, 5000, 10_000, 20_000, 40_000];

/** Quick ranges ending now (months back; null = everything Binance has) */
const RANGES: { id: string; label: string; months: number | null }[] = [
  { id: "1m", label: "1 เดือน", months: 1 },
  { id: "2m", label: "2 เดือน", months: 2 },
  { id: "3m", label: "3 เดือน", months: 3 },
  { id: "4m", label: "4 เดือน", months: 4 },
  { id: "6m", label: "6 เดือน", months: 6 },
  { id: "1y", label: "1 ปี", months: 12 },
  { id: "2y", label: "2 ปี", months: 24 },
  { id: "3y", label: "3 ปี", months: 36 },
  { id: "4y", label: "4 ปี", months: 48 },
  { id: "all", label: "ทั้งหมด", months: null },
];
/** 2017-01-01 UTC — Binance has no klines before 2017; it answers from the pair's first bar */
const EXCHANGE_START = Date.UTC(2017, 0, 1);
/** Above this a range is refused (browser memory / hundreds of requests) */
const MAX_RANGE_BARS = 300_000;
const WARN_RANGE_BARS = 50_000;
/** Seconds per 1,000-bar request (measured ~0.05 s + 80 ms pause between pages) */
const SEC_PER_PAGE = 0.15;
const etaSec = (bars: number) => Math.max(1, Math.ceil((bars / 1000) * SEC_PER_PAGE));

function monthsAgo(n: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}
/** ms → value of <input type="datetime-local"> (local time) */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtSize(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
function fmtDays(ms: number): string {
  const d = Math.round(ms / 86_400_000);
  return d >= 360 ? `${(d / 365).toFixed(d % 365 < 5 || d % 365 > 360 ? 0 : 1)} ปี` : `${d} วัน`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  interval: Interval;
  source: DataSource | null;
  barCount: number;
  firstTime: number | null;
  lastTime: number | null;
  /** Open of the first loaded bar / close of the last one */
  firstPrice: number | null;
  lastPrice: number | null;
  loadedAt: Date | null;
  loading: boolean;
  progress: number | null;
  csvFiles: CsvFileInfo[];
  onLatest: (limit: number) => void;
  onRange: (start: number, end: number) => void;
  onCsv: (file: CsvFileInfo) => void;
  onCancel: () => void;
  onDownload: () => void;
  /** Extra history loaded before the evaluation window for indicator warm-up */
  warmup: number;
  /** Most bars "latest" will fetch (evaluation + warm-up) */
  maxBars: number;
  /** Tab to open on (defaults to the current data source) */
  initialTab?: "latest" | "range" | "csv";
  /** Files picked for multi-file runs */
  selected: string[];
  onSelect: (files: string[]) => void;
  onRankFiles: () => void;
  onCompareFiles: () => void;
}

const BIG_FILE = 100_000;

export function DataSheet(p: Props) {
  const [tab, setTab] = useState<"latest" | "range" | "csv">(p.initialTab ?? p.source?.kind ?? "latest");
  const [limit, setLimit] = useState(p.source?.kind === "latest" ? p.source.limit : 1000);
  const [preset, setPreset] = useState<string | null>(null);
  const [start, setStart] = useState(() => (p.source?.kind === "range" ? toLocalInput(p.source.start) : ""));
  const [end, setEnd] = useState("");
  // The sheet remounts on every open, so "now" for the estimate is fresh enough
  const [openedAt] = useState(() => Date.now());

  const tfMs = (INTERVAL_MINUTES[p.interval] ?? 60) * 60_000;
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : openedAt;
  const estBars = Number.isFinite(startMs) && endMs > startMs ? Math.ceil((endMs - startMs) / tfMs) : 0;
  const tooMany = estBars > MAX_RANGE_BARS;
  const latestTotal = Math.min(p.maxBars, limit + p.warmup);

  const pickPreset = (id: string) => {
    const r = RANGES.find((x) => x.id === id)!;
    setPreset(id);
    setStart(toLocalInput(r.months === null ? EXCHANGE_START : monthsAgo(r.months)));
    setEnd("");
  };
  const presetLabel = RANGES.find((r) => r.id === preset)?.label;

  const sel = p.csvFiles.filter((f) => p.selected.includes(f.file));
  const selBars = sel.reduce((n, f) => n + f.bars, 0);
  const toggle = (file: string) => p.onSelect(p.selected.includes(file) ? p.selected.filter((x) => x !== file) : [...p.selected, file]);
  const allNames = p.csvFiles.map((f) => f.file);
  const smallNames = p.csvFiles.filter((f) => f.bars <= BIG_FILE).map((f) => f.file);
  const same = (a: string[]) => a.length === sel.length && a.every((x) => p.selected.includes(x));

  const priceChange = p.firstPrice && p.lastPrice ? (p.lastPrice / p.firstPrice - 1) * 100 : null;

  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      title="ข้อมูลแท่งเทียน"
      description={`${p.symbol} · ${p.interval}`}
      footer={
        <div className="space-y-2">
          {tab === "csv" && (
            <div className="space-y-1.5 border-b pb-2.5">
              <p className="text-[10px] tabular-nums text-muted-foreground">
                เลือก {sel.length}/{p.csvFiles.length} ไฟล์{sel.length > 0 && ` · รวม ${selBars.toLocaleString()} แท่ง`}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="lg" disabled={sel.length === 0} onClick={() => { p.onRankFiles(); p.onClose(); }}>
                  <Ranking size={14} /> จัดอันดับ {sel.length || ""} ไฟล์
                </Button>
                <Button size="lg" variant="outline" disabled={sel.length === 0} onClick={() => { p.onCompareFiles(); p.onClose(); }}>
                  <Play size={13} weight="fill" /> ทดสอบกลยุทธ์
                </Button>
              </div>
            </div>
          )}
          {p.barCount > 0 && p.firstTime !== null && p.lastTime !== null && (
            <div className="space-y-0.5 text-[10px] tabular-nums text-muted-foreground">
              <p>
                โหลดจริง {p.barCount.toLocaleString()} แท่ง (รวมอุ่นเครื่อง) · {fmtDate(p.firstTime, true)} → {fmtDate(p.lastTime, true)}
                {p.loadedAt && ` · โหลดเมื่อ ${p.loadedAt.toLocaleTimeString()}`}
              </p>
              {p.firstPrice !== null && p.lastPrice !== null && (
                <p>
                  ราคา {fmtPrice(p.firstPrice)} → {fmtPrice(p.lastPrice)}{" "}
                  {priceChange !== null && <span className={toneClass(priceChange)}>{fmtPct(priceChange)}</span>}
                </p>
              )}
            </div>
          )}
          <Button variant="outline" size="lg" className="w-full" disabled={p.barCount === 0} onClick={p.onDownload}>
            <DownloadSimple size={14} /> ดาวน์โหลดข้อมูลปัจจุบันเป็น CSV
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "latest", label: "ล่าสุด" },
            { value: "range", label: "ช่วงเวลา" },
            { value: "csv", label: `ไฟล์ (${p.csvFiles.length})` },
          ]}
        />

        {tab === "latest" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              ประเมินผลบน N แท่งล่าสุด และดึงข้อมูลย้อนหลังเพิ่มอีก {p.warmup.toLocaleString()} แท่งให้ indicator อุ่นเครื่องอัตโนมัติ
              (รวมสูงสุด {p.maxBars.toLocaleString()} แท่ง · ดึงครั้งละ 1,000 แท่ง)
            </p>
            <div className="grid grid-cols-4 gap-1">
              {LIMITS.map((l) => (
                <button key={l} type="button" onClick={() => setLimit(l)}
                  className={cn("h-10 border text-xs font-medium tabular-nums", limit === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  {l >= 10_000 ? `${l / 1000}K` : l.toLocaleString()}
                </button>
              ))}
            </div>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              ≈ {fmtDays(limit * tfMs)} ของ {p.interval} · ดึงจริง {latestTotal.toLocaleString()} แท่ง ({Math.ceil(latestTotal / 1000)} รอบ)
              {latestTotal > 10_000 && ` · ~${etaSec(latestTotal)} วินาที`}
            </p>
            <Button size="lg" className="h-11 w-full text-sm" disabled={p.loading} onClick={() => { p.onLatest(limit); p.onClose(); }}>
              โหลด {limit.toLocaleString()} แท่งล่าสุด
            </Button>
          </div>
        )}

        {tab === "range" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium">ช่วงล่าสุด <span className="font-normal text-muted-foreground">(ถึงปัจจุบัน)</span></p>
              <div className="grid grid-cols-5 gap-1">
                {RANGES.map((r) => (
                  <button key={r.id} type="button" onClick={() => pickPreset(r.id)}
                    className={cn("h-10 border text-xs font-medium", preset === r.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0 space-y-1">
                <span className="text-[11px] font-medium">เริ่มต้น</span>
                <Input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setPreset(null); }} className="h-10 px-2 text-xs" />
              </label>
              <label className="block min-w-0 space-y-1">
                <span className="text-[11px] font-medium">สิ้นสุด <span className="font-normal text-muted-foreground">(ว่าง = ตอนนี้)</span></span>
                <Input type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setPreset(null); }} className="h-10 px-2 text-xs" />
              </label>
            </div>

            {estBars > 0 && (
              <p className={cn("flex items-start gap-1 text-[11px] tabular-nums", tooMany ? "text-down" : estBars > WARN_RANGE_BARS ? "text-warn" : "text-muted-foreground")}>
                {(tooMany || estBars > WARN_RANGE_BARS) && <Warning size={13} className="mt-px shrink-0" />}
                <span>
                  {preset === "all" ? "สูงสุด " : ""}≈ {estBars.toLocaleString()} แท่ง {p.interval} ({Math.ceil(estBars / 1000)} รอบ)
                  {preset === "all" && " · เริ่มจากแท่งแรกที่ Binance มี"}
                  {tooMany
                    ? ` · เกิน ${MAX_RANGE_BARS.toLocaleString()} แท่ง เลือก TF ที่ใหญ่ขึ้นหรือช่วงที่สั้นลง`
                    : estBars > WARN_RANGE_BARS && ` · ~${etaSec(estBars)} วินาที`}
                </span>
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">ประเมินทั้งช่วง · แต่ละ indicator เริ่มนับหลังช่วงอุ่นเครื่องของตัวเอง</p>

            {p.loading && p.progress !== null ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 animate-pulse text-[11px] tabular-nums text-muted-foreground">
                  ดึงแล้ว {p.progress.toLocaleString()}{estBars ? ` / ~${estBars.toLocaleString()}` : ""} แท่ง…
                </span>
                <Button variant="destructive" size="lg" onClick={p.onCancel}><Stop size={14} weight="fill" /> ยกเลิก</Button>
              </div>
            ) : (
              <Button size="lg" className="h-11 w-full text-sm" disabled={!start || estBars === 0 || tooMany || p.loading}
                onClick={() => p.onRange(startMs, end ? endMs : Date.now())}>
                {presetLabel ? `ดึงข้อมูล${presetLabel === "ทั้งหมด" ? "ทั้งหมด" : ` ${presetLabel} ล่าสุด`}` : "ดึงข้อมูลย้อนหลัง"}
              </Button>
            )}
          </div>
        )}

        {tab === "csv" && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              ไฟล์ใน app/getData/data/dataShowUI · ติ๊กเลือกเพื่อรันหลายไฟล์ในแท็บกลยุทธ์และจัดอันดับ · กดที่ชื่อไฟล์เพื่อโหลดขึ้นกราฟ
            </p>
            {p.csvFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <Files size={13} className="mr-0.5 text-muted-foreground" />
                {[
                  { label: `ทั้งหมด ${allNames.length}`, names: allNames },
                  ...(smallNames.length < allNames.length ? [{ label: `ไม่รวมไฟล์ใหญ่ ${smallNames.length}`, names: smallNames }] : []),
                ].map((o) => (
                  <button key={o.label} type="button" onClick={() => p.onSelect(o.names)}
                    className={cn("h-7 border px-2 text-[10px] font-medium", same(o.names) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {o.label}
                  </button>
                ))}
                {sel.length > 0 && (
                  <button type="button" onClick={() => p.onSelect([])} className="h-7 border px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground">ล้าง</button>
                )}
              </div>
            )}
            {p.csvFiles.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">ไม่พบไฟล์</p>}
            {p.csvFiles.map((f) => {
              const active = p.source?.kind === "csv" && p.source.file === f.file;
              const on = p.selected.includes(f.file);
              const chg = f.open ? (f.close / f.open - 1) * 100 : 0;
              return (
                <div key={f.file} className={cn("flex w-full items-stretch border", active ? "border-primary bg-primary/5" : on && "border-primary/40")}>
                  <button type="button" role="checkbox" aria-checked={on} aria-label={`เลือก ${f.file}`} onClick={() => toggle(f.file)}
                    className="grid w-11 shrink-0 place-items-center border-r hover:bg-muted">
                    <span className={cn("grid size-4 place-items-center border", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
                      {on && <Check size={11} weight="bold" />}
                    </span>
                  </button>
                  <button type="button" disabled={p.loading} title="โหลดไฟล์นี้ขึ้นกราฟ"
                    onClick={() => { p.onCsv(f); p.onClose(); }}
                    className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left hover:bg-muted disabled:opacity-50">
                    <FileCsv size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex items-baseline gap-1.5 text-xs">
                        <span className="font-semibold">{f.symbol ?? f.file.replace(/\.csv$/, "")}</span>
                        {f.interval && <span className="bg-muted px-1 font-medium tabular-nums">{f.interval}</span>}
                        {active && <span className="text-[10px] font-medium text-primary">บนกราฟ</span>}
                        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {f.bars.toLocaleString()} แท่ง · {fmtSize(f.size)}
                        </span>
                      </p>
                      <p className="text-[10px] tabular-nums text-muted-foreground">
                        {fmtDate(f.from, true)} → {fmtDate(f.to, true)} · {fmtDays(f.to - f.from)}
                      </p>
                      <p className="text-[10px] tabular-nums">
                        <span className="text-muted-foreground">ราคา</span> {fmtPrice(f.open)} → {fmtPrice(f.close)}{" "}
                        <span className={toneClass(chg)}>{fmtPct(chg)}</span>
                        <span className="text-muted-foreground"> · สูง {fmtPrice(f.high)} · ต่ำ {fmtPrice(f.low)}</span>
                      </p>
                      {f.bars > BIG_FILE && <p className="text-[10px] text-warn">ไฟล์ใหญ่ · โหลดและคำนวณช้ากว่าปกติ</p>}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}

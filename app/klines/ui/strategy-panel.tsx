"use client";

import { useState } from "react";
import { CaretRight, TrendUp, TrendDown, ArrowsDownUp, ArrowCounterClockwise, Minus, Plus, Warning, ChartLineUp, LockSimple, Info } from "@phosphor-icons/react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { engineOf, sourceOf } from "@/lib/engine/registry";
import { SourceBadge } from "./indicator-picker";
import {
  CATEGORY_LABELS,
  HTF_LABELS,
  SOURCE_LABELS,
  type HtfFilter,
  type HtfInterval,
  type BacktestConfig,
  type FillMode,
  type BacktestResult,
  type IndicatorDef,
  type ParamDef,
  type Params,
  type StopKind,
  type StopRule,
  type TradeMode,
} from "@/lib/engine/types";
import { fmtDate, fmtPct, toneClass } from "../lib/format";

interface Props {
  def: IndicatorDef;
  params: Params;
  onParam: (key: string, v: number) => void;
  onResetParams: () => void;
  onOpenPicker: () => void;
  config: BacktestConfig;
  onConfig: (c: BacktestConfig) => void;
  result: BacktestResult | null;
  running: boolean;
  /** Error from the last run (validation / not enough data) */
  runError: string | null;
  /** Warm-up bars this strategy needs, and the evaluation window (undefined = whole dataset) */
  warmup: number;
  evalBars?: number;
  onShowResults: () => void;
  htf: HtfStatus;
}

export const MODE_OPTIONS = [
  { value: "long" as TradeMode, label: <><TrendUp size={15} weight="bold" />ขาขึ้น</>, activeClass: "bg-emerald-500 text-white" },
  { value: "short" as TradeMode, label: <><TrendDown size={15} weight="bold" />ขาลง</>, activeClass: "bg-red-500 text-white" },
  { value: "both" as TradeMode, label: <><ArrowsDownUp size={15} weight="bold" />ทั้งสองทาง</>, activeClass: "bg-primary text-primary-foreground" },
];

const MODE_LABEL: Record<TradeMode, string> = { long: "ขาขึ้นอย่างเดียว (Long)", short: "ขาลงอย่างเดียว (Short)", both: "ทั้งสองทาง (Long + Short)" };
const FILL_LABEL: Record<FillMode, string> = { close: "ราคาปิดของแท่งสัญญาณ", nextOpen: "ราคาเปิดของแท่งถัดไป" };

const MODE_HELP: Record<TradeMode, string> = {
  long: "เปิด Long เมื่อมีสัญญาณขาขึ้น · ปิดเมื่อมีสัญญาณขาลง",
  short: "เปิด Short เมื่อมีสัญญาณขาลง · ปิดเมื่อมีสัญญาณขาขึ้น",
  both: "สลับฝั่งตามสัญญาณ: ขาขึ้น → Long, ขาลง → Short",
};

function decimals(step: number): number {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

/** Number input that lets the user clear/type freely; commits valid numbers, clamps on blur */
function NumInput({ value, onChange, min, max, step, className, ariaLabel }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number; className?: string; ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft ?? String(value)}
      step={step}
      min={min}
      max={max}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      onBlur={() => {
        if (draft !== null) {
          const v = parseFloat(draft);
          onChange(clamp(Number.isFinite(v) ? v : value));
          setDraft(null);
        }
      }}
      className={cn("border bg-transparent text-center text-xs tabular-nums outline-none focus:border-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", className)}
    />
  );
}

function ParamField({ pd, value, onChange }: { pd: ParamDef; value: number; onChange: (v: number) => void }) {
  const dec = decimals(pd.step);
  const clamp = (v: number) => Math.min(pd.max, Math.max(pd.min, +v.toFixed(dec)));
  const changed = value !== pd.default;
  if (pd.toggle) {
    const on = value >= 0.5;
    return (
      <label className={cn("flex items-start gap-3 border px-3 py-2.5", on && "border-primary/50 bg-muted/40", pd.locked ? "opacity-80" : "cursor-pointer")}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={pd.locked}
          onClick={() => onChange(on ? 0 : 1)}
          className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}
        >
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-background shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[11px] font-medium">{pd.label}{pd.locked && <LockSimple size={11} className="text-muted-foreground" />}</span>
          {pd.hint && <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{pd.hint}</span>}
        </span>
      </label>
    );
  }
  // Very wide ranges (e.g. bar counts up to millions) get a plain input — a slider would be useless
  const sliderOk = (pd.max - pd.min) / pd.step <= 5000;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="min-w-0 text-[11px] font-medium">
          {pd.label}
          {changed && <span className="ml-1.5 text-[9px] text-amber-500">ค่าเริ่มต้น {pd.default}</span>}
        </label>
        {pd.hint && <span className="truncate text-[10px] text-muted-foreground">{pd.hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex shrink-0">
          <button type="button" aria-label="ลด" onClick={() => onChange(clamp(value - pd.step))} className="grid size-9 place-items-center border border-r-0 hover:bg-muted"><Minus size={12} /></button>
          <NumInput value={value} onChange={onChange} min={pd.min} max={pd.max} step={pd.step} className="h-9 w-16" ariaLabel={pd.label} />
          <button type="button" aria-label="เพิ่ม" onClick={() => onChange(clamp(value + pd.step))} className="grid size-9 place-items-center border border-l-0 hover:bg-muted"><Plus size={12} /></button>
        </div>
        {sliderOk && (
          <input
            type="range"
            min={pd.min}
            max={pd.max}
            step={pd.step}
            value={value}
            onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
            className="h-9 min-w-0 flex-1 accent-primary"
            aria-label={pd.label}
          />
        )}
      </div>
    </div>
  );
}

export interface HtfStatus {
  /** Filter on and the chart timeframe is lower than the filter's */
  applies: boolean;
  chartTf: string;
  loading: boolean;
  error: string | null;
  /** State at the last bar: +1 Long only, −1 Short only, 0 unknown, null not computed */
  state: number | null;
  since: number | null;
}

function HtfSection({ f, onChange, status }: { f: HtfFilter; onChange: (f: HtfFilter) => void; status: HtfStatus }) {
  const label = HTF_LABELS[f.interval];
  const on = f.enabled;
  return (
    <div className={cn("space-y-3 border px-3 py-3", on && "border-primary/50 bg-muted/30")}>
      <label className="flex cursor-pointer items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange({ ...f, enabled: !on })}
          className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}
        >
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-background shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
        <span className="min-w-0">
          <span className="block text-[11px] font-medium">เทรดตามทิศ EMA Cross ของ timeframe ใหญ่</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            EMA เร็ว &gt; ช้า บน {label} → เปิดได้เฉพาะ Long · EMA เร็ว &lt; ช้า → เปิดได้เฉพาะ Short ·
            สัญญาณที่สวนทางยังใช้ปิดไม้ได้ แต่ไม่เปิดไม้ใหม่ · ไม้ที่ถืออยู่ไม่ถูกบังคับปิดเมื่อ {label} พลิก
          </span>
        </span>
      </label>

      {on && (
        <>
          <Segmented<HtfInterval>
            size="sm"
            value={f.interval}
            onChange={(interval) => onChange({ ...f, interval })}
            options={(Object.keys(HTF_LABELS) as HtfInterval[]).map((v) => ({ value: v, label: HTF_LABELS[v] }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] font-medium">EMA เร็ว</span>
              <NumInput value={f.fast} onChange={(fast) => onChange({ ...f, fast })} min={1} max={200} step={1} className="h-9 w-full px-2 text-left" ariaLabel="EMA เร็ว" />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium">EMA ช้า</span>
              <NumInput value={f.slow} onChange={(slow) => onChange({ ...f, slow })} min={2} max={400} step={1} className="h-9 w-full px-2 text-left" ariaLabel="EMA ช้า" />
            </label>
          </div>
          {f.fast >= f.slow && (
            <p className="flex gap-1.5 text-[10px] text-amber-500"><Warning size={13} className="shrink-0" />EMA เร็วควรสั้นกว่า EMA ช้า</p>
          )}
          {!status.applies ? (
            <p className="text-[10px] text-amber-500">ใช้ได้เมื่อกราฟเป็น timeframe ต่ำกว่า {label} (ตอนนี้ {status.chartTf}) — ตอนนี้ตัวกรองไม่มีผล</p>
          ) : status.error ? (
            <p className="text-[10px] text-red-500">โหลดข้อมูล {label} ไม่สำเร็จ: {status.error}</p>
          ) : status.loading || status.state === null ? (
            <p className="animate-pulse text-[10px] text-muted-foreground">กำลังโหลดข้อมูล {label}…</p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">{label} ตอนนี้:</span>
              {status.state === 1 ? (
                <b className="inline-flex items-center gap-1 text-emerald-500"><TrendUp size={13} weight="bold" /> ขาขึ้น · เปิดได้เฉพาะ Long</b>
              ) : status.state === -1 ? (
                <b className="inline-flex items-center gap-1 text-red-500"><TrendDown size={13} weight="bold" /> ขาลง · เปิดได้เฉพาะ Short</b>
              ) : (
                <b className="text-muted-foreground">ยังไม่ทราบ (ข้อมูลไม่พอ) · ไม่เปิดไม้</b>
              )}
              {status.since !== null && status.state !== 0 && <span className="text-[10px] text-muted-foreground">ตั้งแต่ {fmtDate(status.since, true)}</span>}
            </p>
          )}
          <p className="text-[10px] leading-snug text-muted-foreground">
            ใช้เฉพาะแท่ง {label} ที่ปิดแล้ว (แท่งที่ยังไม่ปิดไม่ถูกใช้ ป้องกันการเห็นอนาคต) · บนกราฟ: แถบหนาโปร่งแสง = EMA เร็วของ TF ใหญ่ (เขียว = ช่วง Long, แดง = ช่วง Short) · เส้นประ = EMA ช้า
          </p>
        </>
      )}
    </div>
  );
}

function StopField({ label, rule, onChange, tone }: { label: string; rule: StopRule; onChange: (r: StopRule) => void; tone: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={cn("text-[11px] font-medium", rule.kind !== "none" && tone)}>{label}</span>
        {rule.kind !== "none" && (
          <div className="flex items-center gap-1">
            <NumInput value={rule.value} onChange={(value) => onChange({ ...rule, value })} min={0} max={1000} step={rule.kind === "pct" ? 0.5 : 0.1} className="h-7 w-16" ariaLabel={`${label} value`} />
            <span className="w-8 text-[10px] text-muted-foreground">{rule.kind === "pct" ? "%" : "× ATR"}</span>
          </div>
        )}
      </div>
      <Segmented<StopKind>
        size="sm"
        value={rule.kind}
        onChange={(kind) => onChange({ ...rule, kind })}
        options={[
          { value: "none", label: "ปิด" },
          { value: "pct", label: "% ราคา" },
          { value: "atr", label: "ATR(14)" },
        ]}
      />
    </div>
  );
}

export function StrategyPanel(props: Props) {
  const { def, params, onParam, onResetParams, onOpenPicker, config, onConfig, result, running, runError, warmup, evalBars, onShowResults, htf } = props;
  const paramsChanged = def.params.some((p) => !p.locked && params[p.key] !== p.default);
  const noExit = !config.exitOnOpposite && config.stopLoss.kind === "none" && config.takeProfit.kind === "none" && config.trailing.kind === "none";
  const engine = engineOf(def, params);
  const exposure = engine.kind === "exposure";
  const source = sourceOf(def);
  const defaultFill: FillMode = def.defaultFill ?? "close";
  const visibleParams = def.params.filter((pd) => !pd.visibleWhen || (params[pd.visibleWhen.key] ?? 0) === pd.visibleWhen.value);

  return (
    <div className="space-y-5 p-4">
      {/* 1. Indicator */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1 · Indicator ที่ใช้สร้างสัญญาณ</h3>
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SourceBadge source={source} />
              <span className="truncate text-sm font-semibold">{def.name}</span>
              <span className="shrink-0 border px-1.5 text-[9px] text-muted-foreground">{CATEGORY_LABELS[def.category]}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{SOURCE_LABELS[source]} · แตะเพื่อเปลี่ยน indicator</p>
          </div>
          <CaretRight size={16} className="shrink-0 text-muted-foreground" />
        </button>
        <div className="grid gap-1 text-[11px] leading-snug">
          {def.longRule && <p className="flex gap-1.5"><TrendUp size={14} className="mt-px shrink-0 text-emerald-500" /><span><b className="text-emerald-500">ขาขึ้น:</b> {def.longRule}</span></p>}
          {def.shortRule && <p className="flex gap-1.5"><TrendDown size={14} className="mt-px shrink-0 text-red-500" /><span><b className="text-red-500">ขาลง:</b> {def.shortRule}</span></p>}
          {def.description && <p className="text-muted-foreground">{def.description}</p>}
        </div>
        <p className="flex gap-1.5 text-[10px] text-muted-foreground">
          <Info size={12} className="mt-px shrink-0" />
          อุ่นเครื่อง {warmup.toLocaleString()} แท่ง · {evalBars ? `ประเมิน ${evalBars.toLocaleString()} แท่งล่าสุด` : "ประเมินทุกแท่งหลังอุ่นเครื่อง"}
        </p>
      </section>

      {/* 2. Direction */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">2 · ทิศทางการเทรด</h3>
        {exposure ? (
          <div className="flex items-start gap-2 border px-3 py-2.5 text-[11px]">
            <LockSimple size={14} className="mt-px shrink-0 text-muted-foreground" />
            <span>
              <b>{MODE_LABEL[engine.direction]}</b>
              <span className="block text-[10px] text-muted-foreground">กลยุทธ์นี้กำหนดทิศทางและจังหวะเข้า-ออกเอง (ตามต้นฉบับ) · เข้า-ออกที่{FILL_LABEL.nextOpen}</span>
            </span>
          </div>
        ) : (
          <>
            <Segmented<TradeMode> size="lg" value={config.mode} onChange={(mode) => onConfig({ ...config, mode })} options={MODE_OPTIONS} aria-label="ทิศทางการเทรด" />
            <p className="text-[10px] text-muted-foreground">{MODE_HELP[config.mode]}</p>
            <div className="space-y-1 pt-1">
              <span className="text-[11px] font-medium">ราคาที่ใช้เข้า-ออก</span>
              <Segmented<BacktestConfig["fill"]>
                size="sm"
                value={config.fill}
                onChange={(fill) => onConfig({ ...config, fill })}
                options={[
                  { value: "auto", label: "อัตโนมัติ" },
                  { value: "close", label: "ปิดแท่ง" },
                  { value: "nextOpen", label: "เปิดแท่งถัดไป" },
                ]}
              />
              <p className="text-[10px] text-muted-foreground">
                {config.fill === "auto" ? `ค่าของ indicator นี้: ${FILL_LABEL[defaultFill]}` : FILL_LABEL[config.fill]}
              </p>
            </div>
          </>
        )}
      </section>

      {/* 2b. Higher-timeframe trend filter — applies to every strategy */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ตัวกรองเทรนด์ใหญ่ (Multi-timeframe)</h3>
        <HtfSection f={config.htf} onChange={(h) => onConfig({ ...config, htf: h })} status={htf} />
      </section>

      {/* 3. Params */}
      {def.params.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">3 · พารามิเตอร์</h3>
            {paramsChanged && (
              <button type="button" onClick={onResetParams} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                <ArrowCounterClockwise size={12} /> คืนค่าเริ่มต้น
              </button>
            )}
          </div>
          {visibleParams.map((pd) => (
            <ParamField key={pd.key} pd={pd} value={params[pd.key]} onChange={(v) => onParam(pd.key, v)} />
          ))}
        </section>
      )}

      {/* 4. Risk */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">4 · จุดตัดขาดทุน / ทำกำไร</h3>
        {exposure ? (
          <p className="flex gap-1.5 border px-3 py-2.5 text-[11px] text-muted-foreground">
            <LockSimple size={14} className="mt-px shrink-0" />
            กลยุทธ์นี้ใช้ stop / เป้าหมาย / เงื่อนไขออกของตัวเอง (ปรับได้ในพารามิเตอร์ด้านบน) — SL/TP ของหน้านี้จึงไม่ถูกใช้
          </p>
        ) : (
          <>
            <StopField label="Stop Loss" tone="text-red-500" rule={config.stopLoss} onChange={(stopLoss) => onConfig({ ...config, stopLoss })} />
            <StopField label="Take Profit" tone="text-emerald-500" rule={config.takeProfit} onChange={(takeProfit) => onConfig({ ...config, takeProfit })} />
            <StopField label="Trailing Stop" tone="text-amber-500" rule={config.trailing} onChange={(trailing) => onConfig({ ...config, trailing })} />
            <label className="flex cursor-pointer items-center gap-2 text-[11px]">
              <input type="checkbox" className="size-4 accent-primary" checked={config.exitOnOpposite} onChange={(e) => onConfig({ ...config, exitOnOpposite: e.target.checked })} />
              ปิดสถานะเมื่อเกิดสัญญาณฝั่งตรงข้าม
            </label>
            {noExit && (
              <p className="flex gap-1.5 text-[10px] text-amber-500"><Warning size={13} className="shrink-0" />ไม่มีเงื่อนไขปิดสถานะ — จะถือจนจบข้อมูล</p>
            )}
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] font-medium">ค่าธรรมเนียม / ฝั่ง (%)</span>
            <NumInput value={config.feesPct} onChange={(v) => onConfig({ ...config, feesPct: v })} min={0} max={5} step={0.01} className="h-9 w-full px-2 text-left" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium">Slippage / ฝั่ง (%)</span>
            <NumInput value={config.slippagePct} onChange={(v) => onConfig({ ...config, slippagePct: v })} min={0} max={5} step={0.01} className="h-9 w-full px-2 text-left" />
          </label>
        </div>
      </section>

      {/* Live result */}
      {/* sits just above the fixed mobile bottom nav (h-16 + safe area) */}
      <section className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border lg:px-3">
        {runError ? (
          <p className="flex gap-1.5 text-[11px] text-amber-500"><Warning size={14} className="shrink-0" />{runError}</p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-muted-foreground">{running ? "กำลังคำนวณ…" : "ผลตอบแทนรวม (ทบต้น)"}</p>
              <p className={cn("text-xl font-bold tabular-nums", result ? toneClass(result.totalReturnPct) : "text-muted-foreground", running && "opacity-50")}>
                {result ? fmtPct(result.totalReturnPct) : "—"}
              </p>
              {result && (
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {result.totalTrades} เทรด · ชนะ {result.winRate.toFixed(0)}% · DD −{result.maxDrawdownPct.toFixed(1)}%
                </p>
              )}
            </div>
            <Button variant="outline" size="lg" onClick={onShowResults} disabled={!result}>
              <ChartLineUp size={14} /> ดูผล
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

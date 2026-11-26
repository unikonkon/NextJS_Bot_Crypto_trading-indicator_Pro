"use client";

import { useEffect, useMemo } from "react";
import { ArrowsClockwise, ChartLineUp, CircleNotch, Eye, EyeSlash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toBars } from "@/lib/engine/math";
import { getIndicator, normalizeParams } from "@/lib/engine/registry";
import type { PanePlot } from "@/lib/engine/types";
import PriceChart, { type ChartIndicator, type ChartPriceLine, type LiveBar } from "@/app/klines/ui/price-chart";
import { useLocalState } from "@/app/klines/lib/use-local-state";
import { useMediaQuery } from "@/app/klines/lib/use-media";
import { fmtPrice } from "@/app/klines/lib/format";
import type { Bot } from "../lib/use-bot";
import { Empty, Section } from "./parts";

const UP = "#10b981";
const DOWN = "#ef4444";

/**
 * Price chart of the selected strategy's market with its indicator drawn — the same candles and the
 * same computation the bot decides on. Indicators update when a candle closes; the candle in progress
 * moves with every price check.
 */
export function ChartPanel({ bot }: { bot: Bot }) {
  const { chart, evalInfo: ev, preset, position: pos, settings: s, setSettings, running, busy, error, loaded, preview, unrealized, price } = bot;
  const open = s.showChart;
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);
  const [showTrades, setShowTrades] = useLocalState("trading.chartTrades", true);

  const def = preset ? getIndicator(preset.indicatorId) : undefined;
  const closed = chart?.closed ?? null;
  const bars = useMemo(() => (closed ? toBars(closed) : null), [closed]);
  const n = bars?.length ?? 0;
  // The evaluation belongs to these exact candles (both are set together at every candle close)
  const synced = !!ev && !!bars && ev.bars === n && n > 0 && ev.lastClosedTime === bars.time[n - 1];

  const indicators = useMemo<ChartIndicator[]>(
    () => (def && preset ? [{ def, params: normalizeParams(def, preset.params), isStrategy: true }] : []),
    [def, preset],
  );

  const regime = synced ? ev.chart.regime : null;
  const htfLabel = ev?.htfLabel ?? "";
  const htfPanes = useMemo<PanePlot[]>(() => (regime
    ? [{
        title: `ทิศ ${htfLabel}`,
        series: [{
          kind: "histogram", title: `ทิศ ${htfLabel}`, color: "#94a3b8",
          values: Array.from(regime, (r) => (r === 0 ? null : r)),
          colors: Array.from(regime, (r) => (r === 1 ? "rgba(16,185,129,0.6)" : r === -1 ? "rgba(239,68,68,0.6)" : null)),
        }],
      }]
    : []), [regime, htfLabel]);

  const forming = chart?.forming ?? null;
  const liveBar = useMemo<LiveBar | null>(() => (forming
    ? { time: forming.openTime, open: +forming.open, high: +forming.high, low: +forming.low, close: +forming.close, volume: +forming.volume }
    : null), [forming]);

  // The bot's real position: entry and stop levels
  const trail = unrealized?.trail ?? null;
  const lines = useMemo<ChartPriceLine[]>(() => {
    if (!pos || !preset || pos.symbol !== preset.symbol) return [];
    const out: ChartPriceLine[] = [{ price: pos.entryPrice, color: pos.side === "long" ? UP : DOWN, title: `บอทเข้า ${pos.side === "long" ? "Long" : "Short"}` }];
    if (pos.stops?.sl != null) out.push({ price: pos.stops.sl, color: DOWN, title: "Stop Loss" });
    if (pos.stops?.tp != null) out.push({ price: pos.stops.tp, color: UP, title: "Take Profit" });
    if (trail != null) out.push({ price: trail, color: "#f59e0b", title: "Trailing" });
    return out;
  }, [pos, preset, trail]);

  // Load the chart as soon as a strategy is selected (no API key needed) — once; errors wait for a manual retry
  const wantLoad = loaded && open && !!preset && !running && !ev && !busy && !error;
  useEffect(() => {
    if (!wantLoad) return;
    const t = setTimeout(() => void preview(), 250);
    return () => clearTimeout(t);
  }, [wantLoad, preview]);

  const last = liveBar?.close ?? price ?? (bars && n ? bars.close[n - 1] : null);

  return (
    <Section
      title={<span className="flex flex-wrap items-baseline gap-x-2">
        กราฟราคา + Indicator
        {preset && <span className="text-[11px] font-normal text-muted-foreground">
          {preset.symbol} · {preset.interval}{last !== null && <> · <b className="tabular-nums text-foreground">{fmtPrice(last)}</b></>}
        </span>}
      </span>}
      desc={open ? (def ? `${def.name} — คำนวณจากแท่งที่ปิดแล้วชุดเดียวกับที่บอทใช้ตัดสินใจ` : "เลือกกลยุทธ์เพื่อดูกราฟ") : undefined}
      action={
        <div className="flex shrink-0 items-center gap-1">
          {open && preset && !running && (
            <Button variant="ghost" size="icon-sm" onClick={() => void preview()} disabled={!!busy} aria-label="โหลดกราฟใหม่" title="โหลดราคาล่าสุด">
              {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} />}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setSettings({ showChart: !open })} aria-expanded={open}>
            {open ? <EyeSlash size={13} /> : <Eye size={13} />} {open ? "ซ่อนกราฟ" : "แสดงกราฟ"}
          </Button>
        </div>
      }
    >
      {!open ? undefined : !preset || !def ? (
        <Empty icon={<ChartLineUp size={22} />} title="ยังไม่ได้เลือกกลยุทธ์">เลือกกลยุทธ์ในขั้นที่ 1 แล้วกราฟจะโหลดให้อัตโนมัติ</Empty>
      ) : !bars ? (
        <Empty icon={busy ? <CircleNotch size={22} className="animate-spin" /> : <ChartLineUp size={22} />}
          title={busy ? "กำลังโหลดแท่งเทียน…" : error ? "โหลดกราฟไม่สำเร็จ" : "ยังไม่ได้โหลดกราฟ"}>
          {error && <p className="text-red-500">{error}</p>}
          {!busy && <Button variant="outline" size="sm" className="mt-2" onClick={() => void preview()}><ArrowsClockwise size={12} /> โหลดกราฟ</Button>}
        </Empty>
      ) : (
        <div className="space-y-2">
          <div className="-mx-4 -mt-4 border-b">
            <PriceChart
              bars={bars}
              indicators={indicators}
              trades={synced ? ev.chart.trades : null}
              showTrades={showTrades}
              compact={!isDesktop}
              evalBars={synced ? ev.evalBars : undefined}
              extraOverlays={synced ? ev.chart.overlays : undefined}
              extraPanes={htfPanes}
              fitKey={`${preset.symbol}|${preset.interval}`}
              liveBar={liveBar}
              priceLines={lines}
              hideEndExit
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
            <button type="button" role="switch" aria-checked={showTrades} onClick={() => setShowTrades(!showTrades)}
              className={cn("flex h-7 items-center gap-1.5 border px-2 font-medium", showTrades ? "border-primary/60 text-foreground" : "hover:text-foreground")}>
              <span className={cn("size-2.5 border", showTrades ? "border-primary bg-primary" : "border-muted-foreground/50")} />
              จุดเข้า-ออกของ Backtest
            </button>
            {showTrades ? (
              <span><b className="text-emerald-500">▲ L</b> เข้า Long · <b className="text-red-500">▼ S</b> เข้า Short · ● ออก (% กำไร)</span>
            ) : (
              <span>แสดงสัญญาณของ indicator แทน</span>
            )}
            <span><b className="text-amber-500">■</b> เริ่มประเมิน</span>
            {ev?.htfLabel && <span>เส้นประ + แถบล่าง = ตัวกรอง {ev.htfLabel} (เขียว Long / แดง Short)</span>}
            {lines.length > 0 && <span>เส้นประแนวนอน = ราคาเข้าและ Stop ของบอท</span>}
            <span className="ml-auto">{running ? "แท่งล่าสุดขยับตามรอบตรวจราคา · indicator อัปเดตเมื่อแท่งปิด" : "ภาพนิ่ง ณ ตอนโหลด — เริ่มบอทเพื่ออัปเดตสด"}</span>
          </div>
        </div>
      )}
    </Section>
  );
}

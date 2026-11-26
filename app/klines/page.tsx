"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartLineUp, Faders, ListNumbers, Ranking, Plus, X, TrendUp, TrendDown, Warning, Eye, EyeSlash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Interval } from "@/lib/types/kline";
import { toBars } from "@/lib/engine/math";
import { getIndicator, listIndicators, normalizeParams } from "@/lib/engine/registry";
import { getPool, AbortedError } from "@/lib/engine/worker/pool";
import { DEFAULT_CONFIG, type BacktestConfig, type BacktestResult, type Bars, type Params } from "@/lib/engine/types";
import { useKlineData } from "./lib/use-kline-data";
import { useLocalState } from "./lib/use-local-state";
import { useMediaQuery } from "./lib/use-media";
import { fmtPct, toneClass } from "./lib/format";
import { TopBar } from "./ui/top-bar";
import { DataSheet } from "./ui/data-sheet";
import PriceChart, { type ChartIndicator } from "./ui/price-chart";
import { IndicatorPicker } from "./ui/indicator-picker";
import { StrategyPanel } from "./ui/strategy-panel";
import { ResultsPanel } from "./ui/results-panel";
import { RankingPanel, type RankRow, type RankScope } from "./ui/ranking-panel";

type MobileTab = "chart" | "strategy" | "results" | "ranking";
type SideTab = "strategy" | "ranking";

const NAV: { tab: MobileTab; label: string; icon: typeof ChartLineUp }[] = [
  { tab: "chart", label: "กราฟ", icon: ChartLineUp },
  { tab: "strategy", label: "กลยุทธ์", icon: Faders },
  { tab: "results", label: "ผลลัพธ์", icon: ListNumbers },
  { tab: "ranking", label: "จัดอันดับ", icon: Ranking },
];

export default function KlinesPage() {
  const data = useKlineData();

  // ─── Persisted preferences ────────────────────────────────
  const [symbol, setSymbol] = useLocalState("klines.symbol", "BTCUSDT");
  const [interval, setInterval] = useLocalState<Interval>("klines.interval", "1h");
  const [limit, setLimit] = useLocalState("klines.limit", 1000);
  const [strategyId, setStrategyId] = useLocalState("klines.strategy", "supertrend");
  const [paramsById, setParamsById] = useLocalState<Record<string, Params>>("klines.params", {});
  const [config, setConfig] = useLocalState<BacktestConfig>("klines.config", DEFAULT_CONFIG);
  const [favorites, setFavorites] = useLocalState<string[]>("klines.favorites", []);
  const [overlayIds, setOverlayIds] = useLocalState<string[]>("klines.overlays", []);
  const [showTrades, setShowTrades] = useLocalState("klines.showTrades", true);
  const [rankScope, setRankScope] = useLocalState<RankScope>("klines.rankScope", "all");

  // Wait one commit so persisted values are loaded before the first fetch
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // ─── UI state ─────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [sideTab, setSideTab] = useState<SideTab>("strategy");
  const [picker, setPicker] = useState<null | "strategy" | "overlay">(null);
  const [dataOpen, setDataOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);
  const resultsRef = useRef<HTMLDivElement>(null);

  // ─── Data ─────────────────────────────────────────────────
  const bars = useMemo<Bars>(() => toBars(data.klines), [data.klines]);
  const sourceRef = useRef(data.source);
  useEffect(() => { sourceRef.current = data.source; }, [data.source]);

  const { loadLatest, loadRange, setError } = data;
  useEffect(() => {
    if (!ready) return;
    const src = sourceRef.current;
    if (src?.kind === "range") loadRange(symbol, interval, src.start, src.end);
    else loadLatest(symbol, interval, limit);
    // Reload only when the market changes; limit/range changes go through the data sheet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, symbol, interval, loadLatest, loadRange]);

  // ─── Strategy ─────────────────────────────────────────────
  const def = getIndicator(strategyId) ?? listIndicators()[0];
  const params = useMemo(() => normalizeParams(def, paramsById[def.id]), [def, paramsById]);

  const setParam = useCallback((key: string, v: number) => {
    setParamsById((prev) => ({ ...prev, [def.id]: { ...normalizeParams(def, prev[def.id]), [key]: v } }));
  }, [def, setParamsById]);
  const resetParams = useCallback(() => {
    setParamsById((prev) => { const next = { ...prev }; delete next[def.id]; return next; });
  }, [def, setParamsById]);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, [setFavorites]);

  // ─── Single backtest (auto-runs on the worker pool, debounced) ──
  const [single, setSingle] = useState<{ bars: Bars; result: BacktestResult } | null>(null);
  const [running, setRunning] = useState(false);
  const minBars = Math.max(50, def.minBars);

  useEffect(() => {
    if (data.klines.length) getPool().setData(data.klines);
  }, [data.klines]);

  useEffect(() => {
    if (bars.length < minBars) { setRunning(false); return; }
    const ctrl = new AbortController();
    setRunning(true);
    const t = setTimeout(() => {
      getPool()
        .run({ indicatorId: def.id, params, config, full: true }, ctrl.signal)
        .then((result) => { if (!ctrl.signal.aborted) setSingle({ bars, result }); })
        .catch((err) => { if (!(err instanceof AbortedError)) setError(`Backtest ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`); })
        .finally(() => { if (!ctrl.signal.aborted) setRunning(false); });
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [bars, def, params, config, minBars, setError]);

  // A result only belongs to the bars it was computed on
  const result = single && single.bars === bars ? single.result : null;

  // ─── Ranking (many indicators in parallel) ────────────────
  const [rank, setRank] = useState<{ rows: RankRow[]; bars: Bars; configKey: string } | null>(null);
  const [rankRunning, setRankRunning] = useState(false);
  const [rankProgress, setRankProgress] = useState<{ done: number; total: number } | null>(null);
  const rankCtrl = useRef<AbortController | null>(null);
  const configKey = JSON.stringify(config);

  const runRanking = useCallback(async () => {
    const defs = listIndicators().filter((d) =>
      rankScope === "all" ? true : rankScope === "fav" ? favorites.includes(d.id) : d.category === rankScope);
    if (!defs.length || bars.length < 50) return;
    rankCtrl.current?.abort();
    const ctrl = new AbortController();
    rankCtrl.current = ctrl;
    setRankRunning(true);
    setRankProgress({ done: 0, total: defs.length });
    try {
      const outs = await getPool().runMany(
        defs.map((d) => ({ indicatorId: d.id, params: paramsById[d.id], config, full: false as const })),
        (done, total) => setRankProgress({ done, total }),
        ctrl.signal,
      );
      const rows: RankRow[] = defs.map((d, i) => {
        const o = outs[i];
        return o instanceof Error
          ? { id: d.id, name: d.name, category: d.category, summary: null, error: o.message }
          : { id: d.id, name: d.name, category: d.category, summary: o as RankRow["summary"] };
      });
      setRank({ rows, bars, configKey });
    } catch (err) {
      if (!(err instanceof AbortedError)) setError(String(err));
    } finally {
      if (rankCtrl.current === ctrl) {
        setRankRunning(false);
        setRankProgress(null);
        rankCtrl.current = null;
      }
    }
  }, [rankScope, favorites, bars, paramsById, config, configKey, setError]);

  const cancelRanking = useCallback(() => rankCtrl.current?.abort(), []);
  const rankStale = !!rank && (rank.bars !== bars || rank.configKey !== configKey);

  // ─── Chart indicators: strategy + extra overlays ──────────
  const chartIndicators = useMemo<ChartIndicator[]>(() => {
    const list: ChartIndicator[] = [{ def, params, isStrategy: true }];
    for (const id of overlayIds) {
      if (id === def.id) continue;
      const d = getIndicator(id);
      if (d) list.push({ def: d, params: normalizeParams(d, paramsById[id]), isStrategy: false });
    }
    return list;
  }, [def, params, overlayIds, paramsById]);

  // ─── Navigation helpers ───────────────────────────────────
  const showResults = useCallback(() => {
    if (isDesktop) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else setMobileTab("results");
  }, [isDesktop]);

  const applyFromRanking = useCallback((id: string) => {
    setStrategyId(id);
    if (!isDesktop) setMobileTab("chart");
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }, [isDesktop, setStrategyId]);

  const lastClose = bars.length ? bars.close[bars.length - 1] : null;
  const changePct = bars.length > 1 ? ((bars.close[bars.length - 1] - bars.close[0]) / bars.close[0]) * 100 : null;

  // visible on mobile when its tab is active; always visible in the desktop left column
  const leftVis = (tab: MobileTab) => cn(mobileTab === tab ? "block" : "hidden", "lg:block");
  // visible on mobile when its tab is active; on desktop when its sidebar tab is active
  const sideVis = (tab: SideTab) => cn(mobileTab === tab ? "block" : "hidden", sideTab === tab ? "lg:block" : "lg:hidden");

  return (
    <div className="min-h-dvh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] text-foreground lg:pb-0">
      <TopBar
        symbol={symbol}
        onSymbol={setSymbol}
        interval={interval}
        onInterval={setInterval}
        lastClose={lastClose}
        changePct={changePct}
        barCount={bars.length}
        loading={data.loading}
        onOpenData={() => setDataOpen(true)}
      />

      {data.error && (
        <div className="mx-auto flex max-w-[1600px] items-start gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <Warning size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{data.error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="ปิด"><X size={14} /></button>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-4 lg:p-4">
        {/* ═══ Left: chart + results ═══ */}
        <div className="min-w-0 space-y-4">
          <section className={leftVis("chart")}>
            <div className="border-b bg-card lg:border">
              {/* Chart toolbar */}
              <div className="flex items-center gap-1.5 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none]">
                <button
                  type="button"
                  onClick={() => setPicker("strategy")}
                  className="flex h-8 shrink-0 items-center gap-1.5 bg-primary px-2.5 text-[11px] font-medium text-primary-foreground"
                  title="เปลี่ยน indicator ของกลยุทธ์"
                >
                  <Faders size={13} /> {def.name}
                </button>
                {chartIndicators.filter((c) => !c.isStrategy).map((c) => (
                  <span key={c.def.id} className="flex h-8 shrink-0 items-center gap-1 border pl-2.5 text-[11px]">
                    {c.def.name}
                    <button type="button" onClick={() => setOverlayIds((prev) => prev.filter((x) => x !== c.def.id))} className="grid size-7 place-items-center text-muted-foreground hover:text-foreground" aria-label={`เอา ${c.def.name} ออก`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setPicker("overlay")} className="flex h-8 shrink-0 items-center gap-1 border border-dashed px-2.5 text-[11px] text-muted-foreground hover:text-foreground">
                  <Plus size={12} /> Indicator
                </button>
                <button
                  type="button"
                  onClick={() => setShowTrades((v) => !v)}
                  className={cn("ml-auto flex h-8 shrink-0 items-center gap-1 px-2.5 text-[11px]", showTrades ? "text-foreground" : "text-muted-foreground")}
                  title="แสดง/ซ่อนจุดเข้า-ออกของเทรด"
                >
                  {showTrades ? <Eye size={13} /> : <EyeSlash size={13} />} เทรด
                </button>
              </div>

              {bars.length > 0 ? (
                <PriceChart bars={bars} indicators={chartIndicators} trades={result?.trades ?? null} showTrades={showTrades} compact={!isDesktop} />
              ) : (
                <div className="grid h-[320px] place-items-center text-xs text-muted-foreground lg:h-[460px]">
                  {data.loading ? `กำลังโหลด ${symbol} ${interval}…${data.progress ? ` ${data.progress.toLocaleString()} แท่ง` : ""}` : "ยังไม่มีข้อมูล — กดปุ่ม “ข้อมูล” ด้านบน"}
                </div>
              )}

              {/* Quick summary strip */}
              <button type="button" onClick={showResults} disabled={!result} className="flex w-full items-center gap-3 border-t px-3 py-2 text-left hover:bg-muted/40 disabled:hover:bg-transparent">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">
                    {running ? "กำลังทดสอบ…" : bars.length < minBars && bars.length > 0 ? `ต้องมีอย่างน้อย ${minBars} แท่ง` : "ผลทดสอบย้อนหลัง (ทบต้น)"}
                  </p>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums">
                    <span className={cn("text-base font-bold", result ? toneClass(result.totalReturnPct) : "text-muted-foreground")}>{result ? fmtPct(result.totalReturnPct) : "—"}</span>
                    {result && (
                      <>
                        <span className="text-muted-foreground">{result.totalTrades} เทรด · ชนะ {result.winRate.toFixed(0)}%</span>
                        <span className="inline-flex items-center gap-0.5"><TrendUp size={11} className="text-emerald-500" /><span className={toneClass(result.long.returnPct)}>{fmtPct(result.long.returnPct, 1)}</span></span>
                        <span className="inline-flex items-center gap-0.5"><TrendDown size={11} className="text-red-500" /><span className={toneClass(result.short.returnPct)}>{fmtPct(result.short.returnPct, 1)}</span></span>
                      </>
                    )}
                  </p>
                </div>
                {result?.openSide && (
                  <span className={cn("shrink-0 px-2 py-1 text-[10px] font-semibold text-white", result.openSide === "long" ? "bg-emerald-500" : "bg-red-500")}>
                    ถือ {result.openSide === "long" ? "LONG" : "SHORT"}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground lg:hidden">ดูผล ›</span>
              </button>
            </div>
          </section>

          <section ref={resultsRef} className={cn(leftVis("results"), "scroll-mt-16 px-3 py-3 lg:p-0")}>
            <ResultsPanel result={result} def={def} mode={config.mode} bars={bars} running={running} />
          </section>
        </div>

        {/* ═══ Right: strategy / ranking ═══ */}
        <aside className="lg:sticky lg:top-[57px] lg:max-h-[calc(100dvh-73px)] lg:self-start lg:overflow-y-auto lg:border lg:bg-card">
          <div className="sticky top-0 z-10 hidden grid-cols-2 border-b bg-card lg:grid">
            {(["strategy", "ranking"] as SideTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSideTab(t)}
                className={cn("flex h-11 items-center justify-center gap-1.5 text-xs font-medium", sideTab === t ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t === "strategy" ? <><Faders size={14} /> กลยุทธ์</> : <><Ranking size={14} /> จัดอันดับ</>}
              </button>
            ))}
          </div>
          <section className={sideVis("strategy")}>
            <StrategyPanel
              def={def}
              params={params}
              onParam={setParam}
              onResetParams={resetParams}
              onOpenPicker={() => setPicker("strategy")}
              config={config}
              onConfig={setConfig}
              result={result}
              running={running}
              barCount={bars.length}
              onShowResults={showResults}
            />
          </section>
          <section className={sideVis("ranking")}>
            <RankingPanel
              rows={rank?.rows ?? null}
              running={rankRunning}
              progress={rankProgress}
              stale={rankStale}
              scope={rankScope}
              onScope={setRankScope}
              favorites={favorites}
              mode={config.mode}
              workers={ready ? getPool().size : 1}
              barCount={bars.length}
              currentId={def.id}
              onRun={runRanking}
              onCancel={cancelRanking}
              onApply={applyFromRanking}
            />
          </section>
        </aside>
      </main>

      {/* ═══ Mobile bottom navigation ═══ */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map(({ tab, label, icon: Icon }) => {
          const active = mobileTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => { setMobileTab(tab); window.scrollTo({ top: 0 }); }}
              className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium", active ? "text-foreground" : "text-muted-foreground")}
              aria-current={active ? "page" : undefined}
            >
              {active && <span className="absolute inset-x-6 top-0 h-0.5 bg-primary" />}
              <Icon size={20} weight={active ? "fill" : "regular"} />
              {label}
              {tab === "ranking" && rankRunning && <span className="absolute right-[30%] top-3 size-1.5 animate-pulse rounded-full bg-amber-500" />}
            </button>
          );
        })}
      </nav>

      {/* ═══ Sheets ═══ */}
      <IndicatorPicker
        open={picker === "strategy"}
        onClose={() => setPicker(null)}
        title="เลือก Indicator สำหรับกลยุทธ์"
        description="สัญญาณขาขึ้น/ขาลงของ indicator นี้จะใช้เปิด-ปิดสถานะ"
        selected={[def.id]}
        onPick={setStrategyId}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
      />
      <IndicatorPicker
        open={picker === "overlay"}
        onClose={() => setPicker(null)}
        title="แสดง Indicator เพิ่มบนกราฟ"
        description="เลือกได้หลายตัว — ใช้พารามิเตอร์ที่ปรับไว้ของแต่ละตัว"
        selected={[def.id, ...overlayIds]}
        multi
        plottableOnly
        onPick={(id) => { if (id !== def.id) setOverlayIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])); }}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
      />
      <DataSheet
        key={dataOpen ? "open" : "closed"}
        open={dataOpen}
        onClose={() => setDataOpen(false)}
        symbol={symbol}
        interval={interval}
        source={data.source}
        barCount={bars.length}
        firstTime={bars.length ? bars.time[0] : null}
        lastTime={bars.length ? bars.time[bars.length - 1] : null}
        loadedAt={data.loadedAt}
        loading={data.loading}
        progress={data.progress}
        csvFiles={data.csvFiles}
        onLatest={(l) => { setLimit(l); loadLatest(symbol, interval, l); }}
        onRange={(s, e) => loadRange(symbol, interval, s, e)}
        onCsv={data.loadCsv}
        onCancel={data.cancel}
        onDownload={() => data.downloadCsv(`${symbol}_${interval}`)}
      />
    </div>
  );
}

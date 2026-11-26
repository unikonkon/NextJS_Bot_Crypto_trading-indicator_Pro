"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartLineUp, Faders, ListNumbers, Ranking, Plus, X, TrendUp, TrendDown, Warning, Eye, EyeSlash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Interval } from "@/lib/types/kline";
import { toBars } from "@/lib/engine/math";
import { detectTfMinutes, getIndicator, htfApplies, htfIndicator, htfWarmupBars, listIndicators, normalizeParams, sourceOf, warmupOf } from "@/lib/engine/registry";
import { htfTrend, normalizeHtf } from "@/lib/engine/htf";
import { getPool, AbortedError } from "@/lib/engine/worker/pool";
import { DEFAULT_CONFIG, HTF_LABELS, type BacktestConfig, type BacktestResult, type Bars, type PanePlot, type Params } from "@/lib/engine/types";
import { useKlineData } from "./lib/use-kline-data";
import { useHtfData } from "./lib/use-htf-data";
import { useLocalState } from "./lib/use-local-state";
import { useMediaQuery } from "./lib/use-media";
import { fmtPct, toneClass } from "./lib/format";
import { TopBar } from "./ui/top-bar";
import { DataSheet } from "./ui/data-sheet";
import PriceChart, { type ChartIndicator } from "./ui/price-chart";
import { IndicatorPicker } from "./ui/indicator-picker";
import { StrategyPanel } from "./ui/strategy-panel";
import { ResultsPanel } from "./ui/results-panel";
import { RankingPanel, inScope, type RankRow, type RankScope } from "./ui/ranking-panel";

type MobileTab = "chart" | "strategy" | "results" | "ranking";

/** Upper bound of bars fetched (evaluation window + warm-up) — 20 Binance requests */
const MAX_BARS = 20_000;
const INTERVAL_MINUTES: Record<string, number> = {
  "1s": 1 / 60, "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240,
  "6h": 360, "8h": 480, "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080, "1M": 43200,
};
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

  // ─── Data: evaluation window + automatic warm-up history ──
  const bars = useMemo<Bars>(() => toBars(data.klines), [data.klines]);
  const sourceRef = useRef(data.source);
  useEffect(() => { sourceRef.current = data.source; }, [data.source]);
  const { loadLatest, loadRange, setError } = data;

  /** "Latest N bars" = evaluate the last N bars; the warm-up history is fetched on top */
  const isLatest = !data.source || data.source.kind === "latest";
  const evalBars = isLatest ? limit : undefined;
  const tfMinutes = INTERVAL_MINUTES[interval] ?? 60;
  const strategyWarmup = useMemo(() => warmupOf(def, params, tfMinutes), [def, params, tfMinutes]);
  const [rankWarmup, setRankWarmup] = useState(0);
  const neededWarmup = useMemo(
    () => Math.max(rankWarmup, ...chartIndicators.map((c) => warmupOf(c.def, c.params, tfMinutes))),
    [chartIndicators, rankWarmup, tfMinutes],
  );
  const desiredTotal = Math.min(MAX_BARS, limit + neededWarmup);
  const desiredRef = useRef(desiredTotal);
  useEffect(() => { desiredRef.current = desiredTotal; }, [desiredTotal]);
  const requestedRef = useRef("");

  // Reload when the market changes
  useEffect(() => {
    if (!ready) return;
    const src = sourceRef.current;
    if (src?.kind === "range") { loadRange(symbol, interval, src.start, src.end); return; }
    requestedRef.current = `${symbol}|${interval}|${desiredRef.current}`;
    loadLatest(symbol, interval, desiredRef.current);
  }, [ready, symbol, interval, loadLatest, loadRange]);

  // Fetch more history when a strategy needs a longer warm-up than what is loaded
  useEffect(() => {
    if (!ready || data.loading || !isLatest || data.klines.length === 0 || bars.length >= desiredTotal) return;
    const key = `${symbol}|${interval}|${desiredTotal}`;
    if (requestedRef.current === key) return; // already asked — the exchange may simply have less history
    requestedRef.current = key;
    loadLatest(symbol, interval, desiredTotal);
  }, [ready, data.loading, data.klines.length, isLatest, bars.length, desiredTotal, symbol, interval, loadLatest]);

  // ─── Higher-timeframe trend filter (e.g. CCI on 3D while trading 30m) ──
  const htfCfg = useMemo(() => normalizeHtf(config.htf), [config.htf]);
  const htfInd = useMemo(() => htfIndicator(htfCfg), [htfCfg]);
  // Same bar spacing the engine detects, so a CSV of another timeframe is handled correctly
  const dataTfMinutes = bars.length > 1 ? detectTfMinutes(bars) : tfMinutes;
  const htfActive = htfApplies(htfCfg, dataTfMinutes);
  const csvSymbol = data.source?.kind === "csv" ? /^([A-Z0-9]{5,})_/.exec(data.source.file)?.[1] : undefined;
  const htf = useHtfData({
    active: htfActive,
    symbol: csvSymbol ?? symbol,
    interval: htfCfg.interval,
    warmBars: useMemo(() => htfWarmupBars(htfCfg), [htfCfg]),
    firstTime: bars.length ? bars.time[0] : null,
    lastTime: bars.length ? bars.time[bars.length - 1] : null,
    ltfMinutes: dataTfMinutes,
  });
  const htfReady = !htfActive || !!htf.klines;
  const htfBars = useMemo(() => (htf.klines ? toBars(htf.klines) : null), [htf.klines]);
  const trend = useMemo(
    () => (htfActive && htfBars && bars.length
      ? htfTrend(bars, htfBars, htfInd.def, htfInd.params, htfCfg.interval, dataTfMinutes)
      : null),
    [htfActive, htfBars, bars, htfInd, htfCfg.interval, dataTfMinutes],
  );
  const htfLabel = `${htfInd.def.name} ${HTF_LABELS[htfCfg.interval]}`;
  // The filter's own lines (dashed) on the price + a strip showing the allowed side
  const htfOverlays = trend?.overlays;
  const htfPanes = useMemo<PanePlot[]>(() => (trend
    ? [{
        title: `ทิศ ${htfLabel}`,
        series: [{
          kind: "histogram", title: `ทิศ ${htfLabel}`, color: "#94a3b8",
          values: Array.from(trend.regime, (r) => (r === 0 ? null : r)),
          colors: Array.from(trend.regime, (r) => (r === 1 ? "rgba(16,185,129,0.6)" : r === -1 ? "rgba(239,68,68,0.6)" : null)),
        }],
      }]
    : []), [trend, htfLabel]);

  // ─── Single backtest (auto-runs on the worker pool, debounced) ──
  const [single, setSingle] = useState<{ bars: Bars; result: BacktestResult } | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (data.klines.length) getPool().setData(data.klines);
  }, [data.klines]);

  // Must run before the backtest effect below so jobs see the new higher-timeframe bars
  useEffect(() => {
    getPool().setHtf(htf.klines ? htfCfg.interval : null, htf.klines);
  }, [htf.klines, htfCfg.interval]);

  useEffect(() => {
    if (bars.length === 0) { setRunning(false); return; }
    if (!htfReady) {
      // waiting for the higher-timeframe bars (or they failed to load)
      setRunning(!htf.error);
      setRunError(htf.error ? `โหลดข้อมูล ${htfLabel} ไม่สำเร็จ: ${htf.error}` : null);
      return;
    }
    const ctrl = new AbortController();
    setRunning(true);
    const t = setTimeout(() => {
      getPool()
        .run({ indicatorId: def.id, params, config, full: true, evalBars }, ctrl.signal)
        .then((result) => { if (!ctrl.signal.aborted) { setSingle({ bars, result }); setRunError(null); } })
        .catch((err) => {
          if (err instanceof AbortedError || ctrl.signal.aborted) return;
          setSingle(null);
          setRunError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => { if (!ctrl.signal.aborted) setRunning(false); });
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [bars, def, params, config, evalBars, htfReady, htf.klines, htf.error, htfLabel]);

  // A result only belongs to the bars it was computed on
  const result = single && single.bars === bars ? single.result : null;

  // ─── Ranking (many indicators in parallel, same evaluation window) ──
  const [rank, setRank] = useState<{ rows: RankRow[]; bars: Bars; configKey: string } | null>(null);
  const [rankRunning, setRankRunning] = useState(false);
  const [rankProgress, setRankProgress] = useState<{ done: number; total: number } | null>(null);
  const [rankPending, setRankPending] = useState<{ since: Date | null } | null>(null);
  const rankCtrl = useRef<AbortController | null>(null);
  const configKey = `${JSON.stringify(config)}|${evalBars ?? "all"}|${htfActive ? htf.klines?.length ?? "-" : "off"}`;

  const runRanking = useCallback(async (afterReload = false) => {
    const defs = listIndicators().filter((d) => inScope(d, rankScope, favorites));
    if (!defs.length || bars.length < 50) return;
    if (htf.error) { setError(`โหลดข้อมูล ${htfLabel} ไม่สำเร็จ: ${htf.error}`); return; }
    // Every indicator must be evaluated on the same window → load enough history for the longest warm-up first
    const maxWarm = Math.max(0, ...defs.map((d) => warmupOf(d, normalizeParams(d, paramsById[d.id]), tfMinutes)));
    // …and the higher-timeframe bars must cover them (a refresh mid-run would cancel the jobs)
    if (!afterReload && (htf.loading || !htfReady || (isLatest && bars.length < Math.min(MAX_BARS, limit + maxWarm)))) {
      setRankWarmup(maxWarm);
      setRankRunning(true);
      setRankPending({ since: data.loadedAt });
      return;
    }
    rankCtrl.current?.abort();
    const ctrl = new AbortController();
    rankCtrl.current = ctrl;
    setRankRunning(true);
    setRankProgress({ done: 0, total: defs.length });
    try {
      const outs = await getPool().runMany(
        defs.map((d) => ({ indicatorId: d.id, params: paramsById[d.id], config, full: false as const, evalBars })),
        (done, total) => setRankProgress({ done, total }),
        ctrl.signal,
      );
      const rows: RankRow[] = defs.map((d, i) => {
        const o = outs[i];
        const base = { id: d.id, name: d.name, category: d.category, source: sourceOf(d) };
        return o instanceof Error ? { ...base, summary: null, error: o.message } : { ...base, summary: o as RankRow["summary"] };
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
  }, [rankScope, favorites, bars, paramsById, config, configKey, setError, tfMinutes, isLatest, limit, evalBars, data.loadedAt, htfReady, htfLabel, htf.loading, htf.error]);

  // Run the ranking once the extra warm-up history has arrived (or the exchange had no more)
  useEffect(() => {
    if (!rankPending || data.loading || htf.loading) return;
    if (!htfReady) { setRankPending(null); setRankRunning(false); return; }
    const enough = !isLatest || bars.length >= Math.min(MAX_BARS, limit + rankWarmup);
    if (!enough && data.loadedAt === rankPending.since) return;
    setRankPending(null);
    void runRanking(true);
  }, [rankPending, data.loading, data.loadedAt, bars.length, limit, rankWarmup, runRanking, htf.loading, htfReady, isLatest]);

  const cancelRanking = useCallback(() => {
    rankCtrl.current?.abort();
    setRankPending(null);
    setRankRunning(false);
  }, []);
  const rankStale = !!rank && (rank.bars !== bars || rank.configKey !== configKey);

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
        barCount={evalBars ?? bars.length}
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
                <PriceChart bars={bars} indicators={chartIndicators} trades={result?.trades ?? null} showTrades={showTrades} compact={!isDesktop} evalBars={evalBars} extraOverlays={htfOverlays} extraPanes={htfPanes} />
              ) : (
                <div className="grid h-[320px] place-items-center text-xs text-muted-foreground lg:h-[460px]">
                  {data.loading ? `กำลังโหลด ${symbol} ${interval}…${data.progress ? ` ${data.progress.toLocaleString()} แท่ง` : ""}` : "ยังไม่มีข้อมูล — กดปุ่ม “ข้อมูล” ด้านบน"}
                </div>
              )}

              {/* Quick summary strip */}
              <button type="button" onClick={showResults} disabled={!result} className="flex w-full items-center gap-3 border-t px-3 py-2 text-left hover:bg-muted/40 disabled:hover:bg-transparent">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">
                    {data.loading ? "กำลังโหลดข้อมูล…" : running ? "กำลังทดสอบ…" : runError ?? "ผลทดสอบย้อนหลัง (ทบต้น)"}
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
              running={running || data.loading}
              runError={data.loading ? null : runError}
              warmup={strategyWarmup}
              evalBars={evalBars}
              onShowResults={showResults}
              htf={{
                applies: htfActive,
                chartTf: interval,
                loading: htf.loading,
                error: htf.error,
                state: trend && bars.length ? trend.regime[bars.length - 1] : null,
                since: trend && trend.sinceIdx >= 0 ? bars.time[trend.sinceIdx] : null,
              }}
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
              htfNote={htfActive ? `ตัวกรอง ${htfLabel}` : null}
              workers={ready ? getPool().size : 1}
              barCount={bars.length}
              currentId={def.id}
              onRun={() => void runRanking()}
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
        onLatest={(l) => {
          setLimit(l);
          const total = Math.min(MAX_BARS, l + neededWarmup);
          requestedRef.current = `${symbol}|${interval}|${total}`;
          loadLatest(symbol, interval, total);
        }}
        warmup={neededWarmup}
        onRange={(s, e) => loadRange(symbol, interval, s, e)}
        onCsv={data.loadCsv}
        onCancel={data.cancel}
        onDownload={() => data.downloadCsv(`${symbol}_${interval}`)}
      />
    </div>
  );
}

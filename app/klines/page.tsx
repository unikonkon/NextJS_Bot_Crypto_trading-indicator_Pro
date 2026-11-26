"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartLineUp, Faders, ListNumbers, Ranking, Plus, X, TrendUp, TrendDown, Warning, Eye, EyeSlash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { INTERVAL_MINUTES, INTERVALS, type Interval } from "@/lib/types/kline";
import { toBars } from "@/lib/engine/math";
import { detectTfMinutes, getIndicator, htfApplies, htfIndicator, htfIndicatorWarmup, htfWarmupBars, listIndicators, normalizeParams, sourceOf, warmupOf } from "@/lib/engine/registry";
import { htfTrend, normalizeHtf } from "@/lib/engine/htf";
import { getPool, AbortedError } from "@/lib/engine/worker/pool";
import { DEFAULT_CONFIG, HTF_INTERVALS, HTF_LABELS, HTF_MINUTES, type BacktestConfig, type BacktestResult, type BacktestSummary, type Bars, type HtfInterval, type IndicatorDef, type PanePlot, type Params } from "@/lib/engine/types";
import { useKlineData } from "./lib/use-kline-data";
import { useHtfSets, type HtfWant } from "./lib/use-htf-data";
import { useLocalState } from "./lib/use-local-state";
import { useMediaQuery } from "./lib/use-media";
import { fmtPct, toneClass } from "./lib/format";
import { TopBar } from "./ui/top-bar";
import { DataSheet } from "./ui/data-sheet";
import PriceChart, { type ChartIndicator } from "./ui/price-chart";
import { IndicatorPicker } from "./ui/indicator-picker";
import { StrategyPanel } from "./ui/strategy-panel";
import { ResultsPanel } from "./ui/results-panel";
import { DEFAULT_RANK_HTF, RankingPanel, inScope, type RankHtf, type RankRow, type RankScope, type RankSource } from "./ui/ranking-panel";
import { FileCompare, type CompareRow } from "./ui/file-compare";
import { fileTfMinutes, runOnFiles } from "./lib/batch";
import type { CsvFileInfo } from "@/app/api/dataShowUI/route";

type MobileTab = "chart" | "strategy" | "results" | "ranking";

/** Upper bound of bars fetched (evaluation window + warm-up) — 50 Binance requests */
const MAX_BARS = 50_000;
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
  /** CSV files picked for multi-file runs, and whether the ranking uses them */
  const [batchFiles, setBatchFiles] = useLocalState<string[]>("klines.batchFiles", []);
  const [rankSource, setRankSource] = useLocalState<RankSource>("klines.rankSource", "chart");

  // Wait one commit so persisted values are loaded before the first fetch
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // ─── UI state ─────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [sideTab, setSideTab] = useState<SideTab>("strategy");
  const [picker, setPicker] = useState<null | "strategy" | "overlay" | "filters">(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataTab, setDataTab] = useState<"latest" | "range" | "csv" | undefined>(undefined);
  const openData = useCallback((tab?: "latest" | "range" | "csv") => { setDataTab(tab); setDataOpen(true); }, []);
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

  /** Market switched to match a CSV file being loaded — that change must not refetch from Binance */
  const csvMarketRef = useRef("");

  // Reload when the market changes
  useEffect(() => {
    if (!ready) return;
    if (csvMarketRef.current === `${symbol}|${interval}`) { csvMarketRef.current = ""; return; }
    csvMarketRef.current = "";
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

  // ─── Higher-timeframe trend filter ────────────────────────
  // Single run: the filter applied from a ranking row (config.htf).
  // Ranking: a grid of filter indicators × timeframes, compared with no filter.
  const htfCfg = useMemo(() => normalizeHtf(config.htf), [config.htf]);
  const htfInd = useMemo(() => htfIndicator(htfCfg), [htfCfg]);
  // Same bar spacing the engine detects, so a CSV of another timeframe is handled correctly
  const dataTfMinutes = bars.length > 1 ? detectTfMinutes(bars) : tfMinutes;
  const htfActive = htfApplies(htfCfg, dataTfMinutes);
  const htfLabel = `${htfInd.def.name} ${HTF_LABELS[htfCfg.interval]}`;

  const [rankHtf, setRankHtf] = useLocalState<RankHtf>("klines.rankHtf", DEFAULT_RANK_HTF);
  const selectedFiles = useMemo(() => data.csvFiles.filter((f) => batchFiles.includes(f.file)), [data.csvFiles, batchFiles]);
  const filesMode = rankSource === "files";
  // Multi-file ranking: the filter timeframes must be larger than the smallest selected file's
  const minFileTf = useMemo(() => {
    const tfs = selectedFiles.map(fileTfMinutes).filter((m) => m > 0);
    return tfs.length ? Math.min(...tfs) : 0;
  }, [selectedFiles]);
  const rankTfBase = filesMode ? minFileTf : dataTfMinutes;
  const tfChoices = useMemo(() => (rankTfBase > 0 ? HTF_INTERVALS.filter((i) => HTF_MINUTES[i] > rankTfBase) : []), [rankTfBase]);
  const gridFilters = useMemo(() => (rankHtf.enabled ? rankHtf.filters.filter((id) => getIndicator(id)) : []), [rankHtf]);
  const gridTfs = useMemo(() => (rankHtf.enabled ? rankHtf.intervals.filter((i) => tfChoices.includes(i)) : []), [rankHtf, tfChoices]);
  const gridOn = gridFilters.length > 0 && gridTfs.length > 0;
  /** Timeframes the ranking asked to load (only fetched once a grid ranking is started) */
  const [rankLoad, setRankLoad] = useState<HtfInterval[]>([]);

  const htfWants = useMemo<HtfWant[]>(() => {
    const out = new Map<HtfInterval, number>();
    const add = (interval: HtfInterval, warm: number) => out.set(interval, Math.max(out.get(interval) ?? 0, warm));
    if (htfActive) add(htfCfg.interval, htfWarmupBars(htfCfg));
    for (const tf of rankLoad) {
      if (!gridTfs.includes(tf)) continue;
      for (const id of gridFilters) add(tf, htfWarmupBars({ enabled: true, interval: tf, indicator: id, params: { [id]: paramsById[id] ?? {} } }));
    }
    return [...out].map(([interval, warmBars]) => ({ interval, warmBars }));
  }, [htfActive, htfCfg, rankLoad, gridTfs, gridFilters, paramsById]);

  const csvSymbol = data.source?.kind === "csv" ? /^([A-Z0-9]{5,})_/.exec(data.source.file)?.[1] : undefined;
  const htf = useHtfSets({
    symbol: csvSymbol ?? symbol,
    wants: htfWants,
    firstTime: bars.length ? bars.time[0] : null,
    lastTime: bars.length ? bars.time[bars.length - 1] : null,
    ltfMinutes: dataTfMinutes,
  });
  const htfKlines = htfActive ? htf.sets[htfCfg.interval] ?? null : null;
  const htfError = htf.error ? `โหลดข้อมูล ${HTF_LABELS[htf.error.interval]} ไม่สำเร็จ: ${htf.error.message}` : null;
  const htfReady = !htfActive || !!htfKlines;
  const htfBars = useMemo(() => (htfKlines ? toBars(htfKlines) : null), [htfKlines]);
  const trend = useMemo(
    () => (htfActive && htfBars && bars.length
      ? htfTrend(bars, htfBars, htfInd.def, htfInd.params, htfCfg.interval, dataTfMinutes, {
          overlays: true, warmup: htfIndicatorWarmup(htfInd.def, htfInd.params, htfCfg.interval),
        })
      : null),
    [htfActive, htfBars, bars, htfInd, htfCfg.interval, dataTfMinutes],
  );
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
    getPool().setHtf(htf.sets);
  }, [htf.sets]);

  useEffect(() => {
    if (bars.length === 0) { setRunning(false); return; }
    if (!htfReady) {
      // waiting for the higher-timeframe bars (or they failed to load)
      setRunning(!htfError);
      setRunError(htfError);
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
  }, [bars, def, params, config, evalBars, htfReady, htf.sets, htfError]);

  // A result only belongs to the bars it was computed on
  const result = single && single.bars === bars ? single.result : null;

  // ─── Ranking (many indicators in parallel, same evaluation window) ──
  const [rank, setRank] = useState<{ rows: RankRow[]; bars: Bars; configKey: string; grid: boolean; files: boolean } | null>(null);
  const [rankStage, setRankStage] = useState<string | null>(null);
  const [rankRunning, setRankRunning] = useState(false);
  const [rankProgress, setRankProgress] = useState<{ done: number; total: number } | null>(null);
  const [rankPending, setRankPending] = useState<{ since: Date | null } | null>(null);
  const rankCtrl = useRef<AbortController | null>(null);
  const rankDefs = useMemo(() => listIndicators().filter((d) => inScope(d, rankScope, favorites)), [rankScope, favorites]);
  const rankRuns = filesMode
    ? selectedFiles.reduce((n, f) => {
        const tf = fileTfMinutes(f);
        const tfs = gridOn && tf > 0 ? gridTfs.filter((t) => HTF_MINUTES[t] > tf).length : 0;
        return n + rankDefs.length * (gridFilters.length * tfs + 1);
      }, 0)
    : rankDefs.length * (gridOn ? gridFilters.length * gridTfs.length + 1 : 1);
  const filesKey = selectedFiles.map((f) => `${f.file}:${f.size}:${f.to}`).join(",");
  // The ranking itself never uses the single-run filter: it is either unfiltered or the grid
  const rankConfig = useMemo<BacktestConfig>(() => ({ ...config, htf: { ...htfCfg, enabled: false } }), [config, htfCfg]);
  const configKey = `${JSON.stringify(rankConfig)}|${filesMode ? `files=${filesKey}` : evalBars ?? "all"}|${gridOn ? `${gridFilters.join(",")}@${gridTfs.join(",")}` : "nogrid"}`;
  const gridLoaded = gridTfs.every((tf) => !!htf.sets[tf]);

  /** Ranking over the selected CSV files (own worker pool, one file at a time) */
  const runFilesRanking = useCallback(async () => {
    const defs = rankDefs;
    const files = selectedFiles;
    if (!defs.length || !files.length) return;
    rankCtrl.current?.abort();
    const ctrl = new AbortController();
    rankCtrl.current = ctrl;
    setRankRunning(true);
    setRankProgress(null);
    setRankStage("กำลังเตรียมไฟล์…");
    type Meta = { def: IndicatorDef; filter: RankRow["filter"] };
    try {
      const res = await runOnFiles<Meta>({
        files,
        fallbackSymbol: symbol,
        signal: ctrl.signal,
        onProgress: (done, total, stage) => { setRankProgress({ done, total }); setRankStage(stage); },
        jobsFor: (_file, tf) => {
          const jobs = [];
          for (const d of defs) {
            jobs.push({ job: { indicatorId: d.id, params: paramsById[d.id], config: rankConfig, full: false }, meta: { def: d, filter: null } });
            if (!gridOn || tf <= 0) continue;
            for (const id of gridFilters) for (const t of gridTfs) {
              if (HTF_MINUTES[t] <= tf) continue; // the filter must be a larger timeframe than the file
              jobs.push({
                job: { indicatorId: d.id, params: paramsById[d.id], config: { ...rankConfig, htf: { enabled: true, interval: t, indicator: id, params: { [id]: paramsById[id] ?? {} } } }, full: false },
                meta: { def: d, filter: { indicator: id, interval: t } },
              });
            }
          }
          return jobs;
        },
      });
      const rows: RankRow[] = res.map(({ file, meta: { def: d, filter }, out }) => {
        const base = { id: d.id, name: d.name, category: d.category, source: sourceOf(d), filter, file: file.file };
        return out instanceof Error ? { ...base, summary: null, error: out.message } : { ...base, summary: out as BacktestSummary };
      });
      setRank({ rows, bars, configKey, grid: gridOn, files: true });
    } catch (err) {
      if (!(err instanceof AbortedError)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (rankCtrl.current === ctrl) {
        setRankRunning(false);
        setRankProgress(null);
        setRankStage(null);
        rankCtrl.current = null;
      }
    }
  }, [rankDefs, selectedFiles, symbol, paramsById, rankConfig, gridOn, gridFilters, gridTfs, bars, configKey, setError]);

  const runRanking = useCallback(async (afterReload = false) => {
    const defs = rankDefs;
    if (filesMode) { await runFilesRanking(); return; }
    if (!defs.length || bars.length < 50) return;
    // Every indicator must be evaluated on the same window → load enough history for the longest warm-up first
    const maxWarm = Math.max(0, ...defs.map((d) => warmupOf(d, normalizeParams(d, paramsById[d.id]), tfMinutes)));
    // …and the grid's higher-timeframe bars must be loaded (a refresh mid-run would cancel the jobs)
    if (gridOn) setRankLoad(gridTfs);
    if (!afterReload && ((gridOn && (!gridLoaded || htf.loading)) || (isLatest && bars.length < Math.min(MAX_BARS, limit + maxWarm)))) {
      setRankWarmup(maxWarm);
      setRankRunning(true);
      setRankPending({ since: data.loadedAt });
      return;
    }
    if (gridOn && !gridLoaded) { setError(htfError ?? "โหลดข้อมูล timeframe ใหญ่ไม่ครบ"); setRankRunning(false); return; }

    type Combo = { def: IndicatorDef; filter: RankRow["filter"] };
    const combos: Combo[] = [];
    for (const d of defs) {
      combos.push({ def: d, filter: null });
      if (gridOn) for (const id of gridFilters) for (const tf of gridTfs) combos.push({ def: d, filter: { indicator: id, interval: tf } });
    }
    rankCtrl.current?.abort();
    const ctrl = new AbortController();
    rankCtrl.current = ctrl;
    setRankRunning(true);
    setRankProgress({ done: 0, total: combos.length });
    try {
      const outs = await getPool().runMany(
        combos.map(({ def: d, filter }) => ({
          indicatorId: d.id,
          params: paramsById[d.id],
          config: filter
            ? { ...rankConfig, htf: { enabled: true, interval: filter.interval, indicator: filter.indicator, params: { [filter.indicator]: paramsById[filter.indicator] ?? {} } } }
            : rankConfig,
          full: false as const,
          evalBars,
        })),
        (done, total) => setRankProgress({ done, total }),
        ctrl.signal,
      );
      const rows: RankRow[] = combos.map(({ def: d, filter }, i) => {
        const o = outs[i];
        const base = { id: d.id, name: d.name, category: d.category, source: sourceOf(d), filter };
        return o instanceof Error ? { ...base, summary: null, error: o.message } : { ...base, summary: o as RankRow["summary"] };
      });
      setRank({ rows, bars, configKey, grid: gridOn, files: false });
    } catch (err) {
      if (!(err instanceof AbortedError)) setError(String(err));
    } finally {
      if (rankCtrl.current === ctrl) {
        setRankRunning(false);
        setRankProgress(null);
        rankCtrl.current = null;
      }
    }
  }, [rankDefs, bars, paramsById, rankConfig, configKey, setError, tfMinutes, isLatest, limit, evalBars, data.loadedAt,
    gridOn, gridFilters, gridTfs, gridLoaded, htf.loading, htfError, filesMode, runFilesRanking]);

  // Run the ranking once the extra history (chart warm-up and grid timeframes) has arrived
  useEffect(() => {
    if (!rankPending || data.loading || htf.loading) return;
    if (gridOn && !gridLoaded) {
      if (htfError) { setError(htfError); setRankPending(null); setRankRunning(false); }
      return;
    }
    const enough = !isLatest || bars.length >= Math.min(MAX_BARS, limit + rankWarmup);
    if (!enough && data.loadedAt === rankPending.since) return;
    setRankPending(null);
    void runRanking(true);
  }, [rankPending, data.loading, data.loadedAt, bars.length, limit, rankWarmup, runRanking, htf.loading, gridOn, gridLoaded, htfError, isLatest, setError]);

  const cancelRanking = useCallback(() => {
    rankCtrl.current?.abort();
    setRankPending(null);
    setRankRunning(false);
  }, []);
  const rankStale = !!rank && (rank.configKey !== configKey || (!rank.files && rank.bars !== bars));

  // ─── Current strategy on every selected file (strategy tab) ──
  const [compare, setCompare] = useState<{ rows: CompareRow[]; key: string } | null>(null);
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareProgress, setCompareProgress] = useState<{ done: number; total: number; stage: string } | null>(null);
  const compareCtrl = useRef<AbortController | null>(null);
  const compareKey = `${def.id}|${JSON.stringify(params)}|${JSON.stringify(config)}|${filesKey}`;

  const runCompare = useCallback(async () => {
    const files = selectedFiles;
    if (!files.length) return;
    compareCtrl.current?.abort();
    const ctrl = new AbortController();
    compareCtrl.current = ctrl;
    setCompareRunning(true);
    setCompareProgress(null);
    try {
      const res = await runOnFiles({
        files,
        fallbackSymbol: symbol,
        signal: ctrl.signal,
        onProgress: (done, total, stage) => setCompareProgress({ done, total, stage }),
        jobsFor: () => [{ job: { indicatorId: def.id, params, config, full: false }, meta: null }],
      });
      setCompare({
        key: compareKey,
        rows: res.map(({ file, out }) => (out instanceof Error ? { file, summary: null, error: out.message } : { file, summary: out as BacktestSummary })),
      });
    } catch (err) {
      if (!(err instanceof AbortedError)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (compareCtrl.current === ctrl) {
        setCompareRunning(false);
        setCompareProgress(null);
        compareCtrl.current = null;
      }
    }
  }, [selectedFiles, symbol, def, params, config, compareKey, setError]);
  const cancelCompare = useCallback(() => compareCtrl.current?.abort(), []);

  // Started from the data sheet: run once the new selection / source is in state
  const [autoRun, setAutoRun] = useState<null | "rank" | "compare">(null);
  useEffect(() => {
    if (autoRun === "rank" && filesMode && !rankRunning) { setAutoRun(null); void runRanking(); }
    else if (autoRun === "compare" && !compareRunning) { setAutoRun(null); void runCompare(); }
  }, [autoRun, filesMode, rankRunning, compareRunning, runRanking, runCompare]);

  // ─── Navigation helpers ───────────────────────────────────
  const showResults = useCallback(() => {
    if (isDesktop) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else setMobileTab("results");
  }, [isDesktop]);

  /** Put a CSV file on the chart, following its pair / timeframe without refetching from Binance */
  const { loadCsv } = data;
  const activeFile = data.source?.kind === "csv" ? data.source.file : null;
  const loadFileToChart = useCallback((f: CsvFileInfo) => {
    const sym = f.symbol ?? symbol;
    const tf = f.interval && (INTERVALS as readonly string[]).includes(f.interval) ? (f.interval as Interval) : interval;
    if (sym !== symbol || tf !== interval) {
      csvMarketRef.current = `${sym}|${tf}`;
      setSymbol(sym);
      setInterval(tf);
    }
    loadCsv(f.file);
  }, [symbol, interval, setSymbol, setInterval, loadCsv]);

  /** Use a ranking row on the chart: its strategy and its filter (or no filter) */
  const applyFromRanking = useCallback((row: RankRow) => {
    if (row.file && row.file !== activeFile) {
      const f = data.csvFiles.find((x) => x.file === row.file);
      if (f) loadFileToChart(f);
    }
    setStrategyId(row.id);
    setConfig((c) => {
      const h = normalizeHtf(c.htf);
      const f = row.filter;
      return {
        ...c,
        htf: f
          ? { ...h, enabled: true, indicator: f.indicator, interval: f.interval, params: { ...h.params, [f.indicator]: paramsById[f.indicator] ?? {} } }
          : { ...h, enabled: false },
      };
    });
    if (!isDesktop) setMobileTab("chart");
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }, [isDesktop, setStrategyId, setConfig, paramsById, activeFile, data.csvFiles, loadFileToChart]);

  /** Apply only a filter (from the per-filter summary) to the current strategy */
  const applyFilter = useCallback((f: NonNullable<RankRow["filter"]> | null) => {
    applyFromRanking({ id: def.id, name: def.name, category: def.category, source: sourceOf(def), summary: null, filter: f });
  }, [applyFromRanking, def]);

  const goRanking = useCallback(() => {
    setSideTab("ranking");
    setMobileTab("ranking");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
        onOpenData={() => openData()}
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
                enabled: htfCfg.enabled,
                label: htfLabel,
                applies: htfActive,
                chartTf: interval,
                loading: htfActive && htf.loading === htfCfg.interval,
                error: htfActive ? htfError : null,
                state: trend && bars.length ? trend.regime[bars.length - 1] : null,
                since: trend && trend.sinceIdx >= 0 ? bars.time[trend.sinceIdx] : null,
              }}
              onClearHtf={() => setConfig((c) => ({ ...c, htf: { ...normalizeHtf(c.htf), enabled: false } }))}
              onFindHtf={goRanking}
            />
            <FileCompare
              strategyName={def.name}
              files={selectedFiles}
              allFiles={data.csvFiles}
              rows={compare?.rows ?? null}
              running={compareRunning}
              progress={compareProgress}
              stale={!!compare && compare.key !== compareKey}
              activeFile={activeFile}
              onRun={() => void runCompare()}
              onCancel={cancelCompare}
              onPickFiles={() => openData("csv")}
              onLoadFile={loadFileToChart}
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
              applied={htfCfg.enabled ? { indicator: htfCfg.indicator, interval: htfCfg.interval } : null}
              grid={rank?.grid ?? false}
              rankHtf={rankHtf}
              onRankHtf={setRankHtf}
              tfChoices={tfChoices}
              chartTf={filesMode ? selectedFiles.find((f) => fileTfMinutes(f) === minFileTf)?.interval ?? "—" : interval}
              runs={rankRuns}
              strategies={rankDefs.length}
              htfLoading={rankRunning && rankPending ? htf.loading : null}
              onPickFilters={() => setPicker("filters")}
              onRun={() => void runRanking()}
              onCancel={cancelRanking}
              onApply={applyFromRanking}
              onApplyFilter={applyFilter}
              source={rankSource}
              onSource={setRankSource}
              files={selectedFiles}
              allFiles={data.csvFiles}
              onPickFiles={() => openData("csv")}
              stage={rankStage}
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
      <IndicatorPicker
        open={picker === "filters"}
        onClose={() => setPicker(null)}
        title="Indicator ที่ใช้เป็นตัวกรองเทรนด์ใหญ่"
        description="เลือกได้หลายตัว — แต่ละตัวจะรันบนทุก timeframe ที่เลือก · ใช้พารามิเตอร์ที่ตั้งไว้ในแท็บกลยุทธ์"
        selected={rankHtf.filters}
        multi
        onPick={(id) => setRankHtf((prev) => ({ ...prev, filters: prev.filters.includes(id) ? prev.filters.filter((x) => x !== id) : [...prev.filters, id] }))}
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
        firstPrice={bars.length ? bars.open[0] : null}
        lastPrice={bars.length ? bars.close[bars.length - 1] : null}
        maxBars={MAX_BARS}
        initialTab={dataTab}
        selected={batchFiles}
        onSelect={setBatchFiles}
        onRankFiles={() => { setRankSource("files"); goRanking(); setAutoRun("rank"); }}
        onCompareFiles={() => { setSideTab("strategy"); setMobileTab("strategy"); setAutoRun("compare"); }}
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
        onCsv={loadFileToChart}
        onCancel={data.cancel}
        onDownload={() => data.downloadCsv(`${symbol}_${interval}`)}
      />
    </div>
  );
}

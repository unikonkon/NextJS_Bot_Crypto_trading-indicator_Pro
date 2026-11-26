"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CheckSquare, CircleNotch, ClockCounterClockwise, MagnifyingGlass, Play, X } from "@phosphor-icons/react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SymbolRow } from "@/app/api/symbols/route";
import { ALL_CATEGORY, SYMBOL_CATEGORIES, STABLE_BASES, categoriesOf } from "../lib/symbols";
import { useLocalState } from "../lib/use-local-state";
import { fmtNum, fmtPct, toneClass } from "../lib/format";

// One request per page load, shared by every open of the sheet
let livePromise: Promise<SymbolRow[]> | null = null;
function loadLive(): Promise<SymbolRow[]> {
  livePromise ??= fetch("/api/symbols")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j: { symbols: SymbolRow[] }) => j.symbols)
    .catch((err) => {
      livePromise = null; // let the next open retry
      throw err;
    });
  return livePromise;
}

const QUOTES = /(USDT|USDC|FDUSD|BTC|ETH|BNB)$/;
/** "PEPE" → "PEPEUSDT"; a full pair such as "ETHBTC" is kept as typed */
function toPair(q: string): string {
  return q.length >= 6 && QUOTES.test(q) ? q : `${q}USDT`;
}
const baseOf = (pair: string) => pair.replace(/USDT$/, "");

const MAX_RECENT = 8;
/** Most coins a multi-coin test takes (each is downloaded from Binance) */
export const MAX_MULTI = 100;
const MAX_RESULTS = 60;

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  onPick: (pair: string) => void;
  /** Coins picked for the multi-coin test (pairs) */
  selected: string[];
  onSelected: (pairs: string[]) => void;
  /** Open straight in multi-select mode */
  startMulti?: boolean;
  /** Run the current strategy on the selected coins */
  onTest: () => void;
  /** Bars downloaded per coin (for the time estimate) */
  barsPerCoin: number;
}

export function SymbolPicker({ open, onClose, symbol, onPick, selected, onSelected, startMulti, onTest, barsPerCoin }: Props) {
  const [query, setQuery] = useState("");
  const [multi, setMulti] = useState(!!startMulti);
  // Focus the search box only with a mouse: on touch screens the keyboard would cover the coin list
  const [focusSearch] = useState(() => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  const selSet = useMemo(() => new Set(selected), [selected]);
  const [cat, setCat] = useLocalState("klines.symbolCat", "popular");
  const [recent, setRecent] = useLocalState<string[]>("klines.recentSymbols", []);
  const [live, setLive] = useState<SymbolRow[] | null>(null);
  const [liveError, setLiveError] = useState(false);

  useEffect(() => {
    if (!open || live) return;
    let alive = true;
    loadLive()
      .then((rows) => { if (alive) { setLive(rows); setLiveError(false); } })
      .catch(() => { if (alive) setLiveError(true); });
    return () => { alive = false; };
  }, [open, live]);

  const byBase = useMemo(() => new Map((live ?? []).map((r) => [r.b, r])), [live]);
  /** Rank by 24h volume (unknown → keep the curated order at the end) */
  const rank = useMemo(() => {
    const m = new Map<string, number>();
    (live ?? []).forEach((r, i) => m.set(r.b, i));
    return m;
  }, [live]);

  const curatedAll = useMemo(() => [...new Set(SYMBOL_CATEGORIES.flatMap((c) => c.coins))], []);
  const allCoins = useMemo(
    () => (live ? live.map((r) => r.b) : curatedAll).filter((b) => !STABLE_BASES.has(b)),
    [live, curatedAll],
  );

  const sortByVolume = (coins: string[]) =>
    live ? [...coins].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)) : coins;

  const categories = useMemo(() => {
    // Hide coins Binance no longer lists once the live list is known
    const avail = (b: string) => !live || byBase.has(b);
    return [
      ...(multi && selected.length
        ? [{ id: "selected", label: "✓ ที่เลือก", hint: "เหรียญที่จะใช้ทดสอบ", coins: selected.map(baseOf) }]
        : []),
      ...SYMBOL_CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint, coins: c.coins.filter(avail) })),
      { id: ALL_CATEGORY, label: "ทั้งหมด", hint: live ? "ทุกคู่ USDT ที่เปิดเทรดบน Binance" : "รายการที่บันทึกไว้ (โหลดรายการสดไม่ได้)", coins: allCoins },
    ];
  }, [live, byBase, allCoins, multi, selected]);

  const active = categories.find((c) => c.id === cat) ?? categories[0];
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9一-鿿]/g, "");
  const qBase = baseOf(q);

  // Search covers every coin, not only the selected category
  const results = useMemo(() => {
    if (!qBase) return null;
    const pool = [...new Set([...allCoins, ...curatedAll])];
    const score = (b: string) => (b === qBase ? 0 : b.startsWith(qBase) ? 1 : 2);
    return pool
      .filter((b) => b.includes(qBase))
      .sort((a, b) => score(a) - score(b) || (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))
      .slice(0, MAX_RESULTS);
  }, [qBase, allCoins, curatedAll, rank]);

  // "selected" keeps the order the coins were picked in
  const coins = results ?? (active.id === "selected" ? active.coins : sortByVolume(active.coins));
  const pairOf = (b: string) => (active.id === "selected" && !results ? selected.find((p) => baseOf(p) === b) ?? `${b}USDT` : `${b}USDT`);

  const toggle = (pair: string) => {
    if (selSet.has(pair)) onSelected(selected.filter((p) => p !== pair));
    else if (selected.length < MAX_MULTI) onSelected([...selected, pair]);
  };
  const catPairs = active.coins.map((b) => `${b}USDT`);
  const catAllOn = catPairs.length > 0 && catPairs.every((p) => selSet.has(p));
  const selectCategory = () => {
    if (catAllOn) { onSelected(selected.filter((p) => !catPairs.includes(p))); return; }
    const add = sortByVolume(active.coins).map((b) => `${b}USDT`).filter((p) => !selSet.has(p));
    onSelected([...selected, ...add].slice(0, MAX_MULTI));
  };
  const etaSec = Math.ceil(selected.length * Math.ceil(barsPerCoin / 1000) * 0.15);

  const pick = (pair: string) => {
    if (multi) { toggle(pair); return; }
    onPick(pair);
    setRecent((prev) => [pair, ...prev.filter((p) => p !== pair)].slice(0, MAX_RECENT));
    setQuery("");
    onClose();
  };

  const submit = () => {
    if (!q) return;
    // A typed coin that is in the list → its USDT pair; otherwise load what was typed
    pick(results?.[0] === qBase ? `${qBase}USDT` : toPair(q));
    if (multi) setQuery("");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="เลือกคู่เหรียญ"
      description={multi ? "เลือกหลายเหรียญเพื่อทดสอบกลยุทธ์พร้อมกัน · แตะเพื่อเลือก/เอาออก" : "เลือกตามประเภท หรือพิมพ์ชื่อเหรียญ Binance (เช่น PEPE)"}
      footer={multi ? (
        <div className="space-y-2">
          <p className={cn("text-[10px] tabular-nums", selected.length >= MAX_MULTI ? "text-warn" : "text-muted-foreground")}>
            เลือก {selected.length}{selected.length >= MAX_MULTI ? ` (สูงสุด ${MAX_MULTI})` : ""} เหรียญ
            {selected.length > 0 && ` · ${barsPerCoin.toLocaleString()} แท่งต่อเหรียญ · ประมาณ ${etaSec < 60 ? `${Math.max(1, etaSec)} วินาที` : `${Math.ceil(etaSec / 60)} นาที`}`}
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <Button size="lg" disabled={selected.length === 0} onClick={() => { onTest(); onClose(); }}>
              <Play size={13} weight="fill" /> ทดสอบกลยุทธ์ {selected.length || ""} เหรียญ
            </Button>
            <Button size="lg" variant="outline" onClick={onClose}>เสร็จ</Button>
          </div>
        </div>
      ) : undefined}
    >
      {/* Search + categories stay on top while the list scrolls */}
      <div className="sticky top-0 z-10 space-y-2.5 border-b bg-background p-4 pb-3">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`ค้นหาจาก ${allCoins.length.toLocaleString()} เหรียญ`}
              className="h-10 pl-8 pr-8 uppercase"
              autoFocus={focusSearch}
              autoCapitalize="characters"
              aria-label="ค้นหาเหรียญ"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground" aria-label="ล้างคำค้น">
                <X size={14} />
              </button>
            )}
          </div>
          <Button type="submit" size="lg" className="h-10" disabled={!q}>{multi ? "เพิ่ม" : "ใช้"}</Button>
        </form>

        <div className="flex items-center gap-2">
          <button type="button" role="switch" aria-checked={multi} onClick={() => { setMulti((m) => !m); if (cat === "selected") setCat("popular"); }}
            className="flex items-center gap-2 text-[11px] font-medium">
            <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", multi ? "bg-primary" : "bg-muted-foreground/30")}>
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-background shadow transition-all", multi ? "left-[18px]" : "left-0.5")} />
            </span>
            เลือกหลายเหรียญ
          </button>
          <span className="text-[10px] text-muted-foreground">
            {multi ? "สำหรับทดสอบกลยุทธ์พร้อมกัน" : "ปิด = แตะเพื่อเปิดบนกราฟ"}
          </span>
          {selected.length > 0 && (
            <button type="button" onClick={() => { setMulti(true); setCat("selected"); setQuery(""); }}
              className="ml-auto h-6 shrink-0 bg-primary/15 px-2 text-[10px] font-semibold tabular-nums text-primary">
              ✓ {selected.length}
            </button>
          )}
        </div>

        {!results && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="ประเภทเหรียญ">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === active.id}
                onClick={() => setCat(c.id)}
                className={cn(
                  "h-7 shrink-0 border px-2 text-[11px] font-medium transition-colors",
                  c.id === active.id ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.label}
                <span className="ml-1 tabular-nums opacity-60">{c.coins.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 p-4 pt-3">
        {!results && recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <ClockCounterClockwise size={13} className="mr-0.5 text-muted-foreground" aria-label="ล่าสุด" />
            {recent.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pick(p)}
                className={cn("h-7 border px-2 text-[11px] font-medium", (multi ? selSet.has(p) : p === symbol) ? "border-primary text-primary" : "hover:bg-muted")}
              >
                {p.endsWith("USDT") ? baseOf(p) : p}
              </button>
            ))}
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {results ? (
            <span>พบ {results.length}{results.length === MAX_RESULTS ? "+" : ""} เหรียญ · กด Enter เพื่อ{multi ? "เพิ่ม" : "ใช้"} {results[0] === qBase ? `${qBase}USDT` : toPair(q)}</span>
          ) : (
            <span>
              <span className="font-medium text-foreground">{active.label}</span>
              {active.hint && <> · {active.hint}</>}
              {live && " · เรียงตามวอลุ่ม 24 ชม."}
            </span>
          )}
          {multi && !results && active.coins.length > 0 && (
            <button type="button" onClick={selectCategory}
              className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 border px-2 text-[10px] font-medium text-foreground hover:bg-muted">
              <CheckSquare size={12} /> {catAllOn ? "เอาออกทั้งหมวด" : `เลือกทั้งหมวด (${Math.min(active.coins.length, MAX_MULTI)})`}
            </button>
          )}
          {multi && selected.length > 0 && !results && (
            <button type="button" onClick={() => onSelected([])} className="h-7 shrink-0 border px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground">ล้าง</button>
          )}
          {!live && !liveError && <CircleNotch size={12} className="ml-auto shrink-0 animate-spin" aria-label="กำลังโหลดรายการจาก Binance" />}
        </p>
        {liveError && <p className="text-[11px] text-warn">โหลดรายการสดจาก Binance ไม่ได้ — แสดงรายการที่บันทึกไว้</p>}

        <div className="grid grid-cols-3 gap-1.5">
          {coins.map((b) => {
            const pair = pairOf(b);
            const row = byBase.get(b);
            const checked = multi && selSet.has(pair);
            const on = !multi && pair === symbol;
            return (
              <button
                key={pair}
                type="button"
                aria-pressed={multi ? checked : undefined}
                onClick={() => pick(pair)}
                title={[pair, row && `วอลุ่ม 24 ชม. ${fmtNum(row.v)} USDT`, results && categoriesOf(b).join(" · ")].filter(Boolean).join("\n")}
                className={cn(
                  "relative flex h-12 min-w-0 flex-col items-center justify-center border px-1 transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : checked ? "border-primary bg-primary/10" : "hover:bg-muted",
                )}
              >
                {checked && <Check size={11} weight="bold" className="absolute right-1 top-1 text-primary" />}
                <span className="max-w-full truncate text-xs font-semibold">
                  {pair.endsWith("USDT") ? <>{b}<span className="font-normal opacity-50">/USDT</span></> : pair}
                </span>
                {row ? (
                  <span className={cn("text-[10px] tabular-nums", on ? "opacity-80" : toneClass(row.c))}>{fmtPct(row.c)}</span>
                ) : results ? (
                  <span className="max-w-full truncate text-[10px] opacity-60">{categoriesOf(b)[0] ?? ""}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {results?.length === 0 && (
          <p className="py-4 text-center text-[11px] text-muted-foreground">ไม่พบในรายการ · กด “ใช้” เพื่อลองโหลด {toPair(q)}</p>
        )}
      </div>
    </Sheet>
  );
}

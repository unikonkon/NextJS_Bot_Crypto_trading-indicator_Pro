"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowsLeftRight, ClockCounterClockwise, LinkBreak, LinkSimple, Robot, Wallet } from "@phosphor-icons/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { PRESETS_KEY, loadPresets, removePreset, type BotPreset } from "@/lib/trading/presets";
import { ApiError, api, hintFor, type Balance, type Creds } from "./lib/api";
import { useBot } from "./lib/use-bot";
import { ConnectPanel } from "./ui/connect-panel";
import { BotPanel } from "./ui/bot-panel";
import { WalletPanel } from "./ui/wallet-panel";
import { ManualOrder } from "./ui/manual-order";
import { OrdersPanel } from "./ui/orders-panel";
import { Notice } from "./ui/parts";

type Tab = "connect" | "bot" | "manual" | "wallet" | "orders";

const TABS: { id: Tab; label: string; icon: typeof Robot; needsKey: boolean }[] = [
  { id: "bot", label: "บอทอัตโนมัติ", icon: Robot, needsKey: false },
  { id: "manual", label: "ซื้อขายเอง", icon: ArrowsLeftRight, needsKey: true },
  { id: "wallet", label: "กระเป๋า", icon: Wallet, needsKey: true },
  { id: "orders", label: "คำสั่ง & ประวัติ", icon: ClockCounterClockwise, needsKey: true },
];

export default function BinanceTradingPage() {
  // ─── Connection (keys in memory only) ─────────────────────
  const [creds, setCreds] = useState<Creds | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Strategy presets from /klines ────────────────────────
  const [presets, setPresets] = useState<BotPreset[]>([]);
  const [tab, setTab] = useState<Tab>("bot");

  const bot = useBot({ creds, presets });
  const { setSettings, loaded: botLoaded } = bot;

  useEffect(() => {
    setPresets(loadPresets());
    // Presets sent from a /klines tab that is open at the same time
    const onStorage = (e: StorageEvent) => { if (e.key === PRESETS_KEY) setPresets(loadPresets()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // /trading/Binance?preset=<id> — opened from the "send to bot" button
  useEffect(() => {
    if (!botLoaded || bot.running) return;
    const id = new URLSearchParams(window.location.search).get("preset");
    if (id && presets.some((p) => p.id === id)) {
      setSettings({ presetId: id });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [botLoaded, presets, setSettings, bot.running]);

  const connect = useCallback(async (apiKey: string, secretKey: string) => {
    setConnecting(true);
    setConnectError(null);
    try {
      const c = { apiKey, secretKey };
      const acc = await api.spotAccount(c);
      setCreds(c);
      setBalances(acc.balances ?? []);
      setPermissions(acc.permissions ?? []);
      setTab("bot");
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err));
      const hint = hintFor(e.code);
      setConnectError(hint ? `${hint} (${e.message})` : e.message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!creds) return;
    setRefreshing(true);
    try {
      const acc = await api.spotAccount(creds);
      setBalances(acc.balances ?? []);
    } catch {
      /* keep the last balances */
    } finally {
      setRefreshing(false);
    }
  }, [creds]);

  const disconnect = () => {
    if (bot.running) bot.stop("หยุดบอทเพราะยกเลิกการเชื่อมต่อ");
    setCreds(null);
    setBalances([]);
    setPermissions([]);
    setTab("bot");
  };

  const onRemovePreset = (id: string) => {
    setPresets(removePreset(id));
    if (bot.settings.presetId === id) setSettings({ presetId: null });
  };

  const connected = !!creds;
  const activeTab: Tab = !connected && TABS.find((t) => t.id === tab)?.needsKey ? "connect" : tab;
  const usdt = parseFloat(balances.find((b) => b.asset === "USDT")?.free ?? "0");

  return (
    <div className="min-h-dvh bg-background">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <Link href="/klines" className="flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft size={13} /> Backtest
          </Link>
          <h1 className="text-sm font-semibold">Binance Trading</h1>
          {bot.running && (
            <button type="button" onClick={() => setTab("bot")}
              className={cn("flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold", bot.settings.test ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "bg-red-500 text-white")}>
              <span className="size-1.5 animate-pulse rounded-full bg-current" /> บอททำงาน{bot.settings.test ? " (ทดสอบ)" : " (เงินจริง)"}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {connected ? (
              <>
                <span className="hidden items-center gap-1.5 text-[11px] sm:flex">
                  <span className="size-2 rounded-full bg-emerald-500" /> เชื่อมต่อแล้ว
                  <span className="tabular-nums text-muted-foreground">· {usdt.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT</span>
                </span>
                <button type="button" onClick={disconnect} className="flex h-8 items-center gap-1 border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                  <LinkBreak size={13} /> ยกเลิกการเชื่อมต่อ
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setTab("connect")}
                className="flex h-8 items-center gap-1 bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90">
                <LinkSimple size={13} weight="bold" /> เชื่อมต่อ Binance
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>

        {/* Tabs */}
        <nav className="mx-auto flex max-w-6xl overflow-x-auto px-2 [scrollbar-width:none]">
          {!connected && (
            <TabButton active={activeTab === "connect"} onClick={() => setTab("connect")} icon={LinkSimple} label="เชื่อมต่อ" />
          )}
          {TABS.map((t) => (
            <TabButton key={t.id} active={activeTab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label}
              dim={t.needsKey && !connected} />
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {activeTab === "connect" && (
          <div className="space-y-4">
            {TABS.find((t) => t.id === tab)?.needsKey && (
              <Notice tone="info" className="mx-auto max-w-4xl">หน้านี้ต้องเชื่อมต่อ API Key ก่อน</Notice>
            )}
            <ConnectPanel onConnect={(k, s) => void connect(k, s)} connecting={connecting} error={connectError} />
          </div>
        )}
        {activeTab === "bot" && (
          <BotPanel bot={bot} presets={presets} onRemovePreset={onRemovePreset} connected={connected} onGoConnect={() => setTab("connect")} />
        )}
        {creds && activeTab === "manual" && <ManualOrder creds={creds} balances={balances} onDone={() => void refreshBalances()} />}
        {creds && activeTab === "wallet" && (
          <WalletPanel creds={creds} balances={balances} permissions={permissions} onRefresh={() => void refreshBalances()} refreshing={refreshing} />
        )}
        {creds && activeTab === "orders" && <OrdersPanel creds={creds} defaultSymbol={bot.preset?.symbol ?? "BTCUSDT"} />}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, dim }: {
  active: boolean; onClick: () => void; icon: typeof Robot; label: string; dim?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-medium transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
        dim && !active && "opacity-60",
      )}>
      <Icon size={14} weight={active ? "fill" : "regular"} /> {label}
    </button>
  );
}

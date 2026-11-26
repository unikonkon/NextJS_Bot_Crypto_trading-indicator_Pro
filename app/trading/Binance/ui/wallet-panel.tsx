"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, CircleNotch, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toneClass } from "@/app/klines/lib/format";
import { api, hintFor, ApiError, type Balance, type Creds, type FuturesAccount } from "../lib/api";
import { Empty, Notice, Section, Stat, fmtQty, fmtUsd } from "./parts";

export function WalletPanel({ creds, balances, permissions, onRefresh, refreshing }: {
  creds: Creds;
  balances: Balance[];
  permissions: string[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [hideSmall, setHideSmall] = useState(true);
  const [futures, setFutures] = useState<FuturesAccount | null>(null);
  const [futErr, setFutErr] = useState<string | null>(null);
  const [futLoading, setFutLoading] = useState(false);

  const assetsKey = balances.map((b) => b.asset).join(",");
  useEffect(() => {
    if (!assetsKey) return;
    let cancelled = false;
    api.prices(assetsKey.split(",")).then((p) => { if (!cancelled) setPrices(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [assetsKey]);

  const loadFutures = useCallback(async () => {
    setFutLoading(true);
    setFutErr(null);
    try {
      setFutures(await api.futuresAccount(creds));
    } catch (err) {
      const e = err instanceof ApiError ? hintFor(err.code) || err.message : String(err);
      setFutErr(e);
    } finally {
      setFutLoading(false);
    }
  }, [creds]);

  const rows = useMemo(() => {
    const list = balances.map((b) => {
      const total = parseFloat(b.free) + parseFloat(b.locked);
      const px = prices[b.asset];
      return { ...b, total, value: px !== undefined ? total * px : null };
    });
    list.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    return list;
  }, [balances, prices]);
  const totalValue = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const usdtFree = parseFloat(balances.find((b) => b.asset === "USDT")?.free ?? "0");
  const shown = hideSmall ? rows.filter((r) => r.value === null || r.value >= 1) : rows;
  const hidden = rows.length - shown.length;

  return (
    <div className="space-y-4">
      <Section title="กระเป๋า Spot" desc={permissions.length ? `สิทธิ์ของ Key: ${permissions.join(", ")}` : undefined}
        action={
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <CircleNotch size={12} className="animate-spin" /> : <ArrowsClockwise size={12} />} รีเฟรช
          </Button>
        }>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
            <Stat label="มูลค่ารวมโดยประมาณ" value={`≈ ${fmtUsd(totalValue)} USDT`} />
            <Stat label="USDT พร้อมใช้" value={fmtUsd(usdtFree)} />
            <Stat label="จำนวนเหรียญ" value={rows.length} className="hidden sm:block" />
          </div>

          {rows.length === 0 ? (
            <Empty icon={<Wallet size={22} />} title="ไม่มียอดคงเหลือใน Spot" />
          ) : (
            <div className="overflow-x-auto border">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-muted text-[10px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">เหรียญ</th>
                    <th className="px-3 text-right">พร้อมใช้</th>
                    <th className="px-3 text-right">ติดคำสั่ง</th>
                    <th className="px-3 text-right">ราคา (USDT)</th>
                    <th className="px-3 text-right">มูลค่า (USDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((r) => (
                    <tr key={r.asset}>
                      <td className="px-3 py-2 font-semibold">{r.asset}</td>
                      <td className="px-3 text-right">{fmtQty(r.free)}</td>
                      <td className={cn("px-3 text-right", parseFloat(r.locked) > 0 ? "text-amber-500" : "text-muted-foreground")}>
                        {parseFloat(r.locked) > 0 ? fmtQty(r.locked) : "—"}
                      </td>
                      <td className="px-3 text-right text-muted-foreground">{prices[r.asset] !== undefined ? fmtQty(prices[r.asset], 6) : "—"}</td>
                      <td className="px-3 text-right font-medium">{r.value !== null ? fmtUsd(r.value) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(hidden > 0 || !hideSmall) && rows.length > 0 && (
            <button type="button" onClick={() => setHideSmall((v) => !v)} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {hideSmall ? `แสดงเหรียญมูลค่าน้อยกว่า 1 USDT (${hidden})` : "ซ่อนเหรียญมูลค่าน้อย"}
            </button>
          )}
        </div>
      </Section>

      <Section title="บัญชี Futures (USDⓈ-M)" desc="ต้องเปิดสิทธิ์ Enable Futures ที่ API Key"
        action={
          <Button variant="outline" size="sm" onClick={() => void loadFutures()} disabled={futLoading}>
            {futLoading ? <CircleNotch size={12} className="animate-spin" /> : <ArrowsClockwise size={12} />} {futures ? "รีเฟรช" : "โหลด"}
          </Button>
        }>
        {futErr ? (
          <Notice tone="warn" title="ดึงข้อมูล Futures ไม่ได้">{futErr}</Notice>
        ) : !futures ? (
          <p className="text-[11px] text-muted-foreground">กด “โหลด” เพื่อดูยอดและสถานะ Futures</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-px bg-border">
              <Stat label="ยอดในกระเป๋า" value={fmtUsd(futures.totalWalletBalance)} />
              <Stat label="ใช้ได้" value={fmtUsd(futures.availableBalance)} />
              <Stat label="กำไร/ขาดทุนค้าง" value={fmtUsd(futures.totalUnrealizedProfit)} valueClass={toneClass(futures.totalUnrealizedProfit)} />
            </div>
            {futures.positions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">ไม่มีสถานะ Futures เปิดอยู่</p>
            ) : (
              <ul className="divide-y border text-xs tabular-nums">
                {futures.positions.map((p) => {
                  const amt = parseFloat(p.positionAmt);
                  const pnl = parseFloat(p.unrealizedProfit);
                  return (
                    <li key={`${p.symbol}${p.positionSide}`} className="flex items-center gap-3 px-3 py-2">
                      <span className="font-semibold">{p.symbol}</span>
                      <span className={amt > 0 ? "text-emerald-500" : "text-red-500"}>{amt > 0 ? "Long" : "Short"} {fmtQty(Math.abs(amt))}</span>
                      <span className={cn("ml-auto", toneClass(pnl))}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl)} USDT</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

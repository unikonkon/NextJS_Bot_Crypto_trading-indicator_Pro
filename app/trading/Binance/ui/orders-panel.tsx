"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, CircleNotch, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ApiError, api, hintFor, type Creds, type OpenOrder, type TradeHistory } from "../lib/api";
import { Empty, Notice, Section, fmtQty, fmtTime, fmtUsd, selectClass } from "./parts";

const errOf = (e: unknown) => (e instanceof ApiError ? hintFor(e.code) || e.message : String(e));

export function OrdersPanel({ creds, defaultSymbol }: { creds: Creds; defaultSymbol: string }) {
  const [orders, setOrders] = useState<OpenOrder[] | null>(null);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);

  const [symbol, setSymbol] = useState(defaultSymbol);
  const [limit, setLimit] = useState(50);
  const [trades, setTrades] = useState<TradeHistory[] | null>(null);
  const [tradesErr, setTradesErr] = useState<string | null>(null);
  const [loadingTrades, setLoadingTrades] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrdersErr(null);
    try { setOrders(await api.openOrders(creds)); } catch (e) { setOrdersErr(errOf(e)); } finally { setLoadingOrders(false); }
  }, [creds]);

  const loadTrades = useCallback(async () => {
    if (!symbol) return;
    setLoadingTrades(true);
    setTradesErr(null);
    try { setTrades(await api.trades(creds, symbol, limit)); } catch (e) { setTradesErr(errOf(e)); setTrades(null); } finally { setLoadingTrades(false); }
  }, [creds, symbol, limit]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const cancel = async (o: OpenOrder) => {
    setCancelling(o.orderId);
    try {
      await api.cancelOrder(creds, o.symbol, o.orderId);
      setOrders((prev) => prev?.filter((x) => x.orderId !== o.orderId) ?? null);
    } catch (e) {
      setOrdersErr(`ยกเลิกไม่สำเร็จ: ${errOf(e)}`);
    } finally {
      setCancelling(null);
    }
  };

  const buyTotal = trades?.filter((t) => t.isBuyer).reduce((a, t) => a + parseFloat(t.quoteQty), 0) ?? 0;
  const sellTotal = trades?.filter((t) => !t.isBuyer).reduce((a, t) => a + parseFloat(t.quoteQty), 0) ?? 0;

  return (
    <div className="space-y-4">
      <Section title="คำสั่งที่ค้างอยู่ (Spot)" desc="คำสั่ง Limit ที่ยังไม่ถูกจับคู่"
        action={
          <Button variant="outline" size="sm" onClick={() => void loadOrders()} disabled={loadingOrders}>
            {loadingOrders ? <CircleNotch size={12} className="animate-spin" /> : <ArrowsClockwise size={12} />} รีเฟรช
          </Button>
        }>
        {ordersErr && <Notice tone="danger" className="mb-3">{ordersErr}</Notice>}
        {orders === null ? (
          <p className="text-[11px] text-muted-foreground">กำลังโหลด…</p>
        ) : orders.length === 0 ? (
          <Empty title="ไม่มีคำสั่งค้าง" />
        ) : (
          <div className="overflow-x-auto border">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-muted text-[10px] text-muted-foreground">
                <tr><th className="px-3 py-2 text-left">คู่</th><th className="px-3 text-left">ฝั่ง</th><th className="px-3 text-right">ราคา</th><th className="px-3 text-right">จำนวน</th><th className="px-3 text-left">เวลา</th><th /></tr>
              </thead>
              <tbody className="divide-y">
                {orders.map((o) => (
                  <tr key={o.orderId}>
                    <td className="px-3 py-2 font-semibold">{o.symbol}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{o.type}</span></td>
                    <td className={cn("px-3 font-semibold", o.side === "BUY" ? "text-emerald-500" : "text-red-500")}>{o.side === "BUY" ? "ซื้อ" : "ขาย"}</td>
                    <td className="px-3 text-right">{fmtQty(o.price)}</td>
                    <td className="px-3 text-right">{fmtQty(o.origQty)}</td>
                    <td className="whitespace-nowrap px-3 text-muted-foreground">{fmtTime(o.time)}</td>
                    <td className="px-2 text-right">
                      <Button variant="destructive" size="xs" onClick={() => void cancel(o)} disabled={cancelling === o.orderId}>
                        {cancelling === o.orderId ? <CircleNotch size={11} className="animate-spin" /> : <X size={11} weight="bold" />} ยกเลิก
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="ประวัติการเทรด (Spot)" desc="รายการที่ถูกจับคู่แล้วของคู่เทรดที่เลือก">
        <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void loadTrades(); }}>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium">คู่เทรด</span>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} className="h-9 w-36 font-mono" />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium">จำนวนรายการ</span>
            <select className={cn(selectClass, "w-24")} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[10, 25, 50, 100, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Button type="submit" size="lg" disabled={loadingTrades || !symbol}>
            {loadingTrades ? <CircleNotch size={14} className="animate-spin" /> : <ArrowsClockwise size={14} />} โหลด
          </Button>
        </form>
        {tradesErr && <Notice tone="danger" className="mb-3">{tradesErr}</Notice>}
        {trades === null ? (
          <p className="text-[11px] text-muted-foreground">เลือกคู่เทรดแล้วกด “โหลด”</p>
        ) : trades.length === 0 ? (
          <Empty title={`ไม่มีประวัติ ${symbol}`} />
        ) : (
          <>
            <p className="mb-2 text-[11px] text-muted-foreground tabular-nums">
              {trades.length} รายการ · ซื้อรวม <b className="text-emerald-500">{fmtUsd(buyTotal)}</b> · ขายรวม <b className="text-red-500">{fmtUsd(sellTotal)}</b> (หน่วยเป็นเหรียญที่ใช้จ่าย)
            </p>
            <div className="max-h-[480px] overflow-auto border">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 bg-muted text-[10px] text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left">เวลา</th><th className="px-3 text-left">ฝั่ง</th><th className="px-3 text-right">ราคา</th><th className="px-3 text-right">จำนวน</th><th className="px-3 text-right">มูลค่า</th><th className="px-3 text-right">ค่าธรรมเนียม</th></tr>
                </thead>
                <tbody className="divide-y">
                  {[...trades].reverse().map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap px-3 py-1.5">{fmtTime(t.time)}</td>
                      <td className={cn("px-3 font-semibold", t.isBuyer ? "text-emerald-500" : "text-red-500")}>{t.isBuyer ? "ซื้อ" : "ขาย"}</td>
                      <td className="px-3 text-right">{fmtQty(t.price)}</td>
                      <td className="px-3 text-right">{fmtQty(t.qty)}</td>
                      <td className="px-3 text-right">{fmtUsd(parseFloat(t.quoteQty), 4)}</td>
                      <td className="whitespace-nowrap px-3 text-right text-muted-foreground">{fmtQty(t.commission)} {t.commissionAsset}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

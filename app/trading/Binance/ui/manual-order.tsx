"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircleNotch, Flask, Lightning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { floorToStep } from "@/lib/trading/live";
import { fmtPrice } from "@/app/klines/lib/format";
import { ApiError, api, hintFor, type Balance, type Creds, type SpotOrderResult, type SymbolRules } from "../lib/api";
import { Field, Notice, Section, fmtQty, fmtUsd, selectClass } from "./parts";

const QUOTES = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB"];

type Result =
  | { ok: true; test: boolean; data: SpotOrderResult; summary: string }
  | { ok: false; message: string; hint: string; code?: number };

export function ManualOrder({ creds, balances, onDone }: { creds: Creds; balances: Balance[]; onDone: () => void }) {
  const [coin, setCoin] = useState("BTC");
  const [quote, setQuote] = useState("USDT");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [by, setBy] = useState<"quote" | "qty">("quote");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [test, setTest] = useState(true);
  // Confirmation of a live order is tied to the exact order it was asked for
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [rules, setRules] = useState<SymbolRules | null>(null);
  const [rulesErr, setRulesErr] = useState<string | null>(null);

  const symbol = `${coin}${quote}`;
  const useQuote = type === "MARKET" && by === "quote";
  const orderKey = `${symbol}|${side}|${type}|${by}|${amount}|${limitPrice}|${test}`;
  const confirming = confirmedFor === orderKey;
  const setConfirming = (v: boolean) => setConfirmedFor(v ? orderKey : null);

  // Price + trading rules of the pair (debounced while typing)
  useEffect(() => {
    setPrice(null);
    setRules(null);
    setRulesErr(null);
    if (coin.length < 2) return;
    const t = setTimeout(() => {
      api.price("spot", symbol).then(setPrice).catch(() => setPrice(null));
      api.rules("spot", symbol).then(setRules).catch((e) => setRulesErr(e instanceof Error ? e.message : String(e)));
    }, 400);
    return () => clearTimeout(t);
  }, [symbol, coin.length]);


  const px = type === "LIMIT" ? parseFloat(limitPrice) : price ?? NaN;
  const amt = parseFloat(amount);
  const estQty = useQuote ? amt / px : amt;
  const estValue = useQuote ? amt : amt * px;
  const freeQuote = parseFloat(balances.find((b) => b.asset === quote)?.free ?? "0");
  const freeCoin = parseFloat(balances.find((b) => b.asset === coin)?.free ?? "0");

  const problem = useMemo(() => {
    if (!(amt > 0)) return "ใส่จำนวน";
    if (type === "LIMIT" && !(parseFloat(limitPrice) > 0)) return "ใส่ราคา LIMIT";
    if (rules && rules.minNotional && Number.isFinite(estValue) && estValue < rules.minNotional) return `มูลค่าต่ำกว่าขั้นต่ำ ${rules.minNotional} ${quote}`;
    if (rules && !useQuote && amt < parseFloat(rules.minQty)) return `จำนวนต่ำกว่าขั้นต่ำ ${rules.minQty} ${coin}`;
    return null;
  }, [amt, type, limitPrice, rules, estValue, useQuote, quote, coin]);

  const fillPct = (pct: number) => {
    if (side === "BUY") {
      const spend = freeQuote * pct;
      if (useQuote) setAmount(String(Math.floor(spend * 100) / 100));
      else if (px > 0) setAmount(rules ? floorToStep(spend / px, rules.stepSize) : (spend / px).toFixed(6));
    } else {
      const q = freeCoin * pct;
      if (useQuote && px > 0) setAmount(String(Math.floor(q * px * 100) / 100));
      else setAmount(rules ? floorToStep(q, rules.stepSize) : String(q));
    }
  };

  const send = async () => {
    if (problem) return;
    if (!test && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    setSending(true);
    setResult(null);
    try {
      const qty = useQuote ? undefined : rules ? floorToStep(amt, rules.stepSize) : amount;
      const data = await api.spotOrder(creds, {
        symbol, side, type, testOrder: test,
        ...(useQuote ? { quoteOrderQty: amount } : { quantity: qty }),
        ...(type === "LIMIT" ? { price: limitPrice } : {}),
      });
      setResult({
        ok: true, test, data,
        summary: `${side === "BUY" ? "ซื้อ" : "ขาย"} ${symbol} ${useQuote ? `${amount} ${quote}` : `${qty} ${coin}`}${type === "LIMIT" ? ` @ ${limitPrice}` : ""}`,
      });
      if (!test) onDone();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err));
      setResult({ ok: false, message: e.message, hint: hintFor(e.code), code: e.code });
    } finally {
      setSending(false);
    }
  };

  const buy = side === "BUY";

  return (
    <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1fr_300px]">
      <Section title="ส่งคำสั่ง Spot เอง" desc="ซื้อ/ขายครั้งเดียวด้วยมือ — แยกจากบอท">
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="เหรียญ">
              <Input value={coin} onChange={(e) => setCoin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} className="h-9 font-semibold" placeholder="BTC" />
            </Field>
            <Field label="จ่ายด้วย">
              <select className={selectClass} value={quote} onChange={(e) => setQuote(e.target.value)}>
                {QUOTES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">
            คู่เทรด <b className="font-mono text-foreground">{symbol}</b>
            {price !== null ? <> · ราคาล่าสุด <b className="tabular-nums text-foreground">{fmtPrice(price)}</b> {quote}</> : rulesErr ? <span className="text-red-500"> · {rulesErr}</span> : null}
          </p>

          <Segmented size="lg" value={side} onChange={setSide}
            options={[
              { value: "BUY", label: <><ArrowUp size={14} weight="bold" /> ซื้อ</>, activeClass: "bg-emerald-600 text-white" },
              { value: "SELL", label: <><ArrowDown size={14} weight="bold" /> ขาย</>, activeClass: "bg-red-600 text-white" },
            ]} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ประเภทคำสั่ง" hint={type === "MARKET" ? "ซื้อขายทันทีที่ราคาตลาด" : "รอจนราคาถึงที่ตั้งไว้"}>
              <Segmented value={type} onChange={setType} options={[{ value: "MARKET", label: "Market" }, { value: "LIMIT", label: "Limit" }]} />
            </Field>
            {type === "MARKET" ? (
              <Field label="ระบุเป็น">
                <Segmented value={by} onChange={(v) => { setBy(v); setAmount(""); }}
                  options={[{ value: "quote", label: `มูลค่า (${quote})` }, { value: "qty", label: `จำนวน (${coin})` }]} />
              </Field>
            ) : (
              <Field label={`ราคา LIMIT (${quote})`}>
                <Input type="number" inputMode="decimal" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} className="h-9 tabular-nums"
                  placeholder={price !== null ? String(price) : ""} />
              </Field>
            )}
          </div>

          <Field label={useQuote ? `มูลค่าที่จะ${buy ? "ใช้ซื้อ" : "ขายได้"} (${quote})` : `จำนวน ${coin}`}>
            <Input type="number" inputMode="decimal" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 text-sm tabular-nums" placeholder="0" />
          </Field>
          <div className="-mt-2 flex items-center gap-1">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button key={p} type="button" onClick={() => fillPct(p)} className="h-7 flex-1 border text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                {p * 100}%
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            มี {buy ? `${fmtQty(freeQuote, 4)} ${quote}` : `${fmtQty(freeCoin)} ${coin}`}
            {Number.isFinite(estQty) && Number.isFinite(estValue) && amt > 0 && (
              <> · ประมาณ <b className="text-foreground">{fmtQty(estQty, 8)} {coin}</b> ≈ <b className="text-foreground">{fmtUsd(estValue, 2)} {quote}</b></>
            )}
          </p>

          <Field label="โหมด">
            <Segmented value={test ? "test" : "live"} onChange={(v) => setTest(v === "test")}
              options={[
                { value: "test", label: <><Flask size={14} /> ทดสอบ</>, activeClass: "bg-sky-500 text-white" },
                { value: "live", label: <><Lightning size={14} weight="fill" /> เงินจริง</>, activeClass: "bg-red-500 text-white" },
              ]} />
          </Field>

          {confirming && (
            <Notice tone="danger" title="ยืนยันคำสั่งเงินจริง">
              {buy ? "ซื้อ" : "ขาย"} <b>{symbol}</b> {useQuote ? `${amount} ${quote}` : `${amount} ${coin}`}
              {type === "LIMIT" ? ` ที่ราคา ${limitPrice}` : " ที่ราคาตลาด"} — กดปุ่มด้านล่างอีกครั้งเพื่อส่ง
            </Notice>
          )}

          <Button size="lg" onClick={() => void send()} disabled={!!problem || sending}
            className={cn("h-11 w-full text-white", buy ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700")}>
            {sending ? <CircleNotch size={16} className="animate-spin" /> : buy ? <ArrowUp size={16} weight="bold" /> : <ArrowDown size={16} weight="bold" />}
            {problem ?? (confirming ? `ยืนยัน${buy ? "ซื้อ" : "ขาย"}ด้วยเงินจริง` : `${test ? "ทดสอบ" : ""}${buy ? "ซื้อ" : "ขาย"} ${coin}`)}
          </Button>
          {confirming && <Button variant="ghost" size="sm" className="w-full" onClick={() => setConfirming(false)}>ยกเลิก</Button>}

          {result && (result.ok ? (
            <Notice tone="success" title={result.test ? "คำสั่งผ่านการตรวจ (ทดสอบ — ไม่ได้ซื้อขายจริง)" : `ส่งคำสั่งแล้ว · ${result.data.status ?? ""}`}>
              <p>{result.summary}</p>
              {!result.test && (
                <p className="tabular-nums">
                  Order #{result.data.orderId} · ได้ {result.data.executedQty ?? "0"} {coin}
                  {result.data.cummulativeQuoteQty && <> · {fmtUsd(parseFloat(result.data.cummulativeQuoteQty), 4)} {quote}</>}
                </p>
              )}
            </Notice>
          ) : (
            <Notice tone="danger" title="ส่งคำสั่งไม่สำเร็จ">
              {result.hint && <p className="font-medium text-foreground">{result.hint}</p>}
              <p>{result.message}{result.code !== undefined && ` (code ${result.code})`}</p>
              {rules && result.code === -1013 && (
                <p className="font-mono text-[10px]">ขั้นต่ำ {rules.minQty} · step {rules.stepSize} · มูลค่าขั้นต่ำ {rules.minNotional} {quote}</p>
              )}
            </Notice>
          ))}
        </div>
      </Section>

      <aside className="space-y-3 text-[11px] leading-relaxed text-muted-foreground">
        <Section title="กฎของคู่นี้">
          {rules ? (
            <dl className="grid grid-cols-2 gap-y-1 tabular-nums">
              <dt>จำนวนขั้นต่ำ</dt><dd className="text-right text-foreground">{rules.minQty}</dd>
              <dt>ทีละ (step)</dt><dd className="text-right text-foreground">{rules.stepSize}</dd>
              <dt>มูลค่าขั้นต่ำ</dt><dd className="text-right text-foreground">{rules.minNotional} {quote}</dd>
              <dt>สถานะ</dt><dd className="text-right text-foreground">{rules.status}</dd>
            </dl>
          ) : <p>{rulesErr ?? "กำลังโหลด…"}</p>}
        </Section>
        <p>จำนวนเหรียญจะถูกปัดลงให้ตรง step อัตโนมัติ · Market + “มูลค่า” ปล่อยให้ Binance คำนวณจำนวนเหรียญให้</p>
      </aside>
    </div>
  );
}

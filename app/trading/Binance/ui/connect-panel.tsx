"use client";

import { useState } from "react";
import Image from "next/image";
import {
  AppWindow, ArrowSquareOut, CaretDown, ChartLineUp, CheckCircle, CircleNotch, Coins, Copy, Eye, EyeSlash, Globe, Key, Lightning,
  LinkSimple, LockSimple, Scales, ShieldCheck, WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Notice, Section } from "./parts";

const PERMISSIONS: { name: string; desc: string; need: "required" | "futures" | "off" }[] = [
  { name: "Enable Reading", desc: "ดูยอดคงเหลือ คำสั่ง และประวัติการเทรด", need: "required" },
  { name: "Enable Spot & Margin Trading", desc: "ให้บอท/คุณส่งคำสั่งซื้อขาย Spot", need: "required" },
  { name: "Enable Futures", desc: "เปิดเฉพาะถ้าจะให้บอทเทรด Futures (Long/Short)", need: "futures" },
  { name: "Enable Withdrawals", desc: "ห้ามเปิด — ระบบนี้ไม่จำเป็นต้องถอนเงิน", need: "off" },
];

export function ConnectPanel({ onConnect, connecting, error }: {
  onConnect: (apiKey: string, secretKey: string) => void;
  connecting: boolean;
  error: string | null;
}) {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [guide, setGuide] = useState(false);
  const [ip, setIp] = useState<{ server: string; client: string } | null>(null);
  const [loadingIp, setLoadingIp] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const checkIp = async () => {
    setLoadingIp(true);
    try {
      const [server, client] = await Promise.all([
        fetch("/api/server-ip").then((r) => r.json()).then((d) => d.serverIp as string).catch(() => "ไม่สามารถดึงได้"),
        fetch("https://api.ipify.org?format=json").then((r) => r.json()).then((d) => d.ip as string).catch(() => "ไม่สามารถดึงได้"),
      ]);
      setIp({ server: server || "ไม่สามารถดึงได้", client });
    } finally {
      setLoadingIp(false);
    }
  };

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim() && secretKey.trim()) onConnect(apiKey.trim(), secretKey.trim());
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Section title="เชื่อมต่อบัญชี Binance" desc="ใส่ API Key ของคุณ — เก็บไว้ในหน่วยความจำของแท็บนี้เท่านั้น ไม่บันทึกลงเครื่อง ไม่ใส่ใน URL">
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium">API Key</span>
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="วาง API Key" autoComplete="off" spellCheck={false} className="h-9 font-mono" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium">Secret Key</span>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="วาง Secret Key"
                autoComplete="off"
                spellCheck={false}
                className="h-9 pr-9 font-mono"
              />
              <button type="button" onClick={() => setShowSecret((v) => !v)} aria-label={showSecret ? "ซ่อน" : "แสดง"}
                className="absolute right-0 top-0 grid size-9 place-items-center text-muted-foreground hover:text-foreground">
                {showSecret ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <Button type="submit" size="lg" className="h-10 w-full" disabled={connecting || !apiKey.trim() || !secretKey.trim()}>
            {connecting ? <CircleNotch size={16} className="animate-spin" /> : <LinkSimple size={16} weight="bold" />}
            {connecting ? "กำลังตรวจสอบ…" : "เชื่อมต่อ"}
          </Button>
          {error && <Notice tone="danger" title="เชื่อมต่อไม่สำเร็จ">{error}</Notice>}
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            รีเฟรชหน้าแล้วต้องใส่ Key ใหม่ · ประวัติบอทและสถานะที่ถืออยู่ยังถูกจำไว้ในเครื่องนี้ (ไม่รวม Key)
          </p>
        </form>
      </Section>

      <Section title="ยังไม่มี API Key?" desc="ทำ 3 ขั้นตอนที่ Binance แล้วกลับมาวาง Key ทางซ้าย"
        action={
          <Button variant="ghost" size="sm" onClick={() => setGuide((v) => !v)} aria-expanded={guide}>
            {guide ? "ย่อ" : "ดูวิธีทำ"} <CaretDown size={12} className={cn("transition-transform", guide && "rotate-180")} />
          </Button>
        }>
        <div className="space-y-4">
          <a href="https://www.binance.com/en/my/settings/api-management" target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400">
            <Key size={14} weight="bold" /> เปิดหน้า API Management ของ Binance <ArrowSquareOut size={12} />
          </a>

          {guide && (
            <ol className="space-y-4 text-[11px]">
              <li className="space-y-2">
                <p className="font-semibold">1 · Create API → เลือก <b>System generated</b></p>
                <Image src="/trading/Binance/set.png" alt="เลือก System generated" width={480} height={480} className="h-auto w-full max-w-xs border" />
              </li>
              <li className="space-y-2">
                <p className="font-semibold">2 · ตั้งสิทธิ์ (API restrictions)</p>
                <ul className="space-y-1.5">
                  {PERMISSIONS.map((p) => (
                    <li key={p.name} className="flex items-start gap-2">
                      <ShieldCheck size={14} weight="fill" className={cn("mt-px shrink-0",
                        p.need === "required" ? "text-emerald-500" : p.need === "futures" ? "text-sky-500" : "text-red-500")} />
                      <span>
                        <b>{p.name}</b>{" "}
                        <span className={cn("text-[10px]", p.need === "off" ? "text-red-500" : "text-muted-foreground")}>
                          {p.need === "required" ? "· ต้องเปิด" : p.need === "futures" ? "· ถ้าใช้ Futures" : "· ห้ามเปิด"}
                        </span>
                        <span className="block text-muted-foreground">{p.desc}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
              <li className="space-y-2">
                <p className="flex items-center gap-1.5 font-semibold"><LockSimple size={13} /> 3 · จำกัด IP (แนะนำ)</p>
                <p className="text-muted-foreground">
                  Binance จะลบ Key ที่เปิดสิทธิ์เทรดแต่ไม่จำกัด IP · ใส่ <b>Server IP</b> ด้านล่างใน “Restrict access to trusted IPs only”
                </p>
              </li>
            </ol>
          )}

          <div className="space-y-2">
            <Button variant="outline" size="sm" onClick={checkIp} disabled={loadingIp}>
              {loadingIp ? <CircleNotch size={13} className="animate-spin" /> : <Globe size={13} />} ดู IP ที่ต้องใส่
            </Button>
            {ip && (
              <div className="space-y-2 border p-3 text-[11px]">
                {[
                  { label: "Server IP", v: ip.server, note: "IP ที่ Binance เห็นจริง — ใส่ตัวนี้ใน whitelist", main: true },
                  { label: "Client IP", v: ip.client, note: "IP ของเบราว์เซอร์คุณ — ไม่ต้องใส่", main: false },
                ].map((r) => (
                  <div key={r.label}>
                    <div className="flex items-center gap-2">
                      <span className={cn("w-16 shrink-0 text-[10px]", r.main ? "font-semibold" : "text-muted-foreground")}>{r.label}</span>
                      <code className={cn("min-w-0 truncate px-1.5 py-0.5 font-mono", r.main ? "bg-primary/10 font-bold" : "bg-muted text-muted-foreground")}>{r.v}</code>
                      <button type="button" onClick={() => copy(r.v)} aria-label={`คัดลอก ${r.label}`} className="text-muted-foreground hover:text-foreground">
                        {copied === r.v ? <CheckCircle size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="pl-[72px] text-[10px] text-muted-foreground">{r.note}</p>
                  </div>
                ))}
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  ถ้า deploy บน Vercel, Server IP อาจเปลี่ยนเมื่อ deploy ใหม่ — ต้องอัปเดต whitelist ตาม
                </p>
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
    <Limitations />
    </div>
  );
}

const LIMITS: { icon: typeof Key; title: string; text: string; tone: "warn" | "info" }[] = [
  {
    icon: AppWindow,
    title: "บอทรันในแท็บเบราว์เซอร์",
    text: "ปิดแท็บหรือคอมหลับ บอทจะหยุด และถ้าแท็บอยู่เบื้องหลังนาน Chrome อาจหน่วงการเช็คราคา",
    tone: "warn",
  },
  {
    icon: Lightning,
    title: "Stop ระหว่างแท่งใช้ราคาที่เช็คตามรอบ",
    text: "ไม่ได้ตั้ง stop order ไว้ที่ Binance ถ้าราคากระชากแรงอาจหลุดเกินระดับ Stop ได้",
    tone: "warn",
  },
  {
    icon: Coins,
    title: "Futures มีมูลค่าขั้นต่ำ",
    text: "เช่น BTCUSDT ต้องอย่างน้อย 50 USDT บอทจะเช็คเรื่องนี้ก่อนเริ่ม",
    tone: "info",
  },
  {
    icon: ChartLineUp,
    title: "สัญญาณคำนวณจากกราฟ Spot",
    text: "เหมือนตอน Backtest แม้จะเทรดบน Futures",
    tone: "info",
  },
  {
    icon: Scales,
    title: "ขนาดไม้คงที่",
    text: "บอทใช้จำนวนเงินต่อไม้เท่ากันทุกไม้ แม้กลยุทธ์ (v3–v6) จะกำหนดขนาดสถานะเป็นสัดส่วนของพอร์ต",
    tone: "info",
  },
];

/** What the browser bot cannot do — shown before connecting so expectations are set up front */
function Limitations() {
  return (
    <Section
      title={<span className="flex items-center gap-1.5"><WarningCircle size={16} weight="fill" className="text-amber-500" /> ข้อจำกัดที่ควรรู้ก่อนใช้บอท</span>}
      desc="อ่านก่อนเปิดโหมดเงินจริง — ผลจริงอาจต่างจาก Backtest ด้วยเหตุผลเหล่านี้"
    >
      <ul className="grid gap-px bg-border sm:grid-cols-2">
        {LIMITS.map(({ icon: Icon, title, text, tone }) => (
          <li key={title} className="flex gap-3 bg-card p-3 sm:last:col-span-2">
            <span className={cn(
              "grid size-8 shrink-0 place-items-center",
              tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400",
            )}>
              <Icon size={16} weight="duotone" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-semibold">{title}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

"use client";

import { useState } from "react";
import { DownloadSimple, FileCsv, Stop } from "@phosphor-icons/react";
import { Sheet } from "@/components/ui/sheet";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Interval } from "@/lib/types/kline";
import type { DataSource } from "../lib/use-kline-data";
import { fmtDate } from "../lib/format";

const LIMITS = [200, 500, 1000, 2000, 5000];

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  interval: Interval;
  source: DataSource | null;
  barCount: number;
  firstTime: number | null;
  lastTime: number | null;
  loadedAt: Date | null;
  loading: boolean;
  progress: number | null;
  csvFiles: string[];
  onLatest: (limit: number) => void;
  onRange: (start: number, end: number) => void;
  onCsv: (file: string) => void;
  onCancel: () => void;
  onDownload: () => void;
}

export function DataSheet(p: Props) {
  const [tab, setTab] = useState<"latest" | "range" | "csv">(p.source?.kind ?? "latest");
  const [limit, setLimit] = useState(p.source?.kind === "latest" ? p.source.limit : 1000);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      title="ข้อมูลแท่งเทียน"
      description={`${p.symbol} · ${p.interval}`}
      footer={
        <div className="space-y-2">
          {p.barCount > 0 && p.firstTime !== null && p.lastTime !== null && (
            <p className="text-[10px] tabular-nums text-muted-foreground">
              ตอนนี้: {p.barCount.toLocaleString()} แท่ง · {fmtDate(p.firstTime, true)} → {fmtDate(p.lastTime, true)}
              {p.loadedAt && ` · โหลดเมื่อ ${p.loadedAt.toLocaleTimeString()}`}
            </p>
          )}
          <Button variant="outline" size="lg" className="w-full" disabled={p.barCount === 0} onClick={p.onDownload}>
            <DownloadSimple size={14} /> ดาวน์โหลดข้อมูลปัจจุบันเป็น CSV
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "latest", label: "ล่าสุด" },
            { value: "range", label: "ช่วงเวลา" },
            { value: "csv", label: `ไฟล์ (${p.csvFiles.length})` },
          ]}
        />

        {tab === "latest" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">ดึงแท่งเทียนล่าสุดจาก Binance (เกิน 1,000 แท่งจะดึงหลายรอบอัตโนมัติ)</p>
            <div className="grid grid-cols-5 gap-1">
              {LIMITS.map((l) => (
                <button key={l} type="button" onClick={() => setLimit(l)}
                  className={cn("h-10 border text-xs font-medium tabular-nums", limit === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  {l.toLocaleString()}
                </button>
              ))}
            </div>
            <Button size="lg" className="h-11 w-full text-sm" disabled={p.loading} onClick={() => { p.onLatest(limit); p.onClose(); }}>
              โหลด {limit.toLocaleString()} แท่งล่าสุด
            </Button>
          </div>
        )}

        {tab === "range" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">ดึงข้อมูลย้อนหลังทุกแท่งในช่วงที่เลือก (ช่วงยาวอาจใช้เวลาหลายวินาที)</p>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium">เริ่มต้น</span>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="h-10" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium">สิ้นสุด <span className="text-muted-foreground">(ว่าง = ปัจจุบัน)</span></span>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="h-10" />
            </label>
            {p.loading && p.progress !== null ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 animate-pulse text-[11px] tabular-nums text-muted-foreground">ดึงแล้ว {p.progress.toLocaleString()} แท่ง…</span>
                <Button variant="destructive" size="lg" onClick={p.onCancel}><Stop size={14} weight="fill" /> ยกเลิก</Button>
              </div>
            ) : (
              <Button size="lg" className="h-11 w-full text-sm" disabled={!start || p.loading}
                onClick={() => p.onRange(new Date(start).getTime(), end ? new Date(end).getTime() : Date.now())}>
                ดึงข้อมูลย้อนหลัง
              </Button>
            )}
          </div>
        )}

        {tab === "csv" && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">ไฟล์ใน app/getData/data/dataShowUI</p>
            {p.csvFiles.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">ไม่พบไฟล์</p>}
            {p.csvFiles.map((f) => (
              <button key={f} type="button" disabled={p.loading}
                onClick={() => { p.onCsv(f); p.onClose(); }}
                className={cn("flex h-11 w-full items-center gap-2 border px-3 text-left text-xs hover:bg-muted disabled:opacity-50",
                  p.source?.kind === "csv" && p.source.file === f && "border-primary")}>
                <FileCsv size={18} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{f.replace(/\.csv$/, "").replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

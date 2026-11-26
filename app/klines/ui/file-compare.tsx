"use client";

import { Files, Play, Stop, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CsvFileInfo } from "@/app/api/dataShowUI/route";
import type { BacktestSummary } from "@/lib/engine/types";
import { fmtPct, toneClass } from "../lib/format";
import { fileLabel } from "./ranking-panel";

export interface CompareRow {
  file: CsvFileInfo;
  summary: BacktestSummary | null;
  error?: string;
}

interface Props {
  strategyName: string;
  /** Selected CSV files / every CSV file (for labels) */
  files: CsvFileInfo[];
  allFiles: CsvFileInfo[];
  rows: CompareRow[] | null;
  running: boolean;
  progress: { done: number; total: number; stage: string } | null;
  /** Strategy, parameters, settings or files changed since the last run */
  stale: boolean;
  /** File currently on the chart */
  activeFile: string | null;
  onRun: () => void;
  onCancel: () => void;
  onPickFiles: () => void;
  onLoadFile: (f: CsvFileInfo) => void;
}

/** The current strategy (with its settings) run on every selected CSV file */
export function FileCompare(p: Props) {
  const ok = (p.rows ?? []).filter((r) => r.summary).map((r) => r.summary!);
  const avg = (f: (s: BacktestSummary) => number) => (ok.length ? ok.reduce((a, s) => a + f(s), 0) / ok.length : 0);
  const profitable = ok.filter((s) => s.totalReturnPct > 0).length;
  const beatHold = ok.filter((s) => s.totalReturnPct > s.buyAndHoldPct).length;

  return (
    <section className="space-y-3 border-t px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Files size={14} /> ทดสอบกับหลายไฟล์</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            รัน {p.strategyName} ด้วยค่าที่ตั้งไว้ (รวม SL/TP และตัวกรอง) บนทุกไฟล์ที่เลือก · ไม่กระทบกราฟ
          </p>
        </div>
        <button type="button" onClick={p.onPickFiles} className="h-7 shrink-0 border px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground">
          เลือกไฟล์ ({p.files.length})
        </button>
      </div>

      {p.running ? (
        <div className="space-y-1.5">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {p.progress && p.progress.total > 0 ? `${p.progress.done}/${p.progress.total} ไฟล์ · ${p.progress.stage}` : p.progress?.stage ?? "กำลังเตรียม…"}
          </p>
          <Button variant="destructive" size="lg" className="w-full" onClick={p.onCancel}><Stop size={14} weight="fill" /> ยกเลิก</Button>
        </div>
      ) : (
        <Button size="lg" variant={p.rows && !p.stale ? "outline" : "default"} className="h-10 w-full text-xs" disabled={p.files.length === 0} onClick={p.onRun}>
          <Play size={13} weight="fill" /> {p.files.length ? `ทดสอบ ${p.files.length} ไฟล์` : "ยังไม่ได้เลือกไฟล์"}
        </Button>
      )}

      {p.stale && p.rows && (
        <p className="flex gap-1.5 border border-warn/30 bg-warn/5 px-2 py-1.5 text-[10px] text-warn">
          <Warning size={13} className="shrink-0" /> กลยุทธ์ การตั้งค่า หรือไฟล์เปลี่ยนไป — กดทดสอบใหม่
        </p>
      )}

      {p.rows && (
        <>
          {ok.length > 0 && (
            <div className="grid grid-cols-3 gap-px border bg-border text-center">
              <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">กำไรเฉลี่ย</p><p className={cn("text-sm font-semibold tabular-nums", toneClass(avg((s) => s.totalReturnPct)))}>{fmtPct(avg((s) => s.totalReturnPct), 1)}</p></div>
              <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">มีกำไร</p><p className="text-sm font-semibold tabular-nums">{profitable}/{ok.length} ไฟล์</p></div>
              <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">ชนะซื้อถือ</p><p className="text-sm font-semibold tabular-nums">{beatHold}/{ok.length} ไฟล์</p></div>
            </div>
          )}
          <div className="overflow-x-auto border">
            <table className="w-full min-w-[340px] text-[11px] tabular-nums">
              <thead className="bg-muted/50 text-[10px] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">ไฟล์</th>
                  <th className="px-2 py-1.5 text-right font-medium">กำไร</th>
                  <th className="px-2 py-1.5 text-right font-medium">เทรด</th>
                  <th className="px-2 py-1.5 text-right font-medium">ชนะ</th>
                  <th className="px-2 py-1.5 text-right font-medium">DD</th>
                  <th className="px-2 py-1.5 text-right font-medium">ซื้อถือ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.rows.map((r) => {
                  const s = r.summary;
                  const active = p.activeFile === r.file.file;
                  return (
                    <tr key={r.file.file} onClick={() => p.onLoadFile(r.file)} title="โหลดไฟล์นี้ขึ้นกราฟ"
                      className={cn("cursor-pointer hover:bg-muted/50", active && "bg-muted/60")}>
                      <td className="px-2 py-1.5 font-medium">{fileLabel(r.file.file, p.allFiles)}{active && <span className="ml-1 text-[9px] text-primary">●</span>}</td>
                      {s ? (
                        <>
                          <td className={cn("px-2 py-1.5 text-right font-semibold", toneClass(s.totalReturnPct))}>{fmtPct(s.totalReturnPct, 1)}</td>
                          <td className="px-2 py-1.5 text-right">{s.totalTrades}</td>
                          <td className="px-2 py-1.5 text-right">{s.winRate.toFixed(0)}%</td>
                          <td className="px-2 py-1.5 text-right">−{s.maxDrawdownPct.toFixed(0)}%</td>
                          <td className={cn("px-2 py-1.5 text-right", toneClass(s.buyAndHoldPct))}>{fmtPct(s.buyAndHoldPct, 0)}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="max-w-0 truncate px-2 py-1.5 text-[10px] text-down" title={r.error}>{r.error ?? "ข้อมูลไม่พอ"}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">แตะแถวเพื่อโหลดไฟล์นั้นขึ้นกราฟ · ประเมินทั้งไฟล์หลังช่วงอุ่นเครื่อง</p>
        </>
      )}
    </section>
  );
}

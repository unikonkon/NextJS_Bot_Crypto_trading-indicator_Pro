"use client";

import { useState } from "react";
import { CaretDown, SignOut, SlidersHorizontal, TrendDown, TrendUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { defaultParams, engineOf, normalizeParams, sourceOf } from "@/lib/engine/registry";
import { CATEGORY_LABELS, SOURCE_LABELS, type Category, type IndicatorDef, type Params } from "@/lib/engine/types";
import { SourceBadge } from "./indicator-picker";

/** What each kind of indicator looks at — shown with every explanation */
export const CATEGORY_MEANING: Record<Category, string> = {
  trend: "ตามเทรนด์ — เข้าเมื่อราคาเริ่มวิ่งไปทางใดทางหนึ่ง ได้ผลดีตอนตลาดมีทิศทาง มักเสียช่วงราคาแกว่งออกข้าง",
  momentum: "วัดแรงเหวี่ยงของราคา — หาจังหวะที่แรงซื้อ/แรงขายสุดตัวหรือเริ่มกลับทิศ",
  volatility: "วัดความผันผวน — เข้าเมื่อราคาทะลุกรอบ หรือหลังช่วงที่ราคาบีบตัวแคบ",
  volume: "ดูปริมาณซื้อขาย — ใช้แรงซื้อ/แรงขายจริงมายืนยันทิศของราคา",
  structure: "ดูโครงสร้างราคา — ใช้จุดสูง/ต่ำ แนวรับ/แนวต้าน และการทะลุโครงสร้าง",
};

/** Shown value of one param: switch → เปิด/ปิด, choice → its label */
function paramText(def: IndicatorDef, key: string, v: number): string {
  const pd = def.params.find((p) => p.key === key);
  if (pd?.toggle) return v >= 0.5 ? "เปิด" : "ปิด";
  if (pd?.options) return pd.options[Math.round(v)] ?? String(v);
  return String(v);
}

/**
 * Plain-language explanation of one indicator: what kind it is, when it buys / sells and how it exits.
 * With `params` (the values in use) it also lists the ones changed from their defaults.
 */
export function IndicatorMeaning({ def, params }: { def: IndicatorDef; params?: Params }) {
  const p = normalizeParams(def, params ?? defaultParams(def));
  const ownExits = engineOf(def, p).kind === "exposure";
  const adjustable = def.params.filter((pd) => !pd.locked);
  const changed = params
    ? adjustable.filter((pd) => p[pd.key] !== pd.default && (!pd.visibleWhen || (p[pd.visibleWhen.key] ?? 0) === pd.visibleWhen.value))
    : [];

  return (
    <div className="space-y-1.5 text-[11px] leading-snug">
      {def.longRule && (
        <p className="flex gap-1.5"><TrendUp size={14} className="mt-px shrink-0 text-up" /><span><b className="text-up">ซื้อ (Long):</b> {def.longRule}</span></p>
      )}
      {def.shortRule && (
        <p className="flex gap-1.5"><TrendDown size={14} className="mt-px shrink-0 text-down" /><span><b className="text-down">ขาย (Short):</b> {def.shortRule}</span></p>
      )}
      {def.description && <p>{def.description}</p>}
      <p className="flex gap-1.5 text-muted-foreground">
        <SignOut size={14} className="mt-px shrink-0" />
        <span>
          <b className="font-medium text-foreground">ออกจากไม้:</b>{" "}
          {ownExits ? "กลยุทธ์นี้กำหนดจุดออกและ stop ของตัวเอง (ไม่ใช้ SL/TP ของหน้านี้)" : "เมื่อเกิดสัญญาณฝั่งตรงข้าม หรือถึง SL/TP ที่ตั้งไว้ในแท็บกลยุทธ์"}
        </span>
      </p>
      {adjustable.length > 0 && (
        <p className="flex gap-1.5 text-muted-foreground">
          <SlidersHorizontal size={14} className="mt-px shrink-0" />
          <span>
            {!params ? (
              <>ปรับได้ {adjustable.length} ค่าในแท็บกลยุทธ์</>
            ) : changed.length === 0 ? (
              <>ใช้ค่าเริ่มต้นทั้ง {adjustable.length} ค่า</>
            ) : (
              <>
                <b className="font-medium text-foreground">ค่าที่ปรับจากค่าเริ่มต้น:</b>{" "}
                {changed.map((pd, i) => (
                  <span key={pd.key}>
                    {i > 0 && " · "}{pd.label} <b className="font-medium tabular-nums text-foreground">{paramText(def, pd.key, p[pd.key])}</b>
                  </span>
                ))}
              </>
            )}
          </span>
        </p>
      )}
      <p className="border-t pt-1.5 text-[10px] text-muted-foreground">
        <b className="font-medium text-foreground">ประเภท{CATEGORY_LABELS[def.category]}</b> · {CATEGORY_MEANING[def.category]}
        <span className="mt-0.5 block">ชุด {SOURCE_LABELS[sourceOf(def)]} · ต้องมีข้อมูลก่อนหน้าอย่างน้อย {def.minBars.toLocaleString()} แท่ง</span>
      </p>
    </div>
  );
}

export interface IndicatorListItem {
  def: IndicatorDef;
  /** Values in use (omit to describe the indicator in general) */
  params?: Params;
  /** Short label after the name, e.g. "กลยุทธ์" / "บนกราฟ" */
  tag?: string;
}

/** Indicators as compact rows; a row opens to its explanation (one open at a time) */
export function IndicatorList({ items, defaultOpen, className }: { items: IndicatorListItem[]; defaultOpen?: string; className?: string }) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? null);
  return (
    <ul className={cn("divide-y", className)}>
      {items.map(({ def, params, tag }) => {
        const isOpen = open === def.id;
        return (
          <li key={def.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : def.id)}
              className={cn("flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50", isOpen && "bg-muted/40")}
            >
              <SourceBadge source={sourceOf(def)} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{def.name}</span>
              {tag && <span className="shrink-0 bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">{tag}</span>}
              <span className="shrink-0 border px-1.5 text-[9px] text-muted-foreground">{CATEGORY_LABELS[def.category]}</span>
              <CaretDown size={12} className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && <div className="bg-muted/20 px-3 pb-3 pt-2"><IndicatorMeaning def={def} params={params} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

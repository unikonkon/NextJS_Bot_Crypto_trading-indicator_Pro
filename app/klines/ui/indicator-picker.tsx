"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlass, Star, Check, TrendUp, TrendDown } from "@phosphor-icons/react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listIndicators, categoriesInUse } from "@/lib/engine/registry";
import { CATEGORY_LABELS, type Category } from "@/lib/engine/types";

type Filter = "all" | "fav" | Category;

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** ids shown as selected (check mark) */
  selected: string[];
  onPick: (id: string) => void;
  /** keep the sheet open after picking (multi-select mode) */
  multi?: boolean;
  /** only list indicators that can be drawn */
  plottableOnly?: boolean;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
}

export function IndicatorPicker({ open, onClose, title, description, selected, onPick, multi, plottableOnly, favorites, onToggleFavorite }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const all = listIndicators();

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((d) => {
      if (plottableOnly && !d.plot) return false;
      if (filter === "fav" && !favorites.includes(d.id)) return false;
      if (filter !== "all" && filter !== "fav" && d.category !== filter) return false;
      if (!q) return true;
      return `${d.name} ${d.id} ${d.longRule} ${d.shortRule} ${CATEGORY_LABELS[d.category]}`.toLowerCase().includes(q);
    });
  }, [all, query, filter, favorites, plottableOnly]);

  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: `ทั้งหมด ${all.length}` },
    { value: "fav", label: `★ โปรด ${favorites.length}` },
    ...categoriesInUse().map((c) => ({ value: c as Filter, label: CATEGORY_LABELS[c] })),
  ];

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}>
      <div className="sticky top-0 z-10 space-y-2 border-b bg-background px-4 py-3">
        <div className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา เช่น RSI, EMA, เทรนด์..."
            className="h-9 pl-8"
            autoFocus
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "h-7 shrink-0 border px-2.5 text-[11px] font-medium transition-colors",
                filter === f.value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y">
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-xs text-muted-foreground">
            {filter === "fav" ? "ยังไม่มีรายการโปรด — กด ☆ ที่ indicator เพื่อเพิ่ม" : "ไม่พบ indicator ที่ค้นหา"}
          </li>
        )}
        {items.map((d) => {
          const isSel = selected.includes(d.id);
          const isFav = favorites.includes(d.id);
          return (
            <li key={d.id} className={cn("flex items-stretch", isSel && "bg-muted/60")}>
              <button
                type="button"
                onClick={() => { onPick(d.id); if (!multi) onClose(); }}
                className="min-w-0 flex-1 px-4 py-3 text-left hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("grid size-4 shrink-0 place-items-center border", isSel ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {isSel && <Check size={10} weight="bold" />}
                  </span>
                  <span className="truncate text-xs font-semibold">{d.name}</span>
                  <span className="shrink-0 border px-1.5 text-[9px] text-muted-foreground">{CATEGORY_LABELS[d.category]}</span>
                </div>
                <div className="mt-1.5 space-y-0.5 pl-6 text-[11px] leading-snug text-muted-foreground">
                  <p className="flex gap-1.5"><TrendUp size={13} className="mt-px shrink-0 text-emerald-500" />{d.longRule}</p>
                  <p className="flex gap-1.5"><TrendDown size={13} className="mt-px shrink-0 text-red-500" />{d.shortRule}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onToggleFavorite(d.id)}
                className="grid w-12 shrink-0 place-items-center text-muted-foreground hover:text-amber-500"
                aria-label={isFav ? "เอาออกจากรายการโปรด" : "เพิ่มในรายการโปรด"}
              >
                <Star size={16} weight={isFav ? "fill" : "regular"} className={isFav ? "text-amber-500" : ""} />
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

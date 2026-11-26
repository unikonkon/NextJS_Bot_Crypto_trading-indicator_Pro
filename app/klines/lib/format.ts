export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

export function fmtPct(n: number, dec = 2, sign = true): string {
  if (n === Infinity) return "∞";
  if (!Number.isFinite(n)) return "—";
  return `${sign && n > 0 ? "+" : ""}${n.toFixed(dec)}%`;
}

export function fmtNum(n: number, dec = 2): string {
  if (n === Infinity) return "∞";
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(dec);
}

export function fmtDate(ts: number, withYear = false): string {
  return new Date(ts).toLocaleString("en-GB", {
    ...(withYear ? { year: "2-digit" } : {}),
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Length of a time span: "45 วัน", "1.5 ปี" */
export function fmtDays(ms: number): string {
  const d = Math.round(ms / 86_400_000);
  return d >= 360 ? `${(d / 365).toFixed(d % 365 < 5 || d % 365 > 360 ? 0 : 1)} ปี` : `${d} วัน`;
}

/** Storage size: "850 KB", "4.1 MB", "119.6 GB" */
export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function toneClass(v: number): string {
  return v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted-foreground";
}

export const EXIT_REASON_LABEL: Record<string, string> = {
  signal: "สัญญาณกลับทาง",
  stopLoss: "Stop Loss",
  takeProfit: "Take Profit",
  trailing: "Trailing Stop",
  end: "ปิดท้ายข้อมูล",
};

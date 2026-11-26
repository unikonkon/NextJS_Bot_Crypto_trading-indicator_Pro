import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { INTERVALS } from "@/lib/types/kline";

const DATA_DIR = path.join(process.cwd(), "app/getData/data/dataShowUI");

export interface CsvFileInfo {
  file: string;
  /** From the file name: SYMBOL_INTERVAL_….csv (null when the name does not say) */
  symbol: string | null;
  interval: string | null;
  bars: number;
  /** Open time of the first bar / close time of the last bar (ms) */
  from: number;
  to: number;
  /** Open of the first bar → close of the last bar */
  open: number;
  close: number;
  high: number;
  low: number;
  /** File size in bytes */
  size: number;
}

// Summaries are cached per file until it changes on disk
const summaries = new Map<string, { mtime: number; info: CsvFileInfo }>();

function summarize(file: string): CsvFileInfo | null {
  const filePath = path.join(DATA_DIR, file);
  const stat = fs.statSync(filePath);
  const hit = summaries.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit.info;

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n").slice(1).filter(Boolean);
  if (lines.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const l of lines) {
    const c = l.split(",");
    high = Math.max(high, +c[2]);
    low = Math.min(low, +c[3]);
  }
  const first = lines[0].split(",");
  const last = lines[lines.length - 1].split(",");
  const [sym, tf] = file.replace(/\.csv$/, "").split("_");
  const info: CsvFileInfo = {
    file,
    symbol: /^[A-Z0-9]{5,}$/.test(sym ?? "") ? sym : null,
    interval: (INTERVALS as readonly string[]).includes(tf ?? "") ? tf : null,
    bars: lines.length,
    from: new Date(first[0]).getTime(),
    to: new Date(last[6]).getTime(),
    open: +first[1],
    close: +last[4],
    high,
    low,
    size: stat.size,
  };
  summaries.set(file, { mtime: stat.mtimeMs, info });
  return info;
}

const TF_ORDER = INTERVALS as readonly string[];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const file = searchParams.get("file");

  // List mode: every CSV with its date range and prices, ordered by symbol then timeframe
  if (!file) {
    try {
      if (!fs.existsSync(DATA_DIR)) return NextResponse.json([]);
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv"));
      const infos = files.map((f) => { try { return summarize(f); } catch { return null; } }).filter((x): x is CsvFileInfo => !!x);
      infos.sort((a, b) =>
        (a.symbol ?? "").localeCompare(b.symbol ?? "") ||
        (a.interval ? TF_ORDER.indexOf(a.interval) : 99) - (b.interval ? TF_ORDER.indexOf(b.interval) : 99) ||
        a.file.localeCompare(b.file));
      return NextResponse.json(infos);
    } catch {
      return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
    }
  }

  // Read mode: return CSV content as text
  const safeName = path.basename(file);
  const filePath = path.join(DATA_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

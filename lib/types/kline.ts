export interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
}

export type BinanceKlineRaw = [
  number,  // [0] Open time
  string,  // [1] Open price
  string,  // [2] High price
  string,  // [3] Low price
  string,  // [4] Close price
  string,  // [5] Volume
  number,  // [6] Close time
  string,  // [7] Quote asset volume
  number,  // [8] Number of trades
  string,  // [9] Taker buy base asset volume
  string,  // [10] Taker buy quote asset volume
];

export const INTERVALS = [
  "1s", "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export type Interval = (typeof INTERVALS)[number];

/** Minutes per bar (1M is a nominal 30 days) */
export const INTERVAL_MINUTES: Record<Interval, number> = {
  "1s": 1 / 60, "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240,
  "6h": 360, "8h": 480, "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080, "1M": 43200,
};

export const INDICATOR_REQUIREMENTS: Record<string, { minBars: number; fields: string[] }> = {
  "RSI(14)": { minBars: 15, fields: ["Close"] },
  "ATR(14)": { minBars: 15, fields: ["High", "Low", "Close"] },
  "OBV": { minBars: 1, fields: ["Close", "Volume"] },
  "VWAP": { minBars: 1, fields: ["High", "Low", "Close", "Volume", "QuoteVol"] },
  "CDC ActionZone": { minBars: 27, fields: ["Close"] },
  "SMC": { minBars: 100, fields: ["Open", "High", "Low", "Close"] },
  "CM MacD Ult MTF": { minBars: 35, fields: ["Close"] },
  "Supertrend": { minBars: 15, fields: ["High", "Low", "Close"] },
};

export function parseKline(raw: BinanceKlineRaw): KlineData {
  return {
    openTime: raw[0],
    open: raw[1],
    high: raw[2],
    low: raw[3],
    close: raw[4],
    volume: raw[5],
    closeTime: raw[6],
    quoteAssetVolume: raw[7],
    numberOfTrades: raw[8],
    takerBuyBaseVolume: raw[9],
    takerBuyQuoteVolume: raw[10],
  };
}

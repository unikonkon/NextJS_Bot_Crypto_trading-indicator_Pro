/**
 * Coin categories for the symbol picker — base assets of Binance spot USDT pairs.
 * Every entry was checked against Binance exchangeInfo (status TRADING) on 2026-11-26;
 * the picker also hides any coin that is missing from the live list (delisted later).
 * A coin may sit in more than one category.
 */
export interface SymbolCategory {
  id: string;
  label: string;
  hint?: string;
  coins: string[];
}

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    id: "popular",
    label: "ยอดนิยม",
    hint: "มูลค่าตลาดและวอลุ่มสูงสุด",
    coins: [
      "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "LINK", "AVAX",
      "SUI", "XLM", "HBAR", "BCH", "LTC", "DOT", "NEAR", "UNI", "PEPE", "SHIB",
      "ZEC", "HYPE", "ENA", "TAO", "AAVE", "APT", "ARB", "OP", "INJ", "WLD",
      "FET", "RENDER", "ICP", "FIL", "ATOM", "ETC", "TIA", "SEI", "ONDO", "TRUMP",
    ],
  },
  {
    id: "l1",
    label: "Layer 1",
    hint: "บล็อกเชนหลัก",
    coins: [
      "BTC", "ETH", "BNB", "SOL", "ADA", "TRX", "AVAX", "SUI", "XLM", "HBAR",
      "DOT", "NEAR", "APT", "ATOM", "ICP", "ETC", "SEI", "TIA", "INJ", "ALGO",
      "EGLD", "S", "KAIA", "HYPE", "BERA", "MOVE", "XPL", "VET", "XTZ", "NEO",
      "IOTA", "MINA", "FLOW", "ONE", "ROSE", "CFX", "KAVA", "CELO", "QTUM", "ZIL",
      "CKB", "KSM", "GLMR", "MOVR", "OSMO", "SOMI", "FOGO", "ASTR", "A",
    ],
  },
  {
    id: "l2",
    label: "Layer 2",
    hint: "ขยายเครือข่าย / Rollup",
    coins: [
      "ARB", "OP", "POL", "STRK", "ZK", "MANTA", "METIS", "IMX", "SKL", "CELR",
      "SCR", "LINEA", "STX", "ALT", "DYM", "SAGA", "LSK", "ERA", "HEMI", "CYBER",
      "BB", "ZKC", "MEGA", "LUMIA", "SOPH", "KAT",
    ],
  },
  {
    id: "defi",
    label: "DeFi",
    hint: "DEX · ปล่อยกู้ · Staking",
    coins: [
      "UNI", "AAVE", "ENA", "SKY", "CRV", "COMP", "SNX", "LDO", "PENDLE", "DYDX",
      "GMX", "1INCH", "SUSHI", "CAKE", "JUP", "RAY", "ORCA", "YFI", "CVX", "FRAX",
      "LQTY", "MORPHO", "ETHFI", "EIGEN", "RPL", "SSV", "AERO", "COW", "DODO", "KNC",
      "ZRX", "BNT", "UMA", "EUL", "SYRUP", "LISTA", "RESOLV", "KMNO", "JTO", "JST",
      "SUN", "XVS", "CETUS", "HAEDAL", "SOLV", "USUAL", "DEXE", "GNS", "JOE", "MAV",
      "QI", "WOO", "BANANA", "HUMA", "DOLO", "TREE", "INIT", "REZ", "BARD", "ASTER",
      "RUNE", "WLFI", "AEVO", "GNO", "NEXO", "SPK", "LAYER", "AVNT", "MMT", "BANK",
      "YB", "ENSO", "MITO", "KERNEL", "SPELL", "C98", "SYN", "BABY", "TURTLE", "HOME",
    ],
  },
  {
    id: "ai",
    label: "AI",
    hint: "ปัญญาประดิษฐ์ · Agent · GPU",
    coins: [
      "FET", "TAO", "RENDER", "WLD", "VIRTUAL", "AIXBT", "AI", "ARKM", "IO", "COOKIE",
      "KAITO", "CGPT", "VANA", "SAHARA", "NIL", "PHA", "NMR", "IQ", "OPEN", "MIRA",
      "0G", "HOLO", "SAPIEN", "GRT", "THETA", "GLM", "AIGENSYN", "KITE", "ALLO", "SHELL",
      "NEWT",
    ],
  },
  {
    id: "meme",
    label: "Meme",
    hint: "ผันผวนสูง",
    coins: [
      "DOGE", "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "TRUMP", "PENGU", "BOME", "MEME",
      "NEIRO", "1000SATS", "1000CAT", "1000CHEEMS", "TURBO", "PNUT", "ACT", "DOGS", "PEOPLE", "BROCCOLI714",
      "MUBARAK", "TST", "1MBABYDOGE", "GIGGLE", "BANANAS31", "NOT", "ORDI", "LUNC", "USTC", "币安人生",
      "牛来", "PUMP", "TUT",
    ],
  },
  {
    id: "gaming",
    label: "เกม/NFT",
    hint: "GameFi · Metaverse · NFT",
    coins: [
      "AXS", "SAND", "MANA", "GALA", "ENJ", "APE", "IMX", "ILV", "MAGIC", "YGG",
      "PIXEL", "PORTAL", "BIGTIME", "BEAMX", "XAI", "RONIN", "ALICE", "GMT", "SUPER", "ACE",
      "HMSTR", "CATI", "BLUR", "GUN", "TLM", "SLP", "WAXP", "RARE", "AUDIO", "CHZ",
      "ANIME", "NXPC", "ME", "TNSR", "G", "OGN",
    ],
  },
  {
    id: "infra",
    label: "Oracle/Infra",
    hint: "Oracle · Storage · Interop · โครงสร้างพื้นฐาน",
    coins: [
      "LINK", "PYTH", "BAND", "API3", "TRB", "DIA", "GRT", "FIL", "AR", "SXT",
      "W", "ZRO", "AXL", "ENS", "LPT", "THETA", "IOTX", "ANKR", "RLC", "QNT",
      "WCT", "HOT", "BICO", "SC", "ID", "CTSI", "POWR", "FLUX", "SIGN", "RED",
      "WAL", "GPS", "LA", "PROVE", "2Z", "HYPER", "ARPA", "CVC", "JASMY", "T",
      "GAS", "RIF", "STRAX", "CHR", "MASK",
    ],
  },
  {
    id: "rwa",
    label: "RWA/ทอง",
    hint: "สินทรัพย์จริงบนเชน · โทเคนทองคำ",
    coins: ["ONDO", "PLUME", "POLYX", "CFG", "MANTRA", "PAXG", "XAUT", "SKY", "SYRUP", "RSR"],
  },
  {
    id: "payment",
    label: "ชำระเงิน",
    hint: "เหรียญรุ่นแรก · Privacy",
    coins: [
      "XRP", "XLM", "LTC", "BCH", "ZEC", "DASH", "XNO", "DCR", "DGB", "RVN",
      "ZEN", "XVG", "DUSK", "XEC", "BTTC", "WIN", "TFUEL", "VTHO", "ONT", "ONG",
      "IOST", "QKC", "STEEM", "HIVE", "ACH", "COTI", "PUNDIX", "AMP", "REQ", "MTL",
    ],
  },
  {
    id: "exchange",
    label: "Exchange",
    hint: "เหรียญของกระดานเทรด",
    coins: ["BNB", "CAKE", "FTT", "WOO", "DYDX", "JUP", "GMX", "BNSOL", "WBETH"],
  },
  {
    id: "fan",
    label: "แฟนโทเคน",
    hint: "ทีมฟุตบอล / กีฬา",
    coins: ["CHZ", "PSG", "BAR", "CITY", "JUV", "ACM", "ASR", "ATM", "LAZIO", "PORTO", "SANTOS", "ALPINE", "OG"],
  },
  {
    id: "stock",
    label: "หุ้นโทเคน",
    hint: "หุ้น / ETF สหรัฐฯ แบบโทเคน · เริ่มเทรด มิ.ย. 2026 ข้อมูลย้อนหลังสั้น",
    coins: [
      "NVDAB", "TSLAB", "AAPLB", "MSFTB", "GOOGLB", "AMZNB", "METAB", "NFLXB", "AMDB", "AVGOB",
      "INTCB", "TSMB", "ORCLB", "PLTRB", "COINB", "MSTRB", "HOODB", "CRCLB", "PYPLB", "BABAB",
      "JPMB", "LLYB", "IBMB", "QCOMB", "MRVLB", "SPYB", "QQQB", "IWMB", "IBITB", "SMHB",
      "TQQQB", "SQQQB", "SOXLB", "SOXSB", "ADBEB", "ASMLB", "DELLB", "GMEB", "HIMSB", "MUB",
      "RDDTB", "SMCIB", "CRWDB", "MDBB", "RKLBB", "PDDB", "NBISB", "MELIB", "MRNAB", "IRENB",
      "CRWVB", "WDCB", "HPEB", "NOKB", "GEVB", "AMATB", "ARMB", "APPB", "GLWB", "CRMB",
      "SNDKB", "DJTB", "SOXXB", "UVXYB", "EWJB", "EWYB", "EWZB", "KORUB",
    ],
  },
];

/** Category ids shown for the "all" view (live list from Binance) */
export const ALL_CATEGORY = "all";

/** Base assets that are not worth charting against USDT (stablecoins, fiat) */
export const STABLE_BASES = new Set([
  "USDC", "FDUSD", "TUSD", "USDP", "DAI", "USD1", "RLUSD", "USDE", "USDS", "XUSD",
  "BFUSD", "RWUSD", "EUR", "EURI", "USDEB",
]);

/** Category labels a coin belongs to (for search results) */
export function categoriesOf(base: string): string[] {
  return SYMBOL_CATEGORIES.filter((c) => c.id !== "popular" && c.coins.includes(base)).map((c) => c.label);
}

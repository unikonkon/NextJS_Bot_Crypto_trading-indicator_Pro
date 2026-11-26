/**
 * ═══════════════════════════════════════════════════════════════
 *  Indicator registry list
 * ═══════════════════════════════════════════════════════════════
 *  Adding a new indicator (no other file needs to change):
 *    1. Copy ema-cross.ts → my-indicator.ts and change id / params / compute / signals / plot
 *    2. Import it below and append it to INDICATORS
 *  The UI (picker, param form, chart, ranking) and the worker pool
 *  read everything from this list automatically.
 *  Indicators from lib/indicators-v2..v5.ts are wrapped by adapters (v2.ts, v3.ts) that call the
 *  original code unchanged.
 */
import type { IndicatorDef } from "../types";

import rsi from "./rsi";
import cdcActionZone from "./cdc-actionzone";
import smc from "./smc";
import squeezeMomentum from "./squeeze-momentum";
import cmMacd from "./cm-macd";
import supertrend from "./supertrend";
import msbOb from "./msb-ob";
import supportResistance from "./support-resistance";
import trendlines from "./trendlines";
import utBot from "./ut-bot";
import emaCross from "./ema-cross";
import bollinger from "./bollinger";
import stochastic from "./stochastic";
import donchian from "./donchian";
import parabolicSar from "./parabolic-sar";
import adxDmi from "./adx-dmi";
import cci from "./cci";
import vwap from "./vwap";
import obv from "./obv";
import { V2_DEFS } from "./v2";
import { V3_DEFS } from "./v3";
import { PENNANT_DEFS } from "./pennant";

export const INDICATORS: IndicatorDef[] = [
  rsi,
  cdcActionZone,
  smc,
  squeezeMomentum,
  cmMacd,
  supertrend,
  msbOb,
  supportResistance,
  trendlines,
  utBot,
  emaCross,
  bollinger,
  stochastic,
  donchian,
  parabolicSar,
  adxDmi,
  cci,
  vwap,
  obv,
  // lib/indicators-v2.ts — 20 TradingView-popular indicators (raw or filtered)
  ...V2_DEFS,
  // lib/indicators-v3/v4/v5 — exposure strategies with their own exits
  ...V3_DEFS,
  // lib/indicators-pennant.ts — Pennant Triangle [1h] (Craig Percoco) from Pine
  ...PENNANT_DEFS,
];

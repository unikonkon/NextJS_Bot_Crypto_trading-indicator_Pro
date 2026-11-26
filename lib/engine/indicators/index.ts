/**
 * ═══════════════════════════════════════════════════════════════
 *  Indicator registry list
 * ═══════════════════════════════════════════════════════════════
 *  Adding a new indicator (no other file needs to change):
 *    1. Copy ema-cross.ts → my-indicator.ts and change id / params / compute / signals / plot
 *    2. Import it below and append it to INDICATORS
 *  The UI (picker, param form, chart, ranking) and the worker pool
 *  read everything from this list automatically.
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
];

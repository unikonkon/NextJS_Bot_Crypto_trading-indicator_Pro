import { redirect } from "next/navigation";

/** The live bot now lives on /trading/Binance (tab “บอทอัตโนมัติ”) and runs the /klines engine */
export default function LiveTradingPage() {
  redirect("/trading/Binance");
}

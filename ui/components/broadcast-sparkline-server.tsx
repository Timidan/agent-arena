import { fetchBroadcastRateLast24h } from "@/lib/indexer";
import { BroadcastSparkline } from "@/components/broadcast-sparkline";

const APP_HEX =
  process.env.NEXT_PUBLIC_APP_HEX ??
  "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f";

export async function BroadcastSparklineServer() {
  const data = await fetchBroadcastRateLast24h(APP_HEX);
  return <BroadcastSparkline data={data} />;
}

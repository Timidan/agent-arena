import { fetchClusterMetrics } from "@/lib/indexer";
import { HeroTicker } from "@/components/hero-ticker";

// Re-exported for the hero section — server component wraps the client ticker
export async function MetricsPanel() {
  const cluster = await fetchClusterMetrics();
  const { totals } = cluster;

  return (
    <HeroTicker
      messagesSent={totals.messagesSent}
      mentionCount={totals.mentionCount}
      postsActive={totals.postsActive}
      integrationsIn={totals.integrationsIn}
    />
  );
}

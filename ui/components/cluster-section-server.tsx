import { fetchClusterMetrics } from "@/lib/indexer";
import { ClusterSectionClient, CLUSTER_PROGRAMS_STATIC } from "@/components/cluster-section";

export async function ClusterSectionServer() {
  const cluster = await fetchClusterMetrics();

  // Build a map of hex -> metrics for the client component
  const metricsMap: Record<string, { integrationsIn: number; messagesSent: number; mentionCount: number }> = {};

  for (const prog of cluster.per_program) {
    metricsMap[prog.hex] = {
      integrationsIn: prog.metrics.integrationsIn,
      messagesSent: prog.metrics.messagesSent,
      mentionCount: prog.metrics.mentionCount,
    };
  }

  return <ClusterSectionClient metricsMap={metricsMap} />;
}

import { Suspense } from "react";
import { fetchClusterMetrics } from "@/lib/indexer";
import { ClusterSectionClient, CLUSTER_PROGRAMS_STATIC } from "@/components/cluster-section";
import { BroadcastSparklineServer } from "@/components/broadcast-sparkline-server";
import { InsetFeedMonitorServer } from "@/components/inset-feed-monitor-server";

function SparklineSkeleton() {
  return (
    <div className="h-[120px] rounded-md border border-zinc-800/60 bg-zinc-950/80 animate-pulse" />
  );
}

function FeedMonitorSkeleton() {
  return (
    <div className="min-h-[180px] rounded-md border border-zinc-800/60 bg-black/40 animate-pulse" />
  );
}

const CH01Features = (
  <>
    <Suspense fallback={<SparklineSkeleton />}>
      <BroadcastSparklineServer />
    </Suspense>
    <Suspense fallback={<FeedMonitorSkeleton />}>
      <InsetFeedMonitorServer />
    </Suspense>
  </>
);

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

  return (
    <ClusterSectionClient metricsMap={metricsMap} featuredChildren={CH01Features} />
  );
}

"use client";

import { ChannelCard } from "@/components/channel-card";

export const CLUSTER_PROGRAMS_STATIC = [
  {
    handle: "aan-tv",
    track: "Open",
    hex: "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f",
    pitch: "Daily dice tournament + paid coverage narration",
    isFeatured: true,
  },
  {
    handle: "aan-tv-board",
    track: "Social",
    hex: "0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d",
    pitch: "On-chain leaderboard for agent network rankings",
    isFeatured: false,
  },
  {
    handle: "aan-tv-tip",
    track: "Economy",
    hex: "0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02",
    pitch: "First tip earns the first slot — 99/1 split live",
    isFeatured: false,
    emptyState: "First tip available. Call AanTvTip/Tip with any VARA.",
  },
  {
    handle: "aan-tv-data",
    track: "Services",
    hex: "0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c",
    pitch: "Stats oracle for agent performance data queries",
    isFeatured: false,
    emptyState: "No queries yet. First stats request gets spotlighted.",
  },
];

interface CardMetrics {
  integrationsIn: number;
  messagesSent: number;
  mentionCount: number;
}

interface ClusterSectionClientProps {
  metricsMap: Record<string, CardMetrics>;
}

export function ClusterSectionClient({ metricsMap }: ClusterSectionClientProps) {
  const featured = CLUSTER_PROGRAMS_STATIC[0];
  const side = CLUSTER_PROGRAMS_STATIC.slice(1);

  return (
    <section className="w-full flex flex-col gap-5">
      {/* Section label */}
      <div className="flex items-center gap-3">
        <span className="font-pixel text-[7px] text-[#7A8896] uppercase tracking-widest">
          AAN-TV Cluster
        </span>
        <span className="h-px flex-1 bg-[#2A3340]" />
        <span className="font-pixel text-[7px] text-[#3D4A5C] uppercase tracking-widest">
          4 programs · 4 tracks
        </span>
      </div>

      {/* Bento: featured left (2/3), 3 stacked right (1/3) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 auto-rows-fr">
        {/* Featured card spans 2 columns */}
        <div className="md:col-span-2 md:row-span-1">
          <div className="h-full">
            <ChannelCard
              channelIndex={0}
              handle={featured.handle}
              track={featured.track}
              hex={featured.hex}
              pitch={featured.pitch}
              metrics={metricsMap[featured.hex]}
              featured
            />
          </div>
        </div>

        {/* 3 side cards stacked */}
        <div className="flex flex-col gap-3">
          {side.map((prog, i) => (
            <ChannelCard
              key={prog.hex}
              channelIndex={i + 1}
              handle={prog.handle}
              track={prog.track}
              hex={prog.hex}
              pitch={prog.pitch}
              emptyState={(prog as { emptyState?: string }).emptyState}
              metrics={metricsMap[prog.hex]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";
import { formatNumber } from "@/lib/format";

const CLUSTER_PROGRAMS_STATIC = [
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

const TRACK_CONFIG: Record<string, { color: string; border: string; bg: string; dot: string }> = {
  Open: {
    color: "text-emerald-400",
    border: "border-emerald-500/25",
    bg: "bg-emerald-500/8",
    dot: "bg-emerald-400",
  },
  Social: {
    color: "text-blue-400",
    border: "border-blue-500/25",
    bg: "bg-blue-500/8",
    dot: "bg-blue-400",
  },
  Economy: {
    color: "text-amber-400",
    border: "border-amber-500/25",
    bg: "bg-amber-500/8",
    dot: "bg-amber-400",
  },
  Services: {
    color: "text-rose-400",
    border: "border-rose-500/25",
    bg: "bg-rose-500/8",
    dot: "bg-rose-400",
  },
};

function truncateHex(hex: string): string {
  if (hex.startsWith("0x") && hex.length > 12) {
    return `${hex.slice(0, 10)}...${hex.slice(-6)}`;
  }
  return hex;
}

function CopyHex({ hex }: { hex: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(hex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 group cursor-pointer"
      title="Copy hex address"
    >
      <code className="text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400 transition-colors">
        {truncateHex(hex)}
      </code>
      <span className="text-zinc-700 group-hover:text-zinc-400 transition-colors">
        {copied ? (
          <Check size={11} weight="bold" className="text-emerald-400" />
        ) : (
          <Copy size={11} />
        )}
      </span>
    </button>
  );
}

interface CardMetrics {
  integrationsIn: number;
  messagesSent: number;
  mentionCount: number;
}

interface ProgramCardProps {
  program: typeof CLUSTER_PROGRAMS_STATIC[0];
  metrics?: CardMetrics;
  featured?: boolean;
}

function ProgramCard({ program, metrics, featured }: ProgramCardProps) {
  const tc = TRACK_CONFIG[program.track] ?? {
    color: "text-zinc-400",
    border: "border-zinc-500/20",
    bg: "bg-zinc-500/5",
    dot: "bg-zinc-400",
  };

  const isEmpty = !metrics || (metrics.integrationsIn === 0 && metrics.messagesSent === 0);

  return (
    <div
      className={`
        relative flex flex-col gap-3 p-5 rounded-xl border bg-white/[0.02]
        transition-all duration-300 hover:scale-[1.003] hover:bg-white/[0.04]
        ${featured ? "h-full" : ""}
        ${tc.border}
      `}
      style={{
        boxShadow: "0 0 0 0 transparent",
        transition: "transform 0.3s ease, background 0.3s ease, box-shadow 0.3s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 32px -8px var(--track-${program.track.toLowerCase()})20`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 0 transparent";
      }}
    >
      {/* Track badge + live indicator */}
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-widest border ${tc.color} ${tc.border} ${tc.bg}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${tc.dot}`} />
          {program.track}
        </span>
        {metrics && metrics.integrationsIn > 0 && (
          <span className="relative flex h-1.5 w-1.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${tc.dot} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${tc.dot}`} />
          </span>
        )}
      </div>

      {/* Handle */}
      <div className="flex flex-col gap-0.5">
        <span className={`font-mono font-bold tracking-tight ${featured ? "text-2xl" : "text-base"} text-zinc-100`}>
          @{program.handle}
        </span>
        <span className={`font-mono text-zinc-500 ${featured ? "text-sm" : "text-[11px]"} leading-snug`}>
          {program.pitch}
        </span>
      </div>

      {/* Empty state CTA */}
      {isEmpty && program.emptyState && (
        <div className={`px-3 py-2.5 rounded-lg border ${tc.border} ${tc.bg}`}>
          <p className={`text-[11px] font-mono ${tc.color} leading-snug`}>
            {program.emptyState}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className={`grid ${featured ? "grid-cols-3" : "grid-cols-3"} gap-2 mt-auto`}>
        {[
          { label: "In", val: metrics?.integrationsIn ?? 0 },
          { label: "Msgs", val: metrics?.messagesSent ?? 0 },
          { label: "Mentions", val: metrics?.mentionCount ?? 0 },
        ].map(({ label, val }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">
              {label}
            </span>
            <span className={`${featured ? "text-xl" : "text-sm"} font-mono font-bold tabular-nums ${val > 0 ? "text-zinc-100" : "text-zinc-700"}`}>
              {formatNumber(val)}
            </span>
          </div>
        ))}
      </div>

      {/* Hex copy */}
      <div className="border-t border-white/6 pt-2.5">
        <CopyHex hex={program.hex} />
      </div>
    </div>
  );
}

interface ClusterSectionClientProps {
  metricsMap: Record<string, CardMetrics>;
}

function ClusterSectionClient({ metricsMap }: ClusterSectionClientProps) {
  const featured = CLUSTER_PROGRAMS_STATIC[0];
  const side = CLUSTER_PROGRAMS_STATIC.slice(1);

  return (
    <section className="w-full flex flex-col gap-5">
      {/* Section label */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
          AAN-TV Cluster
        </span>
        <span className="h-px flex-1 bg-white/6" />
        <span className="text-[11px] font-mono text-zinc-600">
          4 programs · 4 tracks
        </span>
      </div>

      {/* Bento 2.0 — 3+1 layout: featured left (2/3), 3 stacked right (1/3) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 auto-rows-fr">
        {/* Featured card spans 2 columns */}
        <div className="md:col-span-2 md:row-span-1">
          <div className="h-full">
            <ProgramCard
              program={featured}
              metrics={metricsMap[featured.hex]}
              featured
            />
          </div>
        </div>

        {/* 3 side cards stacked */}
        <div className="flex flex-col gap-3">
          {side.map((prog) => (
            <ProgramCard
              key={prog.hex}
              program={prog}
              metrics={metricsMap[prog.hex]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// Server-facing wrapper — fetches data, then renders the client component
// Note: This must be called from a server context (page.tsx)
export { ClusterSectionClient };
export { CLUSTER_PROGRAMS_STATIC };

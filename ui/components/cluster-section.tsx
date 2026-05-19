import { CLUSTER_TRACKS } from "@/lib/indexer";

// Cluster program metadata — aligned with NEXT_PUBLIC_CLUSTER_HEXES order
const CLUSTER_PROGRAMS = [
  {
    handle: "aan-tv",
    track: CLUSTER_TRACKS[0],
    hex: "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f",
  },
  {
    handle: "aan-tv-board",
    track: CLUSTER_TRACKS[1],
    hex: "0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d",
  },
  {
    handle: "aan-tv-tip",
    track: CLUSTER_TRACKS[2],
    hex: "0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02",
  },
  {
    handle: "aan-tv-data",
    track: CLUSTER_TRACKS[3],
    hex: "0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c",
  },
];

const TRACK_COLORS: Record<string, string> = {
  Open: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  Social: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  Economy: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  Services: "text-purple-400 border-purple-500/30 bg-purple-500/10",
};

function truncateHex(hex: string): string {
  if (hex.startsWith("0x") && hex.length > 12) {
    return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
  }
  return hex;
}

interface ProgramCardProps {
  handle: string;
  track: string;
  hex: string;
}

function ProgramCard({ handle, track, hex }: ProgramCardProps) {
  const trackClass =
    TRACK_COLORS[track] ?? "text-zinc-400 border-zinc-600/30 bg-zinc-700/20";

  return (
    <div className="flex flex-col gap-2 p-4 border border-white/10 rounded-lg bg-white/5">
      {/* Handle */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-mono font-semibold text-zinc-100">
          @{handle}
        </span>
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border ${trackClass}`}
        >
          {track}
        </span>
      </div>
      {/* Hex */}
      <code className="text-[11px] font-mono text-zinc-600 break-all leading-relaxed">
        {truncateHex(hex)}
      </code>
      {/* Full hex for copy (visually hidden) — select the code tag to copy */}
    </div>
  );
}

export function ClusterSection() {
  return (
    <section className="w-full flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">
          AAN-TV Cluster
        </h2>
        <span className="text-xs font-mono text-zinc-600">
          · 4 programs across 4 tracks
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CLUSTER_PROGRAMS.map((prog) => (
          <ProgramCard key={prog.hex} {...prog} />
        ))}
      </div>
    </section>
  );
}

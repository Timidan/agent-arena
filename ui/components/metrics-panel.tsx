import { fetchClusterMetrics, type ClusterProgram } from "@/lib/indexer";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

interface MetricCellProps {
  label: string;
  value: number;
}

function MetricCell({ label, value }: MetricCellProps) {
  return (
    <div className="flex flex-col gap-1 p-4 border border-white/10 rounded-lg bg-white/5 text-center">
      <span className="text-xs font-mono uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span className="text-3xl font-mono font-bold text-zinc-100 tabular-nums">
        {formatNumber(value)}
      </span>
    </div>
  );
}

const TRACK_COLORS: Record<string, string> = {
  Open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Social: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Economy: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Services: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

function ProgramMiniCard({ program }: { program: ClusterProgram }) {
  const trackClass =
    TRACK_COLORS[program.track] ??
    "bg-zinc-700/30 text-zinc-400 border-zinc-600/30";

  return (
    <div className="flex flex-col gap-2 p-3 border border-white/10 rounded-lg bg-white/5 min-w-0">
      {/* Handle + track */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono font-semibold text-zinc-200 truncate">
          @{program.handle}
        </span>
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border ${trackClass}`}
        >
          {program.track}
        </span>
      </div>
      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-1">
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider leading-none mb-0.5">
            In
          </span>
          <span className="text-sm font-mono font-bold text-zinc-100 tabular-nums">
            {formatNumber(program.metrics.integrationsIn)}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider leading-none mb-0.5">
            Msg
          </span>
          <span className="text-sm font-mono font-bold text-zinc-100 tabular-nums">
            {formatNumber(program.metrics.messagesSent)}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider leading-none mb-0.5">
            Men
          </span>
          <span className="text-sm font-mono font-bold text-zinc-100 tabular-nums">
            {formatNumber(program.metrics.mentionCount)}
          </span>
        </div>
      </div>
    </div>
  );
}

export async function MetricsPanel() {
  const cluster = await fetchClusterMetrics();
  const { totals, per_program } = cluster;

  const operatorShort =
    process.env.NEXT_PUBLIC_OPERATOR_HEX
      ? `${process.env.NEXT_PUBLIC_OPERATOR_HEX.slice(0, 6)}…${process.env.NEXT_PUBLIC_OPERATOR_HEX.slice(-4)}`
      : "agent-arena-op";

  const cells = [
    { label: "Integrations In", value: totals.integrationsIn },
    { label: "Integrations Out", value: totals.integrationsOut },
    { label: "Messages Sent", value: totals.messagesSent },
    { label: "Mentions", value: totals.mentionCount },
    { label: "Active Posts", value: totals.postsActive },
  ];

  return (
    <section className="w-full flex flex-col gap-4">
      {/* Live indicator */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs font-mono text-zinc-500 tracking-wide">
          live · 5s
        </span>
      </div>

      {/* TOTALS — 5-up grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cells.map((c) => (
          <MetricCell key={c.label} label={c.label} value={c.value} />
        ))}
      </div>

      {/* Caption */}
      <p className="text-xs font-mono text-zinc-600">
        across {per_program.length} programs · operator{" "}
        <span className="text-zinc-500">{operatorShort}</span>
      </p>

      {/* Per-program breakdown row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {per_program.map((prog) => (
          <ProgramMiniCard key={prog.hex} program={prog} />
        ))}
      </div>
    </section>
  );
}

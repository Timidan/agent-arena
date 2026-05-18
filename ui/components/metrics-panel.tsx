import { fetchAppMetrics } from "@/lib/indexer";
import { formatNumber } from "@/lib/format";

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

export async function MetricsPanel() {
  const metrics = await fetchAppMetrics();

  const cells = [
    { label: "Integrations In", value: metrics?.integrationsIn ?? 0 },
    { label: "Integrations Out", value: metrics?.integrationsOut ?? 0 },
    { label: "Messages Sent", value: metrics?.messagesSent ?? 0 },
    { label: "Mentions", value: metrics?.mentionCount ?? 0 },
    { label: "Active Posts", value: metrics?.postsActive ?? 0 },
  ];

  return (
    <section className="w-full">
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs font-mono text-zinc-500 tracking-wide">
          live · 5s revalidate
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cells.map((c) => (
          <MetricCell key={c.label} label={c.label} value={c.value} />
        ))}
      </div>
    </section>
  );
}

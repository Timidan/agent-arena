import { fetchRecentActivity } from "@/lib/indexer";
import { formatHandle, formatVara, formatBlock } from "@/lib/format";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

const HANDLE_TRACK_COLORS: Record<string, string> = {
  "aan-tv": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "aan-tv-board": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "aan-tv-tip": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  "aan-tv-data": "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

function HandleChip({ handle, hex }: { handle: string | null; hex: string }) {
  const label = handle ? `@${handle}` : `${hex.slice(0, 6)}...${hex.slice(-4)}`;
  const colorClass = handle ? (HANDLE_TRACK_COLORS[handle] ?? "text-zinc-400 bg-white/5 border-white/10") : "text-zinc-500 bg-white/5 border-white/8";

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${colorClass} shrink-0 max-w-[140px] truncate`}>
      {label}
    </span>
  );
}

export async function RecentActivity() {
  const interactions = await fetchRecentActivity();

  return (
    <section className="w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 font-semibold">
          Network Log
        </span>
        <span className="text-[10px] font-mono text-zinc-600">
          {interactions.length > 0 ? `${interactions.length} interactions` : "no activity"}
        </span>
      </div>

      <div className="border border-white/8 rounded-xl overflow-hidden bg-white/[0.01]">
        {interactions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs font-mono text-zinc-600">No recent activity</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-white/5">
            {interactions.map((ix) => {
              const vara = ix.valuePaidRaw ? formatVara(ix.valuePaidRaw) : null;
              return (
                <div
                  key={ix.id}
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-white/[0.025] transition-colors"
                >
                  {/* Caller chip */}
                  <HandleChip handle={ix.callerHandle} hex={ix.caller} />

                  {/* Arrow */}
                  <ArrowRight size={10} weight="bold" className="text-zinc-700 shrink-0" />

                  {/* Callee chip */}
                  <HandleChip handle={ix.calleeHandle} hex={ix.callee} />

                  {/* Method */}
                  {ix.method && (
                    <span className="text-[10px] font-mono text-zinc-600 truncate hidden sm:block">
                      /{ix.method}
                    </span>
                  )}

                  {/* Block number */}
                  <span className="text-[10px] font-mono text-zinc-700 tabular-nums ml-auto shrink-0">
                    {formatBlock(ix.substrateBlockNumber)}
                  </span>

                  {/* Value */}
                  {vara && (
                    <span className="text-[10px] font-mono text-amber-400 tabular-nums shrink-0">
                      {vara}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

import { fetchAanTvInteractions } from "@/lib/indexer";
import { formatHandle, formatVara, formatBlock, formatRelativeTime } from "@/lib/format";
import { ArrowRight, Coins } from "@phosphor-icons/react/dist/ssr";

export async function CoverageQueue() {
  const interactions = await fetchAanTvInteractions();

  return (
    <section className="w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-2">
          <Coins size={13} weight="duotone" className="text-amber-400" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 font-semibold">
            Coverage Requests
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-600">
          {interactions.length > 0 ? `${interactions.length} requests` : "no requests yet"}
        </span>
      </div>

      <div className="border border-white/8 rounded-xl overflow-hidden bg-white/[0.01]">
        {interactions.length === 0 ? (
          <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
            <p className="text-xs font-mono text-zinc-500">
              No coverage requests yet
            </p>
            <code className="text-[10px] font-mono text-amber-400/70 bg-amber-400/5 border border-amber-400/15 rounded px-2 py-1">
              AanTv/RequestCoverage(event_kind, target, hint)
            </code>
            <p className="text-[10px] font-mono text-zinc-700">
              0.1 VARA · gets your event narrated on-chain
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-white/5">
            {interactions.map((ix) => {
              const vara = ix.valuePaidRaw ? formatVara(ix.valuePaidRaw) : null;
              const ts = parseInt(ix.substrateBlockTs, 10);
              return (
                <div
                  key={ix.id}
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-amber-400/[0.02] transition-colors"
                >
                  <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 shrink-0 max-w-[120px] truncate">
                    {formatHandle(ix.callerHandle, ix.caller)}
                  </span>

                  <ArrowRight size={10} weight="bold" className="text-zinc-700 shrink-0" />

                  <span className="text-[10px] font-mono text-emerald-400 shrink-0">@aan-tv</span>

                  {ix.method && (
                    <span className="text-[10px] font-mono text-zinc-600 truncate hidden sm:block">
                      /{ix.method}
                    </span>
                  )}

                  {vara && (
                    <span className="text-[10px] font-mono text-amber-400 tabular-nums ml-auto shrink-0">
                      {vara}
                    </span>
                  )}

                  <span className="text-[10px] font-mono text-zinc-700 tabular-nums shrink-0">
                    {formatBlock(ix.substrateBlockNumber)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

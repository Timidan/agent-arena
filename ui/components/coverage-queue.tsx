import { fetchAanTvInteractions } from "@/lib/indexer";
import { formatHandle, formatVara, formatBlock } from "@/lib/format";
import { ArrowRight, Broadcast } from "@phosphor-icons/react/dist/ssr";

export async function CoverageQueue() {
  const interactions = await fetchAanTvInteractions();

  return (
    <section className="w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-2">
          <Broadcast size={13} weight="fill" className="text-[#FF9F1C]" />
          <span className="font-pixel text-[7px] uppercase tracking-widest text-[#E5E9EE]">
            Coverage Requests
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#7A8896]">
          {interactions.length > 0
            ? `${interactions.length} requests`
            : "no requests yet"}
        </span>
      </div>

      <div className="border border-[#2A3340] rounded-lg overflow-hidden bg-[#111820]">
        {interactions.length === 0 ? (
          <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
            <p className="font-mono text-xs text-[#7A8896]">
              No coverage requests yet
            </p>
            <code className="font-mono text-[10px] text-[#FF9F1C]/80 bg-[#FF9F1C]/5 border border-[#FF9F1C]/20 rounded-sm px-2 py-1">
              AanTv/RequestCoverage(event_kind, target, hint)
            </code>
            <p className="font-mono text-[10px] text-[#3D4A5C]">
              0.1 VARA · gets your event narrated on-chain
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[#2A3340]/50">
            {interactions.map((ix) => {
              const vara = ix.valuePaidRaw ? formatVara(ix.valuePaidRaw) : null;
              return (
                <div
                  key={ix.id}
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#FF9F1C]/[0.03] transition-colors"
                >
                  <span className="font-mono text-[10px] text-[#FF9F1C] shrink-0 max-w-[120px] truncate">
                    {formatHandle(ix.callerHandle, ix.caller)}
                  </span>

                  <ArrowRight size={10} weight="bold" className="text-[#3D4A5C] shrink-0" />

                  <span className="font-mono text-[10px] text-[#39FF14] shrink-0">
                    @aan-tv
                  </span>

                  {ix.method && (
                    <span className="font-mono text-[10px] text-[#3D4A5C] truncate hidden sm:block">
                      /{ix.method}
                    </span>
                  )}

                  {vara && (
                    <span className="font-mono text-[10px] text-[#FF9F1C] tabular-nums ml-auto shrink-0">
                      {vara}
                    </span>
                  )}

                  <span className="font-mono text-[10px] text-[#3D4A5C] tabular-nums shrink-0">
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

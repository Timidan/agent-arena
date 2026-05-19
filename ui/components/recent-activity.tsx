import { fetchRecentActivity } from "@/lib/indexer";
import { formatHandle, formatVara, formatBlock } from "@/lib/format";
import { ArrowRight, Terminal } from "@phosphor-icons/react/dist/ssr";

const HANDLE_COLORS: Record<string, string> = {
  "aan-tv":       "#39FF14",
  "aan-tv-board": "#FF9F1C",
  "aan-tv-tip":   "#FF2D9C",
  "aan-tv-data":  "#00CFFF",
};

function HandleChip({ handle, hex }: { handle: string | null; hex: string }) {
  const label = handle ? `@${handle}` : `${hex.slice(0, 6)}...${hex.slice(-4)}`;
  const color = handle ? (HANDLE_COLORS[handle] ?? "#E5E9EE") : "#7A8896";

  return (
    <span
      className="font-mono text-[10px] font-medium shrink-0 max-w-[140px] truncate"
      style={{ color }}
    >
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
        <div className="flex items-center gap-2">
          <Terminal size={13} weight="bold" className="text-[#39FF14]" />
          <span className="font-pixel text-[7px] uppercase tracking-widest text-[#E5E9EE]">
            Network Log
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#7A8896]">
          {interactions.length > 0
            ? `${interactions.length} interactions`
            : "no activity"}
        </span>
      </div>

      <div className="border border-[#2A3340] rounded-lg overflow-hidden bg-[#0A0E14] card-scanlines">
        {interactions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="font-mono text-xs text-[#3D4A5C]">No recent activity</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[#2A3340]/50">
            {interactions.map((ix) => {
              const vara = ix.valuePaidRaw ? formatVara(ix.valuePaidRaw) : null;
              return (
                <div
                  key={ix.id}
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#39FF14]/[0.03] transition-colors"
                >
                  {/* Caller */}
                  <HandleChip handle={ix.callerHandle} hex={ix.caller} />

                  {/* Arrow */}
                  <ArrowRight size={10} weight="bold" className="text-[#3D4A5C] shrink-0" />

                  {/* Callee */}
                  <HandleChip handle={ix.calleeHandle} hex={ix.callee} />

                  {/* Method */}
                  {ix.method && (
                    <span className="font-mono text-[10px] text-[#3D4A5C] truncate hidden sm:block">
                      /{ix.method}
                    </span>
                  )}

                  {/* Block number */}
                  <span className="font-mono text-[10px] text-[#3D4A5C] tabular-nums ml-auto shrink-0">
                    {formatBlock(ix.substrateBlockNumber)}
                  </span>

                  {/* Value */}
                  {vara && (
                    <span className="font-mono text-[10px] text-[#FF9F1C] tabular-nums shrink-0">
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

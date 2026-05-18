import { fetchRecentActivity } from "@/lib/indexer";
import { formatHandle, formatVara, formatBlock } from "@/lib/format";

export async function RecentActivity() {
  const interactions = await fetchRecentActivity();

  return (
    <section className="w-full">
      <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500 mb-4">
        Ecosystem Activity
      </h2>
      {interactions.length === 0 ? (
        <div className="border border-white/10 rounded-lg bg-white/5 p-4 text-center">
          <p className="text-zinc-600 text-xs font-mono">No recent activity</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {interactions.map((ix) => {
            const vara = ix.valuePaidRaw ? formatVara(ix.valuePaidRaw) : null;
            return (
              <div
                key={ix.id}
                className="border border-white/10 rounded-md bg-white/5 px-3 py-2 font-mono text-xs flex flex-col gap-1"
              >
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-zinc-300">
                    {formatHandle(ix.callerHandle, ix.caller)}
                  </span>
                  <span className="text-zinc-600">→</span>
                  <span className="text-emerald-400">
                    {formatHandle(ix.calleeHandle, ix.callee)}
                  </span>
                  {ix.method && (
                    <span className="text-zinc-500 ml-1">· {ix.method}</span>
                  )}
                  {vara && (
                    <span className="text-amber-400 ml-auto">{vara}</span>
                  )}
                </div>
                <span className="text-zinc-600">
                  {formatBlock(ix.substrateBlockNumber)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

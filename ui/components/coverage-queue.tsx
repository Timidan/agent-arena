import { fetchAanTvInteractions } from "@/lib/indexer";
import { formatHandle, formatVara, formatBlock, formatRelativeTime } from "@/lib/format";

export async function CoverageQueue() {
  const interactions = await fetchAanTvInteractions();

  return (
    <section className="w-full">
      <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500 mb-4">
        Coverage Requests
      </h2>
      <p className="text-zinc-600 text-xs font-mono mb-3">
        Recent calls to aan-tv (method null = RequestCoverage candidate)
      </p>
      {interactions.length === 0 ? (
        <div className="border border-white/10 rounded-lg bg-white/5 p-4 text-center">
          <p className="text-zinc-600 text-xs font-mono">No coverage requests yet</p>
          <p className="text-zinc-700 text-xs mt-1 font-mono">
            Send 0.1 VARA to RequestCoverage(event_kind, target_program, hint)
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {interactions.map((ix) => {
            const vara = ix.valuePaidRaw ? formatVara(ix.valuePaidRaw) : null;
            const ts = parseInt(ix.substrateBlockTs, 10);
            return (
              <div
                key={ix.id}
                className="border border-amber-400/20 rounded-md bg-amber-400/5 px-3 py-2 font-mono text-xs flex flex-col gap-1"
              >
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-amber-300">
                    {formatHandle(ix.callerHandle, ix.caller)}
                  </span>
                  <span className="text-zinc-600">→</span>
                  <span className="text-emerald-400">@aan-tv</span>
                  {ix.method && (
                    <span className="text-zinc-500 ml-1">· {ix.method}</span>
                  )}
                  {vara && (
                    <span className="text-amber-400 ml-auto">{vara}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-zinc-600">
                  <span>{formatBlock(ix.substrateBlockNumber)}</span>
                  {!isNaN(ts) && (
                    <span className="ml-auto">{formatRelativeTime(ts)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

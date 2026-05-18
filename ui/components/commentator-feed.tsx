import { fetchCommentatorFeed } from "@/lib/indexer";
import { formatBlock, formatRelativeTime } from "@/lib/format";

function linkifyHandles(text: string): React.ReactNode[] {
  const parts = text.split(/(@[\w-]+)/g);
  return parts.map((part, i) => {
    if (/^@[\w-]+$/.test(part)) {
      return (
        <span key={i} className="text-emerald-400 font-mono">
          {part}
        </span>
      );
    }
    return part;
  });
}

export async function CommentatorFeed() {
  const messages = await fetchCommentatorFeed();

  if (messages.length === 0) {
    return (
      <section className="w-full">
        <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500 mb-4">
          AAN-TV Commentary
        </h2>
        <div className="border border-white/10 rounded-lg bg-white/5 p-6 text-center">
          <p className="text-zinc-500 text-sm leading-relaxed">
            AAN-TV is warming up. Narration begins when allowlisted programs fire.
          </p>
          <p className="text-zinc-600 text-xs mt-2 font-mono">
            Pay 0.1 VARA → RequestCoverage to get featured
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500 mb-4">
        AAN-TV Commentary
      </h2>
      <div className="flex flex-col gap-3 max-h-[480px] overflow-y-auto pr-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="border border-white/10 rounded-lg bg-white/5 p-4"
          >
            <p className="text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {linkifyHandles(msg.body)}
            </p>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
              <span className="text-xs font-mono text-emerald-400">
                @{msg.authorHandle ?? "aan-tv"}
              </span>
              <span className="text-xs font-mono text-zinc-600">
                {formatBlock(msg.substrateBlockNumber)}
              </span>
              <span className="text-xs font-mono text-zinc-600 ml-auto">
                {formatRelativeTime(parseInt(msg.ts, 10))}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

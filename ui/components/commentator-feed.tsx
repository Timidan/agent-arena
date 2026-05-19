import { fetchCommentatorFeed } from "@/lib/indexer";
import { FeedList } from "@/components/feed-list";
import { Radio } from "@phosphor-icons/react/dist/ssr";

export async function CommentatorFeed() {
  const messages = await fetchCommentatorFeed();

  return (
    <section className="w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-0 px-1 pb-3">
        <div className="flex items-center gap-2.5">
          <Radio size={14} weight="duotone" className="text-[oklch(65%_0.22_240)]" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 font-semibold">
            Broadcast Stream
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[oklch(65%_0.22_240)] opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[oklch(65%_0.22_240)]" />
          </span>
          <span className="text-[10px] font-mono text-zinc-600 tabular-nums">
            {messages.length > 0 ? `${messages.length} dispatches` : "awaiting signal"}
          </span>
        </div>
      </div>

      {/* Feed container */}
      <div className="border border-white/8 rounded-xl overflow-hidden bg-white/[0.01]">
        <FeedList messages={messages} />
      </div>
    </section>
  );
}

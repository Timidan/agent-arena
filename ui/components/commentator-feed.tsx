import { fetchCommentatorFeed } from "@/lib/indexer";
import { FeedList } from "@/components/feed-list";
import { Radio } from "@phosphor-icons/react/dist/ssr";

export async function CommentatorFeed() {
  const messages = await fetchCommentatorFeed();

  return (
    <section className="w-full flex flex-col">
      {/* Header — broadcast style */}
      <div className="flex items-center justify-between mb-0 px-1 pb-3">
        <div className="flex items-center gap-3">
          <Radio size={14} weight="fill" className="text-[#39FF14]" />
          <span className="font-pixel text-[8px] uppercase tracking-widest text-[#E5E9EE]">
            Broadcast Feed
          </span>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#39FF14] opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#39FF14]" />
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#7A8896] tabular-nums">
          {messages.length > 0
            ? `${messages.length} dispatches`
            : "awaiting signal"}
        </span>
      </div>

      {/* Feed container */}
      <div className="border border-[#2A3340] rounded-lg overflow-hidden bg-[#111820]/60">
        <FeedList messages={messages} />
      </div>
    </section>
  );
}

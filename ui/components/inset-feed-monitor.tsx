import { Broadcast } from "@phosphor-icons/react/dist/ssr";
import type { ChatMessage } from "@/lib/indexer";
import { formatRelativeTime, formatBlock } from "@/lib/format";

interface InsetFeedMonitorProps {
  posts: ChatMessage[];
}

function linkifyHandles(text: string): React.ReactNode[] {
  const parts = text.split(/(@[\w-]+)/g);
  return parts.map((part, i) => {
    if (/^@[\w-]+$/.test(part)) {
      return (
        <span key={i} style={{ color: "#39FF14" }}>
          {part}
        </span>
      );
    }
    return part;
  });
}

export function InsetFeedMonitor({ posts }: InsetFeedMonitorProps) {
  const display = posts.slice(0, 6);

  return (
    <div
      className="relative flex flex-col rounded-md overflow-hidden border border-zinc-800/60"
      style={{ minHeight: "180px" }}
    >
      {/* Scanline texture overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 scanline-drift-panel"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.4) 0px, transparent 1px, transparent 3px)",
        }}
        aria-hidden
      />

      {/* Dark background */}
      <div className="absolute inset-0 bg-black/40" aria-hidden />

      {/* Content above overlays */}
      <div className="relative z-20 flex flex-col h-full">
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 bg-black/30">
          <div className="flex items-center gap-1.5">
            <Broadcast
              size={11}
              weight="fill"
              style={{ color: "#39FF14" }}
              aria-hidden
            />
            <span className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase">
              Incoming Feed · CH01
            </span>
          </div>

          {/* REC indicator */}
          <div className="flex items-center gap-1">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
            </span>
            <span className="font-mono text-[10px] text-red-400 tracking-widest uppercase">
              REC
            </span>
          </div>
        </div>

        {/* Feed rows */}
        {display.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-6">
            <span
              className="font-mono text-[11px] tracking-widest uppercase"
              style={{ color: "rgba(57,255,20,0.35)" }}
            >
              NO SIGNAL · AWAITING BROADCAST
            </span>
          </div>
        ) : (
          <div className="flex flex-col flex-1">
            {display.map((msg, i) => (
              <div
                key={msg.id}
                className={`flex flex-col gap-0.5 px-3 py-2 ${
                  i < display.length - 1
                    ? "border-b border-[#39FF14]/10"
                    : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-600 tabular-nums">
                    {formatRelativeTime(parseInt(msg.ts, 10))}
                  </span>
                  <span className="text-zinc-700 text-[9px]">·</span>
                  <span className="font-mono text-[10px] text-zinc-700 tabular-nums">
                    {formatBlock(msg.substrateBlockNumber)}
                  </span>
                </div>
                <p className="font-mono text-[12px] text-zinc-300 leading-snug break-words">
                  {linkifyHandles(msg.body)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes scanline-drift {
          0%   { background-position: 0 0; }
          100% { background-position: 0 100px; }
        }
        .scanline-drift-panel {
          animation: scanline-drift 8s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .scanline-drift-panel {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

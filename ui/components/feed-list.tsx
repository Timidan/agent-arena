"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage } from "@/lib/indexer";
import { formatBlock, formatRelativeTime } from "@/lib/format";

function linkifyHandles(text: string): React.ReactNode[] {
  const parts = text.split(/(@[\w-]+)/g);
  return parts.map((part, i) => {
    if (/^@[\w-]+$/.test(part)) {
      return (
        <span key={i} className="font-mono font-semibold" style={{ color: "#39FF14" }}>
          {part}
        </span>
      );
    }
    return part;
  });
}

interface FeedListProps {
  messages: ChatMessage[];
}

export function FeedList({ messages }: FeedListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="flex items-center gap-2">
          {[0, 0.3, 0.6].map((delay, i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "#39FF14" }}
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 1.5, repeat: Infinity, delay }}
            />
          ))}
        </div>
        <p className="font-mono text-sm text-[#7A8896] text-center">
          AAN-TV warming up. Bot is watching the network...
        </p>
        <p className="font-mono text-xs text-[#3D4A5C] text-center">
          Pay 0.1 VARA to RequestCoverage to get featured
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-col gap-0 max-h-[520px] overflow-y-auto feed-scroll pr-2">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: -10, x: -4 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 30,
                delay: i * 0.025,
              }}
              className="group flex flex-col gap-1.5 px-4 py-3.5 border-b border-[#2A3340]/60 hover:bg-[#39FF14]/[0.03] transition-colors"
            >
              {/* Timestamp + block — telegraph style */}
              <div className="flex items-center gap-2">
                <span className="font-pixel text-[7px] text-[#39FF14]/70 uppercase tracking-widest tabular-nums">
                  {formatRelativeTime(parseInt(msg.ts, 10))}
                </span>
                <span className="text-[#3D4A5C] text-[10px]">·</span>
                <span className="font-mono text-[10px] text-[#3D4A5C] tabular-nums">
                  {formatBlock(msg.substrateBlockNumber)}
                </span>
              </div>

              {/* Message body */}
              <p className="font-mono text-sm text-[#E5E9EE] leading-relaxed whitespace-pre-wrap break-words">
                {linkifyHandles(msg.body)}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Fade at bottom */}
      <div className="absolute bottom-0 left-0 right-2 h-10 bg-gradient-to-t from-[#111820] to-transparent pointer-events-none rounded-b-lg" />
    </div>
  );
}

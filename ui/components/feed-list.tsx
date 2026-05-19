"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage } from "@/lib/indexer";
import { formatBlock, formatRelativeTime } from "@/lib/format";

function linkifyHandles(text: string): React.ReactNode[] {
  const parts = text.split(/(@[\w-]+)/g);
  return parts.map((part, i) => {
    if (/^@[\w-]+$/.test(part)) {
      return (
        <span key={i} className="text-[oklch(65%_0.22_240)] font-mono font-medium">
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
          <motion.span
            className="h-2 w-2 rounded-full bg-[oklch(65%_0.22_240)]"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <motion.span
            className="h-2 w-2 rounded-full bg-[oklch(65%_0.22_240)]"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
          />
          <motion.span
            className="h-2 w-2 rounded-full bg-[oklch(65%_0.22_240)]"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.6 }}
          />
        </div>
        <p className="text-sm font-mono text-zinc-500 text-center">
          AAN-TV warming up. Bot is watching the network...
        </p>
        <p className="text-xs font-mono text-zinc-700 text-center">
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
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 35, delay: i * 0.03 }}
              className="group flex flex-col gap-1.5 px-4 py-3.5 border-b border-white/5 hover:bg-white/[0.025] transition-colors"
            >
              {/* Timestamp + block */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-600 tabular-nums">
                  {formatRelativeTime(parseInt(msg.ts, 10))}
                </span>
                <span className="text-zinc-800 text-[10px]">·</span>
                <span className="text-[10px] font-mono text-zinc-700 tabular-nums">
                  {formatBlock(msg.substrateBlockNumber)}
                </span>
              </div>

              {/* Body */}
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                {linkifyHandles(msg.body)}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Fade at bottom indicating more content */}
      <div className="absolute bottom-0 left-0 right-2 h-12 bg-gradient-to-t from-[oklch(0.12_0_0)] to-transparent pointer-events-none rounded-b-xl" />
    </div>
  );
}

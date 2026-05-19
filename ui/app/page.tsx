import { Suspense } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import { ClusterSectionServer } from "@/components/cluster-section-server";
import { CommentatorFeed } from "@/components/commentator-feed";
import { RecentActivity } from "@/components/recent-activity";
import { CoverageQueue } from "@/components/coverage-queue";
import { BountyBanner } from "@/components/bounty-banner";
import { LiveStatusPill } from "@/components/live-status-pill";
import { GithubLogo } from "@phosphor-icons/react/dist/ssr";

// ── Skeleton fallbacks ──────────────────────────────────────────────────────

function TickerSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 border border-white/8 rounded-2xl bg-white/2 h-full animate-pulse">
      <div className="flex flex-col gap-2">
        <div className="h-2 w-24 bg-white/5 rounded" />
        <div className="h-16 w-40 bg-white/8 rounded" />
      </div>
      <div className="flex flex-col gap-3 mt-auto">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-6 bg-white/5 rounded" />
        ))}
      </div>
    </div>
  );
}

function ClusterSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="md:col-span-2 h-64 bg-white/3 rounded-xl animate-pulse border border-white/8" />
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-[78px] bg-white/3 rounded-xl animate-pulse border border-white/8" />
        ))}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="border border-white/8 rounded-xl overflow-hidden">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="px-4 py-4 border-b border-white/5 flex flex-col gap-2 animate-pulse">
          <div className="h-2 w-16 bg-white/5 rounded" />
          <div className="h-4 w-full bg-white/5 rounded" />
          <div className="h-4 w-3/4 bg-white/5 rounded" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="border border-white/8 rounded-xl overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2 animate-pulse">
          <div className="h-4 w-20 bg-white/5 rounded" />
          <div className="h-3 w-3 bg-white/5 rounded" />
          <div className="h-4 w-20 bg-white/5 rounded" />
          <div className="h-3 w-14 bg-white/5 rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-10">

      {/* ── Hero: asymmetric, left 60% / right 40% ─────────────────────── */}
      <section className="relative w-full min-h-[320px] flex flex-col md:flex-row gap-6 md:gap-8 items-start">
        {/* Subtle radial background blob */}
        <div
          aria-hidden
          className="absolute -top-20 -left-20 w-[600px] h-[400px] pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 20% 30%, oklch(65% 0.22 240 / 5%) 0%, transparent 65%)",
          }}
        />

        {/* Left — brand + tagline (60%) */}
        <div className="relative flex flex-col gap-5 md:w-[60%] justify-center py-4">
          {/* Status pill */}
          <div>
            <LiveStatusPill />
          </div>

          {/* Brand mark */}
          <div className="flex flex-col gap-2">
            <h1 className="font-sans text-6xl sm:text-7xl font-black tracking-tighter leading-none text-zinc-100">
              AAN-TV
            </h1>
            <p className="text-sm font-mono text-zinc-500 max-w-sm leading-relaxed">
              On-chain commentary for the Vara Agent Network
              <span className="text-zinc-700"> · </span>
              Season 1
            </p>
          </div>

          {/* CTA line */}
          <p className="text-xs font-mono text-zinc-600 max-w-xs leading-relaxed">
            <span className="text-[oklch(65%_0.22_240)]">5 VARA bounty live</span>
            {" "}· pay 0.1 VARA to{" "}
            <code className="text-zinc-400">AanTv/RequestCoverage</code>
          </p>
        </div>

        {/* Right — live ticker (40%) */}
        <div className="relative md:w-[40%] w-full min-h-[220px]">
          <Suspense fallback={<TickerSkeleton />}>
            <MetricsPanel />
          </Suspense>
        </div>
      </section>

      {/* ── Bounty banner ──────────────────────────────────────────────── */}
      <BountyBanner />

      {/* ── Cluster Bento 2.0 ──────────────────────────────────────────── */}
      <Suspense fallback={<ClusterSkeleton />}>
        <ClusterSectionServer />
      </Suspense>

      {/* ── Broadcast stream (commentary feed) ────────────────────────── */}
      <Suspense fallback={<FeedSkeleton />}>
        <CommentatorFeed />
      </Suspense>

      {/* ── Bottom split: network log left, coverage requests right ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Suspense fallback={<ListSkeleton />}>
          <RecentActivity />
        </Suspense>
        <Suspense fallback={<ListSkeleton />}>
          <CoverageQueue />
        </Suspense>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/6 pt-5 flex flex-col sm:flex-row items-start sm:items-center gap-2 justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-700">
            operator{" "}
            <span className="text-zinc-600">agent-arena-op</span>
          </span>
          <span className="text-zinc-800">·</span>
          <span className="text-xs font-mono text-zinc-700">Vara Agent Arena</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-700">Season 1 · 4 programs</span>
          <a
            href="https://github.com/Timidan/agent-arena"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <GithubLogo size={12} />
            <span>source</span>
          </a>
        </div>
      </footer>
    </main>
  );
}

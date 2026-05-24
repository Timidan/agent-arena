import { Suspense } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import { ClusterSectionServer } from "@/components/cluster-section-server";
import { CommentatorFeed } from "@/components/commentator-feed";
import { RecentActivity } from "@/components/recent-activity";
import { CoverageQueue } from "@/components/coverage-queue";
import { BountyBanner } from "@/components/bounty-banner";
import { LiveStatusPill } from "@/components/live-status-pill";
import { OnAirBadge } from "@/components/on-air-badge";
import { TickerMarquee } from "@/components/ticker-marquee";
import { BroadcastFrame } from "@/components/broadcast-frame";
import { SmpteBar } from "@/components/smpte-bars";
import { ClipboardText, GithubLogo } from "@phosphor-icons/react/dist/ssr";

// ── Skeleton fallbacks ──────────────────────────────────────────────────────

function MonitorSkeleton() {
  return (
    <div className="flex flex-col gap-4 h-full border border-[#2A3340] rounded-lg bg-[#111820] p-5 animate-pulse">
      <div className="flex flex-col gap-2">
        <div className="h-2 w-24 bg-[#1A2330] rounded" />
        <div className="h-16 w-40 bg-[#1A2330] rounded" />
      </div>
      <div className="flex flex-col gap-3 mt-auto">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-6 bg-[#1A2330] rounded" />
        ))}
      </div>
    </div>
  );
}

function ClusterSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="md:col-span-2 h-64 bg-[#111820] rounded-lg animate-pulse border border-[#2A3340]" />
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-[78px] bg-[#111820] rounded-lg animate-pulse border border-[#2A3340]" />
        ))}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="border border-[#2A3340] rounded-lg overflow-hidden">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="px-4 py-4 border-b border-[#2A3340]/50 flex flex-col gap-2 animate-pulse">
          <div className="h-2 w-16 bg-[#1A2330] rounded" />
          <div className="h-4 w-full bg-[#1A2330] rounded" />
          <div className="h-4 w-3/4 bg-[#1A2330] rounded" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="border border-[#2A3340] rounded-lg overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="px-4 py-2.5 border-b border-[#2A3340]/50 flex items-center gap-2 animate-pulse">
          <div className="h-4 w-20 bg-[#1A2330] rounded" />
          <div className="h-3 w-3 bg-[#1A2330] rounded" />
          <div className="h-4 w-20 bg-[#1A2330] rounded" />
          <div className="h-3 w-14 bg-[#1A2330] rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <>
      {/* ── Ticker marquee — full width, above main container ─────────────── */}
      <TickerMarquee />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-10">

        {/* ── Hero: left brand 60% / right broadcast monitor 40% ───────── */}
        <section className="relative w-full flex flex-col md:flex-row gap-6 md:gap-10 items-stretch">

          {/* Left — brand (60%) */}
          <div className="relative flex flex-col gap-5 md:w-[60%] justify-center py-4">
            {/* Live pill */}
            <div>
              <LiveStatusPill />
            </div>

            {/* Brand mark in VT323 */}
            <div className="flex flex-col gap-2">
              <h1
                className="font-display tracking-tight leading-none"
                style={{
                  fontSize: "clamp(5rem, 14vw, 10rem)",
                  color: "#39FF14",
                  textShadow: "0 0 20px #39FF1470, 0 0 60px #39FF1430",
                  lineHeight: 0.9,
                }}
              >
                AAN-TV
              </h1>

              {/* Press Start 2P sub-label */}
              <span className="font-pixel text-[8px] text-[#7A8896] tracking-widest uppercase mt-1">
                BROADCASTING ON CH 01-04
              </span>

              <p className="font-mono text-sm text-[#7A8896] max-w-sm leading-relaxed mt-1">
                On-chain commentary for the Vara Agent Network
                <span className="text-[#3D4A5C]"> · </span>
                Season 1
              </p>
            </div>

            {/* Bounty CTA line */}
            <p className="font-mono text-xs text-[#3D4A5C] max-w-xs leading-relaxed">
              <span className="text-[#39FF14]">5 VARA bounty live</span>
              {" "}· pay 0.1 VARA to{" "}
              <code className="text-[#7A8896]">AanTv/RequestCoverage</code>
            </p>

            <a
              href="/missions"
              className="inline-flex w-fit items-center gap-2 rounded-md border border-[#00CFFF]/40 bg-[#00CFFF]/5 px-3 py-2 font-mono text-xs text-[#00CFFF] hover:bg-[#00CFFF]/10 transition-colors"
            >
              <ClipboardText size={14} weight="bold" />
              Mission Control
            </a>
          </div>

          {/* Right — broadcast monitor frame (40%) */}
          <div className="relative md:w-[40%] w-full">
            {/* ON AIR badge top right of the monitor */}
            <div className="absolute -top-2 right-0 z-10">
              <OnAirBadge />
            </div>
            <BroadcastFrame label="LIVE METRICS · AAN-TV CLUSTER">
              <Suspense fallback={<MonitorSkeleton />}>
                <MetricsPanel />
              </Suspense>
            </BroadcastFrame>
          </div>
        </section>

        {/* ── Emergency broadcast bounty banner ─────────────────────────── */}
        <BountyBanner />

        {/* ── Cluster channel cards ─────────────────────────────────────── */}
        <Suspense fallback={<ClusterSkeleton />}>
          <ClusterSectionServer />
        </Suspense>

        {/* ── Broadcast stream feed ─────────────────────────────────────── */}
        <Suspense fallback={<FeedSkeleton />}>
          <CommentatorFeed />
        </Suspense>

        {/* ── Bottom split: network log + coverage requests ────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Suspense fallback={<ListSkeleton />}>
            <RecentActivity />
          </Suspense>
          <Suspense fallback={<ListSkeleton />}>
            <CoverageQueue />
          </Suspense>
        </div>

        {/* ── Footer with SMPTE bars ────────────────────────────────────── */}
        <footer className="flex flex-col gap-3 pt-3">
          <SmpteBar />
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 justify-between pt-1">
            <div className="flex items-center gap-3">
              <span className="font-pixel text-[7px] text-[#3D4A5C] uppercase tracking-widest">
                AAN-TV
              </span>
              <span className="text-[#2A3340]">·</span>
              <span className="font-mono text-xs text-[#3D4A5C]">
                operator <span className="text-[#7A8896]">agent-arena-op</span>
              </span>
              <span className="text-[#2A3340]">·</span>
              <span className="font-mono text-xs text-[#3D4A5C]">ch.01-04 · season 1</span>
            </div>
            <a
              href="https://github.com/Timidan/agent-arena"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-[#3D4A5C] hover:text-[#7A8896] transition-colors"
            >
              <GithubLogo size={12} />
              <span>source</span>
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}

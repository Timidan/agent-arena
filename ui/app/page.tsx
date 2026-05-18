import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsPanel } from "@/components/metrics-panel";
import { CommentatorFeed } from "@/components/commentator-feed";
import { RecentActivity } from "@/components/recent-activity";
import { CoverageQueue } from "@/components/coverage-queue";

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg" />
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-md" />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-10 flex flex-col gap-10">
      {/* Header */}
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-4xl font-mono font-bold tracking-tight text-zinc-100">
            AAN-TV
          </h1>
          <span className="text-sm font-mono text-zinc-500">
            · Vara Agent Arena Commentator
          </span>
        </div>
        <p className="text-zinc-500 text-sm font-mono max-w-xl">
          On-chain AI narrator for the Vara Agent Network. Pay 0.1 VARA →{" "}
          <span className="text-emerald-400">RequestCoverage</span> to get your
          event featured.
        </p>
      </header>

      {/* Metrics */}
      <Suspense fallback={<MetricsSkeleton />}>
        <MetricsPanel />
      </Suspense>

      {/* Commentator feed */}
      <Suspense fallback={<FeedSkeleton />}>
        <CommentatorFeed />
      </Suspense>

      {/* Bottom split: activity left, matches/coverage right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Suspense fallback={<ListSkeleton />}>
          <RecentActivity />
        </Suspense>
        <Suspense fallback={<ListSkeleton />}>
          <CoverageQueue />
        </Suspense>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-start sm:items-center gap-2 justify-between">
        <span className="text-xs font-mono text-zinc-600">
          Program:{" "}
          <span className="text-zinc-500 break-all">
            0xae7f…7d6f
          </span>
        </span>
        <span className="text-xs font-mono text-zinc-600">
          Vara Agent Arena · Season 1 · Open/Creative
        </span>
      </footer>
    </main>
  );
}

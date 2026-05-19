import { fetchCommentatorFeed } from "@/lib/indexer";
import { InsetFeedMonitor } from "@/components/inset-feed-monitor";

export async function InsetFeedMonitorServer() {
  const posts = await fetchCommentatorFeed();
  return <InsetFeedMonitor posts={posts} />;
}

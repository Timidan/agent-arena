const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_GRAPHQL_URL ??
  "https://agents-api.vara.network/graphql";

const APP_HEX =
  process.env.NEXT_PUBLIC_APP_HEX ??
  "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f";

// Cluster: 4 programs — aan-tv, aan-tv-board, aan-tv-tip, aan-tv-data
const CLUSTER_HEXES: string[] = (
  process.env.NEXT_PUBLIC_CLUSTER_HEXES ??
  "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f,0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d,0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02,0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c"
).split(",").map((h) => h.trim());

const CLUSTER_HANDLES: string[] = (
  process.env.NEXT_PUBLIC_CLUSTER_HANDLES ??
  "aan-tv,aan-tv-board,aan-tv-tip,aan-tv-data"
).split(",").map((h) => h.trim());

// Track labels per position (matches CLUSTER_HEXES order)
export const CLUSTER_TRACKS: string[] = ["Open", "Social", "Economy", "Services"];

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 5 },
  });
  if (!res.ok) throw new Error(`Indexer responded ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown[] };
  if (json.errors?.length) {
    console.error("GraphQL errors:", json.errors);
  }
  return json.data;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AppMetric {
  integrationsIn: number;
  integrationsOut: number;
  messagesSent: number;
  mentionCount: number;
  postsActive: number;
}

export interface ChatMessage {
  id: string;
  msgId: string;
  authorRef: string;
  authorHandle: string | null;
  body: string;
  ts: string;
  substrateBlockNumber: number;
}

export interface Interaction {
  id: string;
  caller: string;
  callerHandle: string | null;
  callerKind: string;
  callee: string;
  calleeHandle: string | null;
  method: string | null;
  valuePaidRaw: string | null;
  substrateBlockNumber: number;
  substrateBlockTs: string;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function fetchAppMetrics(): Promise<AppMetric | null> {
  const data = await gql<{ appMetricById: AppMetric | null }>(`
    query {
      appMetricById(id: "${APP_HEX}:1") {
        integrationsIn
        integrationsOut
        messagesSent
        mentionCount
        postsActive
      }
    }
  `);
  return data.appMetricById;
}

// ─── Cluster metrics (4-program aggregate) ──────────────────────────────────

export interface ClusterProgram {
  hex: string;
  handle: string;
  track: string;
  metrics: AppMetric;
}

export interface ClusterMetrics {
  per_program: ClusterProgram[];
  totals: AppMetric;
}

const ZERO_METRIC: AppMetric = {
  integrationsIn: 0,
  integrationsOut: 0,
  messagesSent: 0,
  mentionCount: 0,
  postsActive: 0,
};

function nullToZero(m: AppMetric | null): AppMetric {
  if (!m) return { ...ZERO_METRIC };
  return {
    integrationsIn: m.integrationsIn ?? 0,
    integrationsOut: m.integrationsOut ?? 0,
    messagesSent: m.messagesSent ?? 0,
    mentionCount: m.mentionCount ?? 0,
    postsActive: m.postsActive ?? 0,
  };
}

type ClusterQueryResult = {
  m0: AppMetric | null;
  m1: AppMetric | null;
  m2: AppMetric | null;
  m3: AppMetric | null;
};

export async function fetchClusterMetrics(): Promise<ClusterMetrics> {
  const fields = `integrationsIn integrationsOut messagesSent mentionCount postsActive`;
  const query = `
    query Cluster {
      m0: appMetricById(id: "${CLUSTER_HEXES[0]}:1") { ${fields} }
      m1: appMetricById(id: "${CLUSTER_HEXES[1]}:1") { ${fields} }
      m2: appMetricById(id: "${CLUSTER_HEXES[2]}:1") { ${fields} }
      m3: appMetricById(id: "${CLUSTER_HEXES[3]}:1") { ${fields} }
    }
  `;
  const data = await gql<ClusterQueryResult>(query);

  const raw = [data.m0, data.m1, data.m2, data.m3].map(nullToZero);

  const per_program: ClusterProgram[] = CLUSTER_HEXES.map((hex, i) => ({
    hex,
    handle: CLUSTER_HANDLES[i] ?? hex,
    track: CLUSTER_TRACKS[i] ?? "Unknown",
    metrics: raw[i],
  }));

  const totals: AppMetric = raw.reduce(
    (acc, m) => ({
      integrationsIn: acc.integrationsIn + m.integrationsIn,
      integrationsOut: acc.integrationsOut + m.integrationsOut,
      messagesSent: acc.messagesSent + m.messagesSent,
      mentionCount: acc.mentionCount + m.mentionCount,
      postsActive: acc.postsActive + m.postsActive,
    }),
    { ...ZERO_METRIC }
  );

  return { per_program, totals };
}

export async function fetchCommentatorFeed(): Promise<ChatMessage[]> {
  // authorRef is stored as "Application:<hex>" by the indexer
  // Only aan-tv auto-posts commentary; board/tip/data do not.
  const data = await gql<{ allChatMessages: { nodes: ChatMessage[] } }>(`
    query {
      allChatMessages(
        first: 20
        orderBy: SUBSTRATE_BLOCK_NUMBER_DESC
        filter: { authorRef: { equalTo: "Application:${APP_HEX}" } }
      ) {
        nodes {
          id
          msgId
          authorRef
          authorHandle
          body
          ts
          substrateBlockNumber
        }
      }
    }
  `);
  return data.allChatMessages.nodes;
}

const ALLOWLISTED_HANDLES = [
  "aan-tv",
  "vara-agents",
  "varapulse",
  "varabridge",
  "varaflow-org",
  "infinite-bounty-v3",
  "zeeast-casino",
  "skopos-bridge",
  "hy4-predict-app",
  "hy4-game-app",
  "thebookdex",
  "agent-tic-tac-toe",
];

export async function fetchRecentActivity(): Promise<Interaction[]> {
  const handleList = ALLOWLISTED_HANDLES.map((h) => `"${h}"`).join(", ");
  const data = await gql<{ allInteractions: { nodes: Interaction[] } }>(`
    query {
      allInteractions(
        first: 15
        orderBy: SUBSTRATE_BLOCK_NUMBER_DESC
        filter: { calleeHandle: { in: [${handleList}] } }
      ) {
        nodes {
          id
          caller
          callerHandle
          callerKind
          callee
          calleeHandle
          method
          valuePaidRaw
          substrateBlockNumber
          substrateBlockTs
        }
      }
    }
  `);
  return data.allInteractions.nodes;
}

export async function fetchAanTvInteractions(): Promise<Interaction[]> {
  const data = await gql<{ allInteractions: { nodes: Interaction[] } }>(`
    query {
      allInteractions(
        first: 5
        orderBy: SUBSTRATE_BLOCK_NUMBER_DESC
        filter: { calleeHandle: { equalTo: "aan-tv" } }
      ) {
        nodes {
          id
          caller
          callerHandle
          callerKind
          callee
          calleeHandle
          method
          valuePaidRaw
          substrateBlockNumber
          substrateBlockTs
        }
      }
    }
  `);
  return data.allInteractions.nodes;
}

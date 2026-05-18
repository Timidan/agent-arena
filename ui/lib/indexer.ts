const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_GRAPHQL_URL ??
  "https://agents-api.vara.network/graphql";

const APP_HEX =
  process.env.NEXT_PUBLIC_APP_HEX ??
  "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f";

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

export async function fetchCommentatorFeed(): Promise<ChatMessage[]> {
  const data = await gql<{ allChatMessages: { nodes: ChatMessage[] } }>(`
    query {
      allChatMessages(
        first: 20
        orderBy: SUBSTRATE_BLOCK_NUMBER_DESC
        filter: { authorRef: { equalTo: "${APP_HEX}" } }
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

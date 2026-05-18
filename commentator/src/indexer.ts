/**
 * GraphQL client for the Vara Agent Network indexer.
 *
 * Endpoint: INDEXER_GRAPHQL_URL (default: https://agents-api.vara.network/graphql)
 *
 * PostGraphile with connection-filter plugin: all* connection naming,
 * filter shape: { field: { equalTo: "..." } }, point queries: *ById.
 *
 * Entity-id key shapes:
 *   applicationById(id: "<program_hex>")
 *   appMetricById(id: "<program_hex>:<season_id>")
 *   participantById(id: "<actor_hex>")
 */

import { GraphQLClient, gql } from 'graphql-request';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(_execFile);

const endpoint =
  process.env.INDEXER_GRAPHQL_URL ?? 'https://agents-api.vara.network/graphql';

let _client: GraphQLClient | null = null;
function client(): GraphQLClient {
  if (!_client) _client = new GraphQLClient(endpoint);
  return _client;
}

// ── types ──────────────────────────────────────────────────────────────────

export interface Interaction {
  id: string;                    // indexer auto-gen string id
  blockNumber: number;           // substrateBlockNumber
  caller: string;                // hex actor id
  callerHandle: string | null;   // pre-resolved handle (when registered)
  callerKind: string;            // "Participant" | "Application"
  callee: string;                // hex actor id (program being called)
  calleeHandle: string | null;   // pre-resolved handle of the called program
  method: string | null;         // method name
  valuePaidRaw: string | null;   // u128 string, plancks
}

export interface HandleResult {
  handle: string;
  kind: 'Participant' | 'Application';
}

export interface AppMetric {
  programId: string;
  seasonId: number;
  messagesSent: number;
  mentionCount: number;
  integrationsIn: number;
  integrationsOut: number;
  postsActive: number;
}

export interface CoverageItem {
  id: string;                      // u64 as string
  requester: string;
  eventKind: { kind: string; value?: unknown };
  targetProgram: string | null;
  hint: string;
  postedAtBlock: number;
  chatMsgId: string | null;
}

// ── handle cache ──────────────────────────────────────────────────────────

const handleCache = new Map<string, { result: HandleResult | null; fetchedAt: number }>();

function cacheTtl(): number {
  return parseInt(process.env.HANDLE_CACHE_TTL_MS ?? '3600000', 10);
}

// ── fetchInteractionsSinceBlock ───────────────────────────────────────────

const INTERACTIONS_QUERY = gql`
  query InteractionsSince($sinceBlock: Int!, $limit: Int!, $after: Cursor) {
    allInteractions(
      first: $limit,
      after: $after,
      orderBy: SUBSTRATE_BLOCK_NUMBER_ASC,
      filter: { substrateBlockNumber: { greaterThan: $sinceBlock } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        substrateBlockNumber
        caller
        callerHandle
        callerKind
        callee
        calleeHandle
        method
        valuePaidRaw
      }
    }
  }
`;

interface InteractionsQueryResult {
  allInteractions: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: {
      id: string;
      substrateBlockNumber: number;
      caller: string;
      callerHandle: string | null;
      callerKind: string;
      callee: string;
      calleeHandle: string | null;
      method: string | null;
      valuePaidRaw: string | null;
    }[];
  };
}

export async function fetchInteractionsSinceBlock(
  sinceBlock: number,
  limit = 50,
): Promise<Interaction[]> {
  const interactions: Interaction[] = [];
  let after: string | null = null;

  do {
    const data: InteractionsQueryResult = await client().request<InteractionsQueryResult>(
      INTERACTIONS_QUERY,
      { sinceBlock, limit, after },
    );

    interactions.push(
      ...data.allInteractions.nodes.map((n) => ({
        id: n.id,
        blockNumber: Number(n.substrateBlockNumber),
        caller: n.caller,
        callerHandle: n.callerHandle ?? null,
        callerKind: n.callerKind,
        callee: n.callee,
        calleeHandle: n.calleeHandle ?? null,
        method: n.method ?? null,
        valuePaidRaw: n.valuePaidRaw ?? null,
      })),
    );

    after = data.allInteractions.pageInfo.hasNextPage
      ? data.allInteractions.pageInfo.endCursor
      : null;
  } while (after);

  return interactions;
}

// ── fetchChainTipBlock ────────────────────────────────────────────────────

const CHAIN_TIP_QUERY = gql`
  query ChainTip {
    allInteractions(first: 1, orderBy: SUBSTRATE_BLOCK_NUMBER_DESC) {
      nodes {
        substrateBlockNumber
      }
    }
  }
`;

interface ChainTipQueryResult {
  allInteractions: {
    nodes: { substrateBlockNumber: number }[];
  };
}

/**
 * Returns the highest block number currently in the indexer.
 * Used for cold-start seeding: watcher sets lastSeenBlock = tipBlock - 100
 * instead of 0, so the first tick processes only ~100 blocks of recent
 * history rather than the entire network history since genesis.
 */
export async function fetchChainTipBlock(): Promise<number> {
  const data = await client().request<ChainTipQueryResult>(CHAIN_TIP_QUERY);
  const tip = data.allInteractions.nodes[0]?.substrateBlockNumber ?? 0;
  return tip;
}

// ── fetchCoverageQueue ────────────────────────────────────────────────────
// Reads our own program's GetCoverageQueue via the vara-wallet CLI.
// This gives us CoverageId, requester, event_kind, target_program, hint,
// and chat_msg_id (non-null means already covered).

export async function fetchCoverageQueue(
  cursor: bigint = 0n,
  limit = 50,
): Promise<{ items: CoverageItem[]; nextCursor: bigint | null }> {
  const appHex = process.env.APP_HEX;
  const acct = process.env.ACCT;
  const network = process.env.VARA_NETWORK ?? 'mainnet';
  const idl = process.env.IDL;

  if (!appHex || !acct || !idl) {
    throw new Error('fetchCoverageQueue: APP_HEX, ACCT, and IDL env vars are required');
  }

  const args = JSON.stringify([cursor === 0n ? null : Number(cursor), limit]);

  const { stdout } = await execFileAsync(
    'vara-wallet',
    [
      '--account', acct,
      '--network', network,
      '--json',
      'call',
      appHex,
      'AanTv/GetCoverageQueue',
      '--args', args,
      '--idl', idl,
    ],
    { timeout: 30_000 },
  );

  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  if (parsed['programMessage'] != null) {
    throw new Error(`GetCoverageQueue panic: ${parsed['programMessage']}`);
  }

  const result = parsed['result'] as {
    items?: unknown[];
    next_cursor?: string | number | null;
  } | null;

  if (!result) return { items: [], nextCursor: null };

  const items: CoverageItem[] = (result.items ?? []).map((it: unknown) => {
    const item = it as Record<string, unknown>;
    return {
      id: String(item['id']),
      requester: item['requester'] as string,
      eventKind: item['event_kind'] as { kind: string; value?: unknown },
      targetProgram: (item['target_program'] as string | null) ?? null,
      hint: item['hint'] as string,
      postedAtBlock: Number(item['posted_at_block']),
      chatMsgId: item['chat_msg_id'] == null ? null : String(item['chat_msg_id']),
    };
  });

  const nextCursor =
    result.next_cursor == null ? null : BigInt(result.next_cursor as string | number);

  return { items, nextCursor };
}

// ── resolveHandle ─────────────────────────────────────────────────────────

const PARTICIPANT_QUERY = gql`
  query ParticipantById($id: String!) {
    participantById(id: $id) {
      handle
    }
  }
`;

const APPLICATION_QUERY = gql`
  query ApplicationById($id: String!) {
    applicationById(id: $id) {
      handle
    }
  }
`;

interface ParticipantQueryResult {
  participantById: { handle: string } | null;
}

interface ApplicationQueryResult {
  applicationById: { handle: string } | null;
}

export async function resolveHandle(hex: string): Promise<string | null> {
  const now = Date.now();
  const cached = handleCache.get(hex);
  if (cached && now - cached.fetchedAt < cacheTtl()) {
    return cached.result?.handle ?? null;
  }

  // Try participant first, then application
  let result: HandleResult | null = null;

  try {
    const pData = await client().request<ParticipantQueryResult>(PARTICIPANT_QUERY, { id: hex });
    if (pData.participantById?.handle) {
      result = { handle: pData.participantById.handle, kind: 'Participant' };
    }
  } catch {
    // ignore individual lookup errors
  }

  if (!result) {
    try {
      const aData = await client().request<ApplicationQueryResult>(APPLICATION_QUERY, { id: hex });
      if (aData.applicationById?.handle) {
        result = { handle: aData.applicationById.handle, kind: 'Application' };
      }
    } catch {
      // ignore
    }
  }

  handleCache.set(hex, { result, fetchedAt: now });
  return result?.handle ?? null;
}

// ── fetchAppMetric ────────────────────────────────────────────────────────

const APP_METRIC_QUERY = gql`
  query AppMetricById($id: String!) {
    appMetricById(id: $id) {
      programId
      seasonId
      messagesSent
      mentionCount
      integrationsIn
      integrationsOut
      postsActive
    }
  }
`;

interface AppMetricQueryResult {
  appMetricById: {
    programId: string;
    seasonId: number;
    messagesSent: number;
    mentionCount: number;
    integrationsIn: number;
    integrationsOut: number;
    postsActive: number;
  } | null;
}

export async function fetchAppMetric(appHex: string, seasonId = 1): Promise<AppMetric | null> {
  const id = `${appHex}:${seasonId}`;
  try {
    const data = await client().request<AppMetricQueryResult>(APP_METRIC_QUERY, { id });
    if (!data.appMetricById) return null;
    return {
      programId: data.appMetricById.programId,
      seasonId: data.appMetricById.seasonId,
      messagesSent: data.appMetricById.messagesSent,
      mentionCount: data.appMetricById.mentionCount,
      integrationsIn: data.appMetricById.integrationsIn,
      integrationsOut: data.appMetricById.integrationsOut,
      postsActive: data.appMetricById.postsActive,
    };
  } catch {
    return null;
  }
}

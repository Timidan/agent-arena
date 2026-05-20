#!/usr/bin/env bash
# Load this from any shell before running mainnet ops:
#   source scripts/preflight-mainnet.sh
#
# All env vars used across the project live here.

# Wallet
export ACCT="agent-arena"
export VARA_NETWORK="mainnet"
export OPERATOR_HEX="0xc292ca129fadeb52f0c047274dbb7a8eabc49f0bcfae9857bc1ef2b1bd482b10"
export OPERATOR_SS58="kGjw7J4XV8JDpNqeLy7hJ4d2Zpmdh4rJRCzVLtvgSvqNH2Rhe"

# Handles (unified namespace — MUST differ)
export PARTICIPANT_HANDLE="agent-arena-op"
export APP_HANDLE="aan-tv"
# Note: original APP_HANDLE "agent-arena" was already taken by program
# 0x88d21f05…7166 (a different team's tic-tac-toe coordinator).
# Pivoted to AAN-TV-as-primary product on 2026-05-18 day-0 ecosystem scan.

# Vara A2A network constants (from vara-agent-network-skills preamble)
export PID="0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3"
export IDL="$HOME/.claude/skills/vara-agent-network-skills/idl/agents_network_client.idl"
export INDEXER_GRAPHQL_URL="https://agents-api.vara.network/graphql"
export VOUCHER_URL="https://voucher-backend-agents.vara.network/voucher"
export VARA_WS="wss://rpc.vara.network"

# Filled in later by Task 18 (mainnet deploy of our own Sails program)
# export APP_HEX="0x..."

# Refreshed per-session via references/vouchers.md (block-height expiry)
# export VOUCHER_ID="0x..."

echo "[preflight] ACCT=$ACCT"
echo "[preflight] OPERATOR_HEX=$OPERATOR_HEX"
echo "[preflight] VARA_NETWORK=$VARA_NETWORK"
echo "[preflight] PID=$PID"
export APP_HEX="0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f"
# aan-tv-relay (Phase 2): tick-driven program-initiated outbound
export RELAY_HEX="0xece48214a08db3ac815f2461a3c0855230ded9b05ba273a16350a12d28b0dce7"

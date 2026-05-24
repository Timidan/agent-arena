#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/commentator/.env}"
PROGRAM_DIR="$ROOT/programs/aan-missions"
WASM="$PROGRAM_DIR/target/wasm32-gear/release/aan_missions.opt.wasm"
IDL="$PROGRAM_DIR/target/wasm32-gear/release/aan_missions.idl"
CLIENT_IDL="$PROGRAM_DIR/client/aan_missions_client.idl"
COMMENTATOR_IDL="$ROOT/commentator/idls/aan_missions_client.idl"
RUN_TESTS=true
CHECK_WALLET=true

usage() {
  cat <<'USAGE'
usage: scripts/mission-control-predeploy.sh [--skip-tests] [--skip-wallet]

Runs no-write readiness checks before deploying the aan-missions Mission Control
program. This script never uploads code, creates missions, transfers VARA, or
enables verifier approvals.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)
      RUN_TESTS=false
      ;;
    --skip-wallet)
      CHECK_WALLET=false
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

trim() {
  local value="$*"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_file() {
  local line key value
  [[ -f "$ENV_FILE" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(trim "${line%%#*}")"
    [[ -z "$line" ]] && continue
    [[ "$line" == export[[:space:]]* ]] && line="${line#export }"
    [[ "$line" != *=* ]] && continue

    key="$(trim "${line%%=*}")"
    value="$(trim "${line#*=}")"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    [[ -n "$key" && -z "${!key:-}" ]] && export "$key=$value"
  done < "$ENV_FILE"
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "FAIL missing command: $name" >&2
    exit 1
  fi
  echo "PASS tool.$name $(command -v "$name")"
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "FAIL missing file: $path" >&2
    exit 1
  fi
  echo "PASS file.$(basename "$path")"
}

normalize_last_blank_line() {
  sed -e '${/^$/d;}' "$1"
}

load_env_file

echo "Mission Control predeploy readiness"
echo "repo:    $ROOT"
echo "program: $PROGRAM_DIR"
echo "env:     $ENV_FILE"
echo

require_command cargo
require_command vara-wallet
require_command sha256sum

if [[ "$RUN_TESTS" == true ]]; then
  echo
  echo "Running release gtests..."
  cargo test --release --manifest-path "$PROGRAM_DIR/Cargo.toml"
else
  echo "WARN skipped cargo tests"
fi

require_file "$WASM"
require_file "$IDL"
require_file "$CLIENT_IDL"
require_file "$COMMENTATOR_IDL"

if diff -u \
  <(normalize_last_blank_line "$IDL") \
  <(normalize_last_blank_line "$CLIENT_IDL") >/tmp/aan-missions-idl.diff; then
  echo "PASS idl.client matches target IDL"
else
  echo "FAIL client IDL drift detected" >&2
  cat /tmp/aan-missions-idl.diff >&2
  rm -f /tmp/aan-missions-idl.diff
  exit 1
fi
rm -f /tmp/aan-missions-idl.diff

if cmp -s "$CLIENT_IDL" "$COMMENTATOR_IDL"; then
  echo "PASS idl.commentator matches generated client IDL"
else
  echo "FAIL commentator Mission Control IDL drift detected" >&2
  exit 1
fi

for method in \
  CreateMission \
  ClaimMission \
  SubmitProof \
  ApproveProof \
  RejectProof \
  CloseMission \
  GetMissions \
  GetOpenMissions \
  GetMission \
  GetClaims \
  GetClaimsByAgent \
  GetProofs \
  GetPendingProofs \
  GetProof \
  GetAgentRecords \
  GetAgentRecord \
  GetStats; do
  if grep -q "$method" "$IDL"; then
    echo "PASS idl.$method"
  else
    echo "FAIL missing IDL method: $method" >&2
    exit 1
  fi
done

echo
echo "Artifact hashes:"
sha256sum "$WASM" "$IDL" "$CLIENT_IDL" "$COMMENTATOR_IDL"

echo
echo "Checking upload payload without submitting..."
upload_args=(--network "${VARA_NETWORK:-mainnet}")
if [[ -n "${ACCT:-}" ]]; then
  upload_args+=(--account "$ACCT")
fi
upload_args+=(program upload "$WASM" --idl "$IDL" --init Create --dry-run)
vara-wallet "${upload_args[@]}"

if [[ "$CHECK_WALLET" == true ]]; then
  if [[ -z "${OPERATOR_HEX:-}" ]]; then
    echo "WARN OPERATOR_HEX missing; skipped balance check"
  else
    echo
    echo "Wallet balance:"
    vara-wallet --network "${VARA_NETWORK:-mainnet}" balance "$OPERATOR_HEX"
  fi
else
  echo "WARN skipped wallet balance check"
fi

if [[ "${MISSION_VERIFIER_APPROVALS_ENABLED:-false}" == "true" ]]; then
  echo "FAIL MISSION_VERIFIER_APPROVALS_ENABLED=true; keep approvals disabled for deployment" >&2
  exit 1
fi

echo
echo "No-write predeploy checks passed."
echo
echo "Deployment command, only after explicit approval:"
printf 'vara-wallet --network %q --account %q program upload %q --idl %q --init Create\n' \
  "${VARA_NETWORK:-mainnet}" "${ACCT:-agent-arena}" "$WASM" "$IDL"

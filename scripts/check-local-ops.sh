#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/commentator/.env}"
ENV_DIR="$(dirname "$ENV_FILE")"
STRICT=false
PROFILE="${AAN_OPS_PROFILE:-runtime}"

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=true
      ;;
    --runtime)
      PROFILE=runtime
      ;;
    --dev)
      PROFILE=dev
      ;;
    *)
      echo "usage: $0 [--runtime|--dev] [--strict]" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$PROFILE" != "runtime" && "$PROFILE" != "dev" ]]; then
  echo "AAN_OPS_PROFILE must be 'runtime' or 'dev'" >&2
  exit 2
fi

if [[ -d "$ENV_DIR" ]]; then
  ENV_DIR="$(cd "$ENV_DIR" && pwd)"
fi

passes=0
warnings=0
failures=0

declare -A ENV_VALUES=()

trim() {
  local value="$*"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

record() {
  local level="$1"
  local name="$2"
  local detail="$3"

  printf '%-5s %s - %s\n' "$level" "$name" "$detail"
  case "$level" in
    PASS) passes=$((passes + 1)) ;;
    WARN) warnings=$((warnings + 1)) ;;
    FAIL) failures=$((failures + 1)) ;;
  esac
}

pass() {
  record PASS "$1" "$2"
}

warn() {
  record WARN "$1" "$2"
}

fail() {
  record FAIL "$1" "$2"
}

load_env_file() {
  local file="$1"
  local line key value

  if [[ ! -f "$file" ]]; then
    fail env.file "missing $file"
    return
  fi

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
    [[ -n "$key" ]] && ENV_VALUES["$key"]="$value"
  done < "$file"

  pass env.file "loaded $file"
}

env_value() {
  local key="$1"
  printf '%s' "${ENV_VALUES[$key]:-}"
}

env_bool() {
  local raw
  raw="$(env_value "$1")"
  case "$raw" in
    true | TRUE | 1 | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

is_placeholder() {
  local value="$1"
  [[ "$value" == "0x..." ]] && return 0
  [[ "$value" == *"/home/user/"* ]] && return 0
  [[ "$value" == *"..."* ]] && return 0
  return 1
}

is_hex_32() {
  [[ "$1" =~ ^0x[0-9a-fA-F]{64}$ ]]
}

is_integer() {
  [[ "$1" =~ ^-?[0-9]+$ ]]
}

count_limit() {
  local key="$1"
  local fallback="$2"
  local raw
  raw="$(env_value "$key")"
  [[ -z "$raw" ]] && raw="$fallback"
  printf '%s' "$raw"
}

check_command() {
  local command_name="$1"
  local required="${2:-required}"

  if command -v "$command_name" >/dev/null 2>&1; then
    pass "tool.$command_name" "found $(command -v "$command_name")"
  elif [[ "$required" == "required" ]]; then
    fail "tool.$command_name" "not found on PATH"
  else
    warn "tool.$command_name" "not found on PATH"
  fi
}

check_required_env() {
  local key value
  local required=(
    PID
    APP_HEX
    OPERATOR_HEX
    INDEXER_GRAPHQL_URL
    VOUCHER_URL
    ACCT
    IDL
    NETWORK_IDL
    VARA_NETWORK
    CHECKPOINT_DB
  )

  for key in "${required[@]}"; do
    value="$(env_value "$key")"
    if [[ -z "$value" ]]; then
      fail "env.$key" "missing"
    elif is_placeholder "$value"; then
      fail "env.$key" "still contains a placeholder"
    else
      pass "env.$key" "present"
    fi
  done

  for key in PID APP_HEX OPERATOR_HEX; do
    value="$(env_value "$key")"
    [[ -z "$value" ]] && continue
    if is_hex_32 "$value"; then
      pass "env.$key.hex" "valid 32-byte hex"
    else
      fail "env.$key.hex" "expected 0x-prefixed 32-byte hex"
    fi
  done
}

check_file_env() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  [[ -z "$value" ]] && return

  if [[ "$value" == /* ]]; then
    if [[ -f "$value" ]]; then
      pass "file.$key" "$value exists"
    else
      fail "file.$key" "$value does not exist"
    fi
  elif [[ -f "$ENV_DIR/$value" ]]; then
    pass "file.$key" "$value exists relative to $(basename "$ENV_DIR")"
  elif [[ -f "$ROOT/$value" ]]; then
    pass "file.$key" "$value exists"
  else
    fail "file.$key" "$value does not exist relative to env file or repo"
  fi
}

check_count_limit() {
  local key="$1"
  local fallback="$2"
  local raw
  raw="$(count_limit "$key" "$fallback")"

  if ! is_integer "$raw"; then
    fail "cap.$key" "expected integer, got '$raw'"
    return
  fi

  if (( raw < -1 )); then
    fail "cap.$key" "must be -1 or non-negative"
  elif (( raw == -1 )); then
    warn "cap.$key" "unlimited"
  else
    pass "cap.$key" "$raw"
  fi
}

check_raw_amount() {
  local key="$1"
  local fallback="$2"
  local raw
  raw="$(env_value "$key")"
  [[ -z "$raw" ]] && raw="$fallback"

  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    pass "cap.$key" "$raw"
  else
    fail "cap.$key" "expected non-negative integer planck amount, got '$raw'"
  fi
}

check_safety_caps() {
  local partner_cap verifier_cap max_spend

  check_count_limit MAX_DAILY_CHAT_POSTS 48
  check_count_limit MAX_DAILY_MARK_COVERED_CALLS 48
  check_count_limit MAX_DAILY_PARTNER_CALLS 0
  check_count_limit MAX_DAILY_MISSION_VERIFIER_CALLS 0
  check_raw_amount MAX_DAILY_SPEND_RAW 0
  check_raw_amount CHAT_POST_ESTIMATED_SPEND_RAW 0
  check_raw_amount MARK_COVERED_ESTIMATED_SPEND_RAW 0
  check_raw_amount PARTNER_CALL_ESTIMATED_SPEND_RAW 0
  check_raw_amount MISSION_VERIFIER_ESTIMATED_SPEND_RAW 0

  max_spend="$(env_value MAX_DAILY_SPEND_RAW)"
  [[ -z "$max_spend" ]] && max_spend=0
  if [[ "$max_spend" == "0" ]]; then
    warn cap.MAX_DAILY_SPEND_RAW "raw spend cap disabled; count caps still apply"
  fi

  partner_cap="$(count_limit MAX_DAILY_PARTNER_CALLS 0)"
  if env_bool BOARD_PARTNER_CALLBACKS_ENABLED || env_bool INTEGRATION_RUNNER_ENABLED; then
    if is_integer "$partner_cap" && (( partner_cap > 0 || partner_cap == -1 )); then
      warn cap.partnerCallbacks "partner callbacks are enabled with MAX_DAILY_PARTNER_CALLS=$partner_cap"
    else
      fail cap.partnerCallbacks "callbacks enabled but MAX_DAILY_PARTNER_CALLS blocks all calls"
    fi
  else
    pass cap.partnerCallbacks "partner callbacks disabled"
  fi

  verifier_cap="$(count_limit MAX_DAILY_MISSION_VERIFIER_CALLS 0)"
  if env_bool MISSION_VERIFIER_APPROVALS_ENABLED; then
    if is_integer "$verifier_cap" && (( verifier_cap > 0 || verifier_cap == -1 )); then
      warn cap.missionApprovals "approval writes enabled with MAX_DAILY_MISSION_VERIFIER_CALLS=$verifier_cap"
    else
      fail cap.missionApprovals "approval writes enabled but MAX_DAILY_MISSION_VERIFIER_CALLS blocks all calls"
    fi
  else
    pass cap.missionApprovals "approval writes disabled"
  fi
}

check_mission_config() {
  local mission_hex mission_idl source_idl

  mission_hex="$(env_value MISSION_PROGRAM_HEX)"
  mission_idl="$(env_value MISSION_IDL)"
  source_idl="$ROOT/programs/aan-missions/client/aan_missions_client.idl"
  if [[ ! -f "$source_idl" && -f "$ROOT/commentator/idls/aan_missions_client.idl" ]]; then
    source_idl="$ROOT/commentator/idls/aan_missions_client.idl"
  fi

  if env_bool MISSION_VERIFIER_ENABLED; then
    pass mission.enabled "MISSION_VERIFIER_ENABLED=true"
    if [[ -z "$mission_hex" ]]; then
      fail env.MISSION_PROGRAM_HEX "missing while mission verifier is enabled"
    elif is_placeholder "$mission_hex"; then
      fail env.MISSION_PROGRAM_HEX "still contains a placeholder"
    elif is_hex_32 "$mission_hex"; then
      pass env.MISSION_PROGRAM_HEX.hex "valid 32-byte hex"
    else
      fail env.MISSION_PROGRAM_HEX.hex "expected 0x-prefixed 32-byte hex"
    fi

    if [[ -z "$mission_idl" ]]; then
      fail env.MISSION_IDL "missing while mission verifier is enabled"
    else
      check_file_env MISSION_IDL
    fi
  else
    pass mission.enabled "mission verifier disabled"
  fi

  if env_bool MISSION_VERIFIER_APPROVALS_ENABLED && ! env_bool MISSION_VERIFIER_ENABLED; then
    warn mission.approvals "approvals are enabled but verifier is disabled"
  fi

  if [[ -f "$source_idl" ]]; then
    pass mission.sourceIdl "generated IDL exists"
    for method in \
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
      GetStats \
      CreateMission \
      ClaimMission \
      SubmitProof \
      ApproveProof \
      RejectProof \
      CloseMission; do
      if grep -q "$method" "$source_idl"; then
        pass "mission.sourceIdl.$method" "present"
      else
        fail "mission.sourceIdl.$method" "missing from generated IDL"
      fi
    done
  else
    fail mission.sourceIdl "missing $source_idl"
  fi
}

check_runtime_artifacts() {
  local artifact
  local artifacts=(
    "$ROOT/commentator/dist/index.js"
    "$ROOT/commentator/dist/healthcheck.js"
    "$ROOT/commentator/dist/mission-verifier-main.js"
  )

  if [[ -f "$ROOT/commentator/package-lock.json" ]]; then
    pass runtime.packageLock "package-lock.json present"
  else
    warn runtime.packageLock "missing; run npm install in commentator"
  fi

  if [[ -d "$ROOT/commentator/node_modules" ]]; then
    pass runtime.nodeModules "dependencies installed"
  else
    warn runtime.nodeModules "missing; run npm install in commentator before starting services"
  fi

  for artifact in "${artifacts[@]}"; do
    if [[ -f "$artifact" ]]; then
      pass "runtime.$(basename "$artifact")" "present"
    else
      warn "runtime.$(basename "$artifact")" "missing; run npm run build in commentator"
    fi
  done
}

check_systemd_units() {
  local unit
  local units=(
    "$ROOT/infra/aan-tv-commentator.service"
    "$ROOT/infra/aan-tv-commentator-health.service"
    "$ROOT/infra/aan-tv-commentator-health.timer"
    "$ROOT/infra/aan-missions-verifier.service"
  )

  for unit in "${units[@]}"; do
    if [[ -f "$unit" ]]; then
      pass "systemd.$(basename "$unit")" "present"
    else
      fail "systemd.$(basename "$unit")" "missing"
    fi
  done

  if command -v systemd-analyze >/dev/null 2>&1; then
    if systemd-analyze verify "${units[@]}" >/tmp/aan-systemd-verify.out 2>&1; then
      pass systemd.verify "unit syntax is valid"
    else
      fail systemd.verify "$(tr '\n' ';' </tmp/aan-systemd-verify.out | cut -c1-220)"
    fi
    rm -f /tmp/aan-systemd-verify.out
  else
    warn systemd.verify "systemd-analyze not available"
  fi

  if grep -q "/home/agent/agent-arena" "$ROOT"/infra/*.service; then
    warn systemd.paths "units use /home/agent/agent-arena; update paths or create that deployment user/path"
  else
    pass systemd.paths "unit paths do not use the default deployment placeholder"
  fi
}

check_git_hygiene() {
  if [[ -d "$ROOT/commentator/node_modules" || -d "$ROOT/commentator/dist" || -d "$ROOT/programs/aan-missions/target" ]]; then
    warn git.generated "generated dependency/build directories are present locally"
  else
    pass git.generated "no common generated directories present"
  fi

  if git -C "$ROOT" status --short --untracked-files=all | grep -E 'node_modules|/dist/|/target/|checkpoint\.sqlite|\.env$' >/dev/null; then
    fail git.ignored "generated or secret files are still visible to git status"
  else
    pass git.ignored "generated and secret files are hidden from git status"
  fi
}

printf 'AAN local ops readiness\n'
printf 'repo: %s\n' "$ROOT"
printf 'env:  %s\n\n' "$ENV_FILE"
printf 'profile: %s\n\n' "$PROFILE"

load_env_file "$ENV_FILE"

check_command git required
check_command node required
check_command npm required
check_command vara-wallet required
check_command systemd-analyze optional

if [[ "$PROFILE" == "dev" ]]; then
  check_command cargo required
  check_command cargo-sails required
  check_command wasm-opt required
  check_command gear required
else
  pass profile.deps "runtime profile skips Rust/Gear build tools"
fi

check_required_env
check_file_env IDL
check_file_env NETWORK_IDL
check_safety_caps
check_mission_config
check_runtime_artifacts
check_systemd_units
check_git_hygiene

printf '\nSummary: %d pass, %d warn, %d fail\n' "$passes" "$warnings" "$failures"

if (( failures > 0 )); then
  exit 1
fi

if [[ "$STRICT" == true && "$warnings" -gt 0 ]]; then
  exit 1
fi

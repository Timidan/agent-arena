#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="runtime"
INSTALL_SYSTEM=true

usage() {
  cat <<'USAGE'
usage: scripts/install-bot-host-deps.sh [--runtime|--dev] [--no-system]

Installs dependencies for a host that runs AAN-TV services.

Profiles:
  --runtime   Bot runtime only: Node/npm, vara-wallet, npm deps, built dist.
  --dev       Runtime plus Rust/Gear/Sails tooling for building/deploying programs.

Options:
  --no-system Skip apt package installation and only install user-level deps.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime)
      PROFILE="runtime"
      ;;
    --dev)
      PROFILE="dev"
      ;;
    --no-system)
      INSTALL_SYSTEM=false
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

if [[ "$PROFILE" != "runtime" && "$PROFILE" != "dev" ]]; then
  echo "profile must be runtime or dev" >&2
  exit 2
fi

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "sudo is required to install system packages" >&2
    exit 1
  fi
}

install_system_packages() {
  if [[ "$INSTALL_SYSTEM" != true ]]; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Skipping system packages: apt-get not found"
    return
  fi

  local packages=(
    build-essential
    ca-certificates
    curl
    git
    gnupg
    jq
    pkg-config
    python3
    libssl-dev
    xz-utils
  )

  if [[ "$PROFILE" == "dev" ]]; then
    packages+=(binaryen)
  fi

  run_root apt-get update
  run_root apt-get install -y "${packages[@]}"
}

install_node_runtime() {
  local major=0

  if command -v node >/dev/null 2>&1; then
    major="$(node -p "Number(process.versions.node.split('.')[0])")"
  fi

  if (( major >= 20 )); then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Node 20+ is required; install Node manually on this platform" >&2
    exit 1
  fi

  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  run_root bash /tmp/nodesource_setup.sh
  rm -f /tmp/nodesource_setup.sh
  run_root apt-get install -y nodejs
}

ensure_local_bin_on_path() {
  mkdir -p "$HOME/.local/bin"
  export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo "WARN: $HOME/.local/bin is not on PATH"
  fi

  if [[ ":$PATH:" != *":$HOME/.cargo/bin:"* ]]; then
    echo "WARN: $HOME/.cargo/bin is not on PATH"
  fi
}

check_node_version() {
  local major
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required but was not found" >&2
    exit 1
  fi

  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if (( major < 20 )); then
    echo "WARN: Node $(node --version) detected; Node 20+ is preferred for this repo"
  fi
}

install_vara_wallet() {
  npm install -g --prefix "$HOME/.local" vara-wallet@0.19.0
  vara-wallet --version
}

install_commentator() {
  cd "$ROOT/commentator"
  npm ci
  npm run build

  if [[ "$PROFILE" == "runtime" ]]; then
    npm prune --omit=dev
  fi
}

install_rust_dev_tools() {
  if ! command -v rustup >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi

  rustup toolchain install stable
  rustup toolchain install nightly
  rustup default stable
  rustup target add wasm32-unknown-unknown --toolchain stable
  rustup target add wasm32-unknown-unknown --toolchain nightly
  rustup target add wasm32v1-none --toolchain stable
  rustup target add wasm32v1-none --toolchain nightly

  if ! cargo install --list | grep -q '^sails-cli v0\.10\.4:'; then
    cargo install sails-cli@0.10.4 --locked --force
  fi

  if ! command -v gear >/dev/null 2>&1; then
    local gear_version="v1.10.0"
    local gear_arch
    case "$(uname -s)-$(uname -m)" in
      Linux-x86_64) gear_arch="x86_64-unknown-linux-gnu" ;;
      Linux-aarch64) gear_arch="aarch64-unknown-linux-gnu" ;;
      *) echo "Unsupported gear platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
    esac
    curl -sSf "https://get.gear.rs/gear-${gear_version}-${gear_arch}.tar.xz" \
      | tar -xJ -C "$HOME/.local/bin"
  fi

  cargo fetch --manifest-path "$ROOT/programs/aan-missions/Cargo.toml"
}

install_system_packages
ensure_local_bin_on_path
install_node_runtime
check_node_version
install_vara_wallet
install_commentator

if [[ "$PROFILE" == "dev" ]]; then
  install_rust_dev_tools
fi

"$ROOT/scripts/check-local-ops.sh" "--$PROFILE"

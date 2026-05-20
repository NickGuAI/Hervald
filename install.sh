#!/usr/bin/env bash
# Hervald installer.
#
# Piped (no local checkout):
#   curl -fsSL https://hervald.gehirn.ai/install.sh | bash
#
# From a local checkout (apps/hammurabi):
#   ./install.sh
#
# From a local checkout (repo root):
#   bash install.sh

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PRODUCT_NAME="Hervald"
NODE_VERSION="${HERVALD_NODE_VERSION:-22.12.0}"
PNPM_VERSION="${HERVALD_PNPM_VERSION:-10.23.0}"

step() { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

prompt_available() {
  [[ -r /dev/tty && -w /dev/tty ]]
}

prompt_line() {
  local prompt="$1"
  local default_value="${2:-}"
  local reply
  if ! prompt_available; then
    return 1
  fi
  printf "%s" "$prompt" > /dev/tty
  if ! IFS= read -r reply < /dev/tty; then
    return 1
  fi
  if [[ -z "$reply" ]]; then
    reply="$default_value"
  fi
  printf '%s' "$reply"
}

prompt_yes_no() {
  local prompt="$1"
  local default_value="${2:-n}"
  local reply normalized
  reply="$(prompt_line "$prompt" "$default_value" || true)"
  normalized="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_secret() {
  local prompt="$1"
  local reply
  if ! prompt_available; then
    return 1
  fi
  printf "%s" "$prompt" > /dev/tty
  if ! IFS= read -rs reply < /dev/tty; then
    printf '\n' > /dev/tty
    return 1
  fi
  printf '\n' > /dev/tty
  printf '%s' "$reply"
}

install_hint_for_command() {
  local command_name="$1"
  case "$(uname -s):$command_name" in
    Darwin:git)
      printf 'Install Apple Command Line Tools with: xcode-select --install'
      ;;
    Darwin:curl|Darwin:tar)
      printf 'Install Apple Command Line Tools with: xcode-select --install'
      ;;
    Linux:curl)
      printf 'Install curl with your package manager, for example: sudo apt-get install curl'
      ;;
    Linux:tar)
      printf 'Install tar with your package manager, for example: sudo apt-get install tar'
      ;;
    Linux:git)
      printf 'Install git with your package manager, for example: sudo apt-get install git'
      ;;
    *)
      printf 'Install %s and re-run this installer.' "$command_name"
      ;;
  esac
}

require_command_or_prompt() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi

  warn "$command_name is required."
  printf '  %s\n' "$(install_hint_for_command "$command_name")"
  if ! prompt_available; then
    fail "$command_name is required but no interactive terminal is available"
  fi

  while ! command -v "$command_name" >/dev/null 2>&1; do
    prompt_line "Install $command_name, then press Enter to continue: " "" >/dev/null || true
  done
}

git_ready() {
  if [[ "$(uname -s)" == "Darwin" ]] && command -v xcode-select >/dev/null 2>&1; then
    xcode-select -p >/dev/null 2>&1 || return 1
  fi
  command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1
}

ensure_git_or_prompt() {
  if git_ready; then
    return 0
  fi

  warn "Git requires installation before this existing checkout can be refreshed."
  printf '  %s\n' "$(install_hint_for_command git)"
  if ! prompt_available; then
    fail "git is required to refresh existing checkout $CHECKOUT_DIR"
  fi

  until git_ready; do
    prompt_line "Finish Git/Command Line Tools installation, then press Enter to continue: " "" >/dev/null || true
  done
}

repo_archive_url() {
  local repo_url="$1"
  local repo_ref="$2"
  local repo_path

  if [[ -n "${HERVALD_ARCHIVE_URL:-}" ]]; then
    printf '%s' "$HERVALD_ARCHIVE_URL"
    return 0
  fi

  case "$repo_url" in
    https://github.com/*/*.git)
      repo_path="${repo_url#https://github.com/}"
      repo_path="${repo_path%.git}"
      printf 'https://github.com/%s/archive/%s.tar.gz' "$repo_path" "$repo_ref"
      ;;
    https://github.com/*/*)
      repo_path="${repo_url#https://github.com/}"
      repo_path="${repo_path%.git}"
      printf 'https://github.com/%s/archive/%s.tar.gz' "$repo_path" "$repo_ref"
      ;;
    *)
      return 1
      ;;
  esac
}

directory_is_empty() {
  [[ -d "$1" ]] && [[ -z "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
}

replace_checkout_with_archive() {
  local archive_url="$1"
  local tmp_dir archive extract_dir archive_root first_root

  require_command_or_prompt curl
  require_command_or_prompt tar

  step "Downloading Hervald into $CHECKOUT_DIR"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hervald-checkout.XXXXXX")"
  archive="$tmp_dir/hervald.tar.gz"
  extract_dir="$tmp_dir/extract"
  mkdir -p "$extract_dir"

  curl -fsSL "$archive_url" -o "$archive"
  tar -xzf "$archive" -C "$extract_dir"

  if [ -f "$extract_dir/apps/hammurabi/install.sh" ]; then
    archive_root="$extract_dir"
  else
    first_root="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
    [[ -n "$first_root" ]] || fail "Downloaded archive did not contain a repository directory"
    archive_root="$first_root"
  fi

  [ -f "$archive_root/apps/hammurabi/install.sh" ] || fail "Downloaded archive is missing apps/hammurabi/install.sh"

  if [ -e "$CHECKOUT_DIR" ]; then
    rm -rf "$CHECKOUT_DIR"
  fi
  mkdir -p "$(dirname "$CHECKOUT_DIR")"
  mv "$archive_root" "$CHECKOUT_DIR"
  printf 'archive_url=%s\nrepo_ref=%s\n' "$archive_url" "${REPO_REF:-unknown}" > "$CHECKOUT_DIR/.hervald-installer-checkout"
  rm -rf "$tmp_dir"
  ok "downloaded Hervald to $CHECKOUT_DIR"
}

clone_and_exec_installer() {
  REPO_URL="${HERVALD_REPO_URL:-https://github.com/NickGuAI/Hervald.git}"
  REPO_REF="${HERVALD_REPO_REF:-main}"
  CHECKOUT_DIR="${HERVALD_CHECKOUT_DIR:-$HOME/Hervald}"
  ARCHIVE_URL="$(repo_archive_url "$REPO_URL" "$REPO_REF" || true)"

  if [ -d "$CHECKOUT_DIR/.git" ]; then
    ensure_git_or_prompt
    step "Refreshing existing Hervald checkout at $CHECKOUT_DIR"
    git -C "$CHECKOUT_DIR" fetch --quiet origin "$REPO_REF"
    git -C "$CHECKOUT_DIR" checkout --quiet "$REPO_REF"
    git -C "$CHECKOUT_DIR" reset --quiet --hard "origin/$REPO_REF"
  elif [ -n "$ARCHIVE_URL" ]; then
    if [ -e "$CHECKOUT_DIR" ] && ! directory_is_empty "$CHECKOUT_DIR" && [ ! -f "$CHECKOUT_DIR/.hervald-installer-checkout" ]; then
      warn "$CHECKOUT_DIR already exists and is not a Hervald git checkout."
      if ! prompt_yes_no "Replace it with a fresh Hervald download? [y/N] " "n"; then
        fail "Cannot install into existing non-empty directory: $CHECKOUT_DIR"
      fi
    fi
    replace_checkout_with_archive "$ARCHIVE_URL"
  else
    ensure_git_or_prompt
    step "Cloning Hervald into $CHECKOUT_DIR"
    git clone --quiet --branch "$REPO_REF" --single-branch "$REPO_URL" "$CHECKOUT_DIR"
  fi

  exec bash "$CHECKOUT_DIR/apps/hammurabi/install.sh" "$@"
}

# Piped mode: when invoked via `curl ... | bash`, BASH_SOURCE[0] is empty
# and there is no local checkout to install from. Clone the public Hervald
# repo (or refresh an existing clone) and re-exec the in-tree installer.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -z "$SCRIPT_PATH" ] || [ ! -f "$SCRIPT_PATH" ]; then
  clone_and_exec_installer "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
if [ -f "$SCRIPT_DIR/apps/hammurabi/install.sh" ]; then
  exec bash "$SCRIPT_DIR/apps/hammurabi/install.sh" "$@"
fi

if [ ! -f "$SCRIPT_DIR/package.json" ] \
  || [ ! -f "$SCRIPT_DIR/../../pnpm-workspace.yaml" ] \
  || [ ! -d "$SCRIPT_DIR/../../packages/hammurabi-cli" ]; then
  clone_and_exec_installer "$@"
fi

APP_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
CLI_PKG_DIR="$REPO_ROOT/packages/hammurabi-cli"
CLI_BIN_REL="bin/hammurabi.mjs"
DATA_DIR="${HAMMURABI_DATA_DIR:-$HOME/.hammurabi}"
TOOLCHAIN_DIR="${HAMMURABI_TOOLCHAIN_DIR:-$DATA_DIR/toolchain}"
PROVIDER_TOOLS_HOME="${HAMMURABI_PROVIDER_TOOLS_DIR:-$TOOLCHAIN_DIR/provider-tools}"
PROVIDER_BIN_DIR="$PROVIDER_TOOLS_HOME/bin"
APP_PATH_FILE="$DATA_DIR/app-path"
BOOTSTRAP_KEY_FILE="$DATA_DIR/bootstrap-key.txt"
BOOTSTRAP_LOG_DIR="$DATA_DIR/logs"
BOOTSTRAP_LOG_FILE="$BOOTSTRAP_LOG_DIR/first-boot.log"
MACHINES_FILE="$DATA_DIR/machines.json"
LOCAL_MACHINE_ENV_FILE="${HAMMURABI_LOCAL_MACHINE_ENV_FILE:-$HOME/.hammurabi-env}"
BIN_DIR="${HAMMURABI_BIN_DIR:-$HOME/.local/bin}"
SHIM_PATH="$BIN_DIR/hammurabi"
DEFAULT_PORT="20001"
HEALTHCHECK_TIMEOUT_SECONDS="${HAMMURABI_INSTALL_TIMEOUT_SECONDS:-120}"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_PATH="$LAUNCH_AGENT_DIR/io.gehirn.hervald.plist"
LAUNCH_LOG_DIR="$HOME/Library/Logs/hervald"
SKILLS_INSTALLER="$REPO_ROOT/agent-skills/install.sh"
CLAUDE_RUNTIME_ROOT="$HOME/.claude"
CODEX_RUNTIME_ROOT="$HOME/.codex"
NODE_HOME=""
NODE_BIN=""
PNPM_HOME=""
PNPM_BIN=""
PROVIDER_RESULTS=()
INSTALL_LOGIN_URL=""
INSTALL_BOOTSTRAP_KEY=""
INSTALL_KEY_FILE="$BOOTSTRAP_KEY_FILE"
INSTALL_LOG_FILE="$BOOTSTRAP_LOG_FILE"
INSTALL_PATH_NOTE=""
INSTALL_AUTOSTART_STATUS="not installed"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "$value"
}

mac_launch_path() {
  printf '%s' "$BIN_DIR:$PROVIDER_BIN_DIR:$PNPM_HOME/bin:$NODE_HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

ensure_path_block() {
  local file="$1"
  local export_line="export PATH=\"$BIN_DIR:$PROVIDER_BIN_DIR:\$PATH\""

  touch "$file"
  if ! grep -Fq "$export_line" "$file"; then
    {
      printf '\n# >>> hervald installer >>>\n'
      printf '%s\n' "$export_line"
      printf '# <<< hervald installer <<<\n'
    } >> "$file"
  fi
}

ensure_local_path_setup() {
  ensure_path_block "$HOME/.zshrc"
  ensure_path_block "$HOME/.bashrc"
  ensure_path_block "$HOME/.bash_profile"
  ensure_path_block "$HOME/.profile"
}

node_platform() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) fail "unsupported operating system for hermetic Node install: $(uname -s)" ;;
  esac
}

node_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *) fail "unsupported CPU architecture for hermetic Node install: $(uname -m)" ;;
  esac
}

ensure_node() {
  local platform arch archive stem url tmp_dir

  platform="$(node_platform)"
  arch="$(node_arch)"
  stem="node-v${NODE_VERSION}-${platform}-${arch}"
  NODE_HOME="$TOOLCHAIN_DIR/$stem"
  NODE_BIN="$NODE_HOME/bin/node"

  if [ -x "$NODE_BIN" ] && [ "$("$NODE_BIN" -p 'process.versions.node')" = "$NODE_VERSION" ]; then
    ok "node v$NODE_VERSION at $NODE_BIN"
    return 0
  fi

  step "Installing hermetic Node v${NODE_VERSION}"
  mkdir -p "$TOOLCHAIN_DIR"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hervald-node.XXXXXX")"
  archive="$tmp_dir/${stem}.tar.gz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${stem}.tar.gz"

  curl -fsSL "$url" -o "$archive"
  tar -xzf "$archive" -C "$tmp_dir"
  rm -rf "$NODE_HOME"
  mv "$tmp_dir/$stem" "$NODE_HOME"
  rm -rf "$tmp_dir"

  [ -x "$NODE_BIN" ] || fail "Node install failed at $NODE_HOME"
  ok "node $("$NODE_BIN" --version) at $NODE_BIN"
}

ensure_pnpm() {
  local current_version

  PNPM_HOME="$TOOLCHAIN_DIR/pnpm-${PNPM_VERSION}"
  PNPM_BIN="$PNPM_HOME/bin/pnpm"

  if [ -x "$PNPM_BIN" ]; then
    current_version="$("$PNPM_BIN" --version 2>/dev/null || true)"
    if [ "$current_version" = "$PNPM_VERSION" ]; then
      ok "pnpm $PNPM_VERSION at $PNPM_BIN"
      return 0
    fi
  fi

  step "Installing hermetic pnpm ${PNPM_VERSION}"
  rm -rf "$PNPM_HOME"
  mkdir -p "$PNPM_HOME"
  "$NODE_HOME/bin/npm" install --global --prefix "$PNPM_HOME" "pnpm@${PNPM_VERSION}"

  current_version="$("$PNPM_BIN" --version 2>/dev/null || true)"
  [ "$current_version" = "$PNPM_VERSION" ] || fail "pnpm $PNPM_VERSION install failed"
  ok "pnpm $current_version at $PNPM_BIN"
}

auth0_enabled() {
  [[ "${HERVALD_ENABLE_AUTH0:-0}" == "1" ]]
}

configure_environment() {
  step "Configuring environment"
  if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    ok "Created $APP_DIR/.env with zero-config defaults"
  else
    ok ".env already present"
  fi
  ensure_default_master_key_env
}

build_hammurabi() {
  step "Building ${PRODUCT_NAME}"
  if auth0_enabled; then
    "$PNPM_BIN" --dir "$REPO_ROOT" --filter hammurabi run build
    return
  fi

  env \
    -u AUTH0_DOMAIN \
    -u AUTH0_AUDIENCE \
    -u AUTH0_CLIENT_ID \
    -u VITE_AUTH0_DOMAIN \
    -u VITE_AUTH0_AUDIENCE \
    -u VITE_AUTH0_CLIENT_ID \
    "$PNPM_BIN" --dir "$REPO_ROOT" --filter hammurabi run build
}

ensure_default_master_key_env() {
  local env_file="$APP_DIR/.env"

  [ -f "$env_file" ] || return 0
  if grep -Eq '^[[:space:]]*HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=' "$env_file"; then
    ok "bootstrap API-key sign-in already configured in $env_file"
    return 0
  fi

  printf '\nHAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1\n' >> "$env_file"
  ok "enabled bootstrap API-key sign-in in $env_file"
}

single_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

ensure_local_machine_registry() {
  mkdir -p "$DATA_DIR"
  HAMMURABI_DATA_DIR="$DATA_DIR" \
  HAMMURABI_LOCAL_MACHINE_ENV_FILE="$LOCAL_MACHINE_ENV_FILE" \
  "$NODE_BIN" <<'NODE'
const fs = require('fs')
const path = require('path')

const dataDir = process.env.HAMMURABI_DATA_DIR
const machinesFile = path.join(dataDir, 'machines.json')
const envFile = process.env.HAMMURABI_LOCAL_MACHINE_ENV_FILE
let payload = { machines: [] }

if (fs.existsSync(machinesFile)) {
  payload = JSON.parse(fs.readFileSync(machinesFile, 'utf8'))
  if (!payload || !Array.isArray(payload.machines)) {
    throw new Error(`Invalid machines config at ${machinesFile}`)
  }
}

const existing = payload.machines.find((machine) => machine && machine.id === 'local')
const local = {
  id: 'local',
  label: existing?.label || 'Local (this server)',
  host: null,
  ...(existing?.cwd ? { cwd: existing.cwd } : {}),
  envFile: existing?.envFile || envFile,
}

payload.machines = [
  local,
  ...payload.machines.filter((machine) => machine && machine.id !== 'local'),
]

fs.mkdirSync(path.dirname(machinesFile), { recursive: true })
fs.writeFileSync(machinesFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
NODE
  ok "ensured local machine auth target in $MACHINES_FILE"
}

write_local_provider_secret() {
  local key="$1"
  local value="$2"
  local tmp_file quoted_value

  mkdir -p "$(dirname "$LOCAL_MACHINE_ENV_FILE")"
  touch "$LOCAL_MACHINE_ENV_FILE"
  chmod 600 "$LOCAL_MACHINE_ENV_FILE" 2>/dev/null || true

  quoted_value="$(single_quote "$value")"
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/hervald-env.XXXXXX")"
  awk -v key="$key" '
    BEGIN { pattern = "^[[:space:]]*(export[[:space:]]+)?" key "=" }
    $0 !~ pattern { print }
  ' "$LOCAL_MACHINE_ENV_FILE" > "$tmp_file"
  printf 'export %s=%s\n' "$key" "$quoted_value" >> "$tmp_file"
  mv "$tmp_file" "$LOCAL_MACHINE_ENV_FILE"
  chmod 600 "$LOCAL_MACHINE_ENV_FILE"
  export "$key=$value"
}

source_local_provider_env() {
  if [ -f "$LOCAL_MACHINE_ENV_FILE" ]; then
    # This file is created by Hervald with 0600 permissions and `export KEY='value'` lines.
    # Sourcing it keeps install-time probes aligned with server launch behavior.
    # shellcheck disable=SC1090
    . "$LOCAL_MACHINE_ENV_FILE"
  fi
}

provider_label() {
  case "$1" in
    claude) printf 'Claude Code' ;;
    codex) printf 'Codex' ;;
    gemini) printf 'Gemini' ;;
    opencode) printf 'OpenCode' ;;
    *) printf '%s' "$1" ;;
  esac
}

provider_cli() {
  case "$1" in
    claude) printf 'claude' ;;
    codex) printf 'codex' ;;
    gemini) printf 'gemini' ;;
    opencode) printf 'opencode' ;;
    *) return 1 ;;
  esac
}

provider_package() {
  case "$1" in
    claude) printf '@anthropic-ai/claude-code' ;;
    codex) printf '@openai/codex' ;;
    gemini) printf '@google/gemini-cli' ;;
    opencode) printf 'opencode-ai' ;;
    *) return 1 ;;
  esac
}

provider_env_keys() {
  case "$1" in
    claude) printf 'CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN' ;;
    codex) printf 'OPENAI_API_KEY' ;;
    gemini) printf 'GEMINI_API_KEY GOOGLE_API_KEY' ;;
    opencode) printf 'OPENCODE_API_KEY' ;;
    *) return 1 ;;
  esac
}

provider_secret_key() {
  case "$1" in
    claude) printf 'CLAUDE_CODE_OAUTH_TOKEN' ;;
    codex) printf 'OPENAI_API_KEY' ;;
    gemini) printf 'GEMINI_API_KEY' ;;
    opencode) printf 'OPENCODE_API_KEY' ;;
    *) return 1 ;;
  esac
}

provider_env_secret() {
  case "$1" in
    claude) printf '%s' "${HERVALD_CLAUDE_SETUP_TOKEN:-${CLAUDE_CODE_OAUTH_TOKEN:-${ANTHROPIC_API_KEY:-${ANTHROPIC_AUTH_TOKEN:-}}}}" ;;
    codex) printf '%s' "${HERVALD_CODEX_API_KEY:-${OPENAI_API_KEY:-}}" ;;
    gemini) printf '%s' "${HERVALD_GEMINI_API_KEY:-${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}}" ;;
    opencode) printf '%s' "${HERVALD_OPENCODE_API_KEY:-${OPENCODE_API_KEY:-}}" ;;
    *) return 1 ;;
  esac
}

provider_login_status_command() {
  case "$1" in
    claude) printf 'claude auth status' ;;
    codex) printf 'codex login status' ;;
    *) return 1 ;;
  esac
}

provider_auth_hint() {
  case "$1" in
    claude)
      printf 'Run `claude auth login` if your Claude Code version supports it, or run `claude setup-token` and paste the setup token here.'
      ;;
    codex)
      printf 'Run `codex login` in another terminal, or provide OPENAI_API_KEY/HERVALD_CODEX_API_KEY for API-key mode.'
      ;;
    gemini)
      printf 'Provide GEMINI_API_KEY or HERVALD_GEMINI_API_KEY.'
      ;;
    opencode)
      printf 'Provide OPENCODE_API_KEY or HERVALD_OPENCODE_API_KEY.'
      ;;
  esac
}

provider_has_env_auth() {
  local key value
  source_local_provider_env
  for key in $(provider_env_keys "$1"); do
    value="${!key:-}"
    if [[ -n "$value" ]]; then
      return 0
    fi
  done
  return 1
}

provider_has_login_auth() {
  local provider="$1"
  local command_text
  command_text="$(provider_login_status_command "$provider" 2>/dev/null || true)"
  [[ -n "$command_text" ]] || return 1
  bash -lc "$command_text" >/dev/null 2>&1
}

provider_auth_configured() {
  provider_has_env_auth "$1" || provider_has_login_auth "$1"
}

install_provider_cli() {
  local provider="$1"
  local label cli package version
  label="$(provider_label "$provider")"
  cli="$(provider_cli "$provider")"
  package="$(provider_package "$provider")"

  if command -v "$cli" >/dev/null 2>&1; then
    version="$("$cli" --version 2>&1 | head -n 1 || true)"
    ok "$label CLI detected${version:+: $version}"
    return 0
  fi

  step "Installing $label CLI"
  mkdir -p "$PROVIDER_TOOLS_HOME"
  "$NODE_HOME/bin/npm" install --global --prefix "$PROVIDER_TOOLS_HOME" "$package"
  export PATH="$PROVIDER_BIN_DIR:$PATH"

  if ! command -v "$cli" >/dev/null 2>&1; then
    warn "$label CLI install did not expose $cli on PATH"
    return 1
  fi

  version="$("$cli" --version 2>&1 | head -n 1 || true)"
  ok "$label CLI installed${version:+: $version}"
}

configure_provider_auth() {
  local provider="$1"
  local label secret key reply normalized_reply
  label="$(provider_label "$provider")"

  if provider_auth_configured "$provider"; then
    ok "$label auth ready"
    PROVIDER_RESULTS+=("$label:ready")
    return 0
  fi

  secret="$(provider_env_secret "$provider")"
  if [[ -n "$secret" ]]; then
    key="$(provider_secret_key "$provider")"
    write_local_provider_secret "$key" "$secret"
    ok "$label auth saved to $LOCAL_MACHINE_ENV_FILE"
    PROVIDER_RESULTS+=("$label:ready")
    return 0
  fi

  warn "$label is not authenticated."
  printf '  %s\n' "$(provider_auth_hint "$provider")"

  if ! prompt_available; then
    warn "No interactive terminal is available; skipping $label auth."
    PROVIDER_RESULTS+=("$label:unconfigured")
    return 1
  fi

  while true; do
    reply="$(prompt_line "Press y/authenticated after completing auth, key to paste a secret, or skip [$label]: " "y" || true)"
    normalized_reply="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
    case "$normalized_reply" in
      y|yes|authenticated|done)
        if provider_auth_configured "$provider"; then
          ok "$label auth ready"
          PROVIDER_RESULTS+=("$label:ready")
          return 0
        fi
        warn "$label auth still not detected."
        ;;
      key|api-key|token|secret)
        secret="$(prompt_secret "Paste secret for $label: " || true)"
        if [[ -n "$secret" ]]; then
          key="$(provider_secret_key "$provider")"
          write_local_provider_secret "$key" "$secret"
          ok "$label auth saved to $LOCAL_MACHINE_ENV_FILE"
          PROVIDER_RESULTS+=("$label:ready")
          return 0
        fi
        warn "No secret entered for $label."
        ;;
      skip|s|no|n)
        warn "Skipped $label auth."
        PROVIDER_RESULTS+=("$label:unconfigured")
        return 1
        ;;
      *)
        warn "Expected y, authenticated, key, or skip."
        ;;
    esac
  done
}

normalize_provider_selection() {
  local raw="$1"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr ',;' '  ')"
  if [[ -z "${normalized// }" || "$normalized" == "all" ]]; then
    printf 'claude codex gemini opencode'
    return 0
  fi
  if [[ "$normalized" == "none" || "$normalized" == "skip" ]]; then
    printf ''
    return 0
  fi
  printf '%s' "$normalized"
}

configure_providers() {
  local raw_selection selected provider reply

  if [[ "${HERVALD_CONFIGURE_PROVIDERS:-1}" == "0" ]]; then
    warn "Skipping provider setup because HERVALD_CONFIGURE_PROVIDERS=0"
    return 0
  fi

  ensure_local_machine_registry

  raw_selection="${HERVALD_PROVIDERS:-}"
  if [[ -z "$raw_selection" ]]; then
    if ! prompt_available; then
      warn "No interactive terminal is available; skipping provider setup. Re-run with HERVALD_PROVIDERS=claude,codex,gemini,opencode to configure non-interactively."
      return 0
    fi
    reply="$(prompt_line "Configure provider CLIs now? [Y/n] " "y" || true)"
    reply="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
    case "$reply" in
      n|no|skip)
        warn "Skipping provider setup."
        return 0
        ;;
    esac
    raw_selection="$(prompt_line "Providers to configure [all | claude,codex,gemini,opencode]: " "all" || true)"
  fi

  selected="$(normalize_provider_selection "$raw_selection")"
  if [[ -z "${selected// }" ]]; then
    warn "No providers selected."
    return 0
  fi

  step "Configuring provider CLIs"
  for provider in $selected; do
    case "$provider" in
      claude|codex|gemini|opencode)
        if install_provider_cli "$provider"; then
          configure_provider_auth "$provider" || true
        else
          PROVIDER_RESULTS+=("$(provider_label "$provider"):missing-cli")
        fi
        ;;
      *)
        warn "Unknown provider selection: $provider"
        ;;
    esac
  done
}

print_provider_summary() {
  local item label status
  printf '\n%s\n' "${CYAN}Provider readiness${NC}"
  if [[ "${#PROVIDER_RESULTS[@]}" -eq 0 ]]; then
    printf '  No providers were configured by the installer.\n'
    return 0
  fi

  for item in "${PROVIDER_RESULTS[@]}"; do
    label="${item%%:*}"
    status="${item#*:}"
    case "$status" in
      ready) printf '  %s %s: ready\n' "${GREEN}✓${NC}" "$label" ;;
      *) printf '  %s %s: %s\n' "${YELLOW}!${NC}" "$label" "$status" ;;
    esac
  done
  printf '  Local machine env: %s\n' "$LOCAL_MACHINE_ENV_FILE"
}

install_default_skills() {
  [[ -f "$SKILLS_INSTALLER" ]] || fail "Skill installer missing at $SKILLS_INSTALLER"
  [[ -x "$SKILLS_INSTALLER" ]] || chmod +x "$SKILLS_INSTALLER" 2>/dev/null || true

  step "Installing default skills"
  bash "$SKILLS_INSTALLER" --platform claude --target-root "$CLAUDE_RUNTIME_ROOT"
  bash "$SKILLS_INSTALLER" --platform codex --target-root "$CODEX_RUNTIME_ROOT"
  ok "installed default skills"
}

install_launch_agent_if_needed() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    INSTALL_AUTOSTART_STATUS="not supported on $(uname -s)"
    return 0
  fi

  if [[ "${HAMMURABI_INSTALL_AUTOSTART:-1}" == "0" ]]; then
    warn "Skipping launchd autostart because HAMMURABI_INSTALL_AUTOSTART=0"
    INSTALL_AUTOSTART_STATUS="disabled"
    return 0
  fi

  step "Installing launchd LaunchAgent"
  mkdir -p "$LAUNCH_AGENT_DIR" "$LAUNCH_LOG_DIR"

  cat > "$LAUNCH_AGENT_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.gehirn.hervald</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$SHIM_PATH")</string>
    <string>up</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$(xml_escape "$HOME")</string>
    <key>PATH</key>
    <string>$(xml_escape "$(mac_launch_path)")</string>
    <key>HAMMURABI_DATA_DIR</key>
    <string>$(xml_escape "$DATA_DIR")</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$HOME")</string>
  <key>LimitLoadToSessionType</key>
  <array>
    <string>Aqua</string>
  </array>
  <key>ProcessType</key>
  <string>Background</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LAUNCH_LOG_DIR")/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LAUNCH_LOG_DIR")/stderr.log</string>
</dict>
</plist>
EOF

  launchctl unload -w "$LAUNCH_AGENT_PATH" >/dev/null 2>&1 || true
  launchctl load -w "$LAUNCH_AGENT_PATH"
  INSTALL_AUTOSTART_STATUS="installed: $LAUNCH_AGENT_PATH"
  ok "installed $LAUNCH_AGENT_PATH"
}

read_configured_port() {
  local env_file="$APP_DIR/.env"
  local line

  if [ -f "$env_file" ]; then
    line="$(grep -E '^PORT=' "$env_file" | tail -n 1 || true)"
    if [ -n "$line" ]; then
      printf '%s\n' "${line#PORT=}"
      return 0
    fi
  fi

  printf '%s\n' "$DEFAULT_PORT"
}

wait_for_first_boot() {
  local port="$1"
  local child_pid="$2"
  local deadline=$((SECONDS + HEALTHCHECK_TIMEOUT_SECONDS))
  local health_url="http://127.0.0.1:${port}/api/health"

  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "$child_pid" >/dev/null 2>&1; then
      break
    fi

    sleep 2
  done

  return 1
}

start_first_boot() {
  local port="$1"
  local login_url="http://localhost:${port}/org"

  INSTALL_LOGIN_URL="$login_url"
  step "Starting ${PRODUCT_NAME} for first boot"
  mkdir -p "$BOOTSTRAP_LOG_DIR"
  rm -f "$BOOTSTRAP_KEY_FILE" "$BOOTSTRAP_LOG_FILE"

  if auth0_enabled; then
    env HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1 "$SHIM_PATH" up >"$BOOTSTRAP_LOG_FILE" 2>&1 &
  else
    env \
      -u AUTH0_DOMAIN \
      -u AUTH0_AUDIENCE \
      -u AUTH0_CLIENT_ID \
      -u VITE_AUTH0_DOMAIN \
      -u VITE_AUTH0_AUDIENCE \
      -u VITE_AUTH0_CLIENT_ID \
      HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1 \
      "$SHIM_PATH" up >"$BOOTSTRAP_LOG_FILE" 2>&1 &
  fi
  local boot_pid=$!

  if ! wait_for_first_boot "$port" "$boot_pid"; then
    if kill -0 "$boot_pid" >/dev/null 2>&1; then
      kill "$boot_pid" >/dev/null 2>&1 || true
    fi
    fail "First boot did not become healthy in time. Inspect $BOOTSTRAP_LOG_FILE"
  fi

  ok "${PRODUCT_NAME} is running at ${login_url}"

  if [ -f "$BOOTSTRAP_KEY_FILE" ]; then
    local bootstrap_key
    bootstrap_key="$(tr -d '\r\n' < "$BOOTSTRAP_KEY_FILE")"
    if [ -n "$bootstrap_key" ]; then
      printf '\n%s\n' "${GREEN}${PRODUCT_NAME} is ready.${NC}"
      INSTALL_BOOTSTRAP_KEY="$bootstrap_key"
      return 0
    fi
  fi

  warn "The server is healthy, but no bootstrap key file was found."
}

print_receipt_line() {
  local label="$1"
  local value="$2"
  printf "  ${BOLD}%-18s${NC} %s\n" "$label" "$value"
}

print_install_receipt() {
  printf "\n${GREEN}╔════════════════════════════════════════════════════════════╗${NC}\n"
  printf "${GREEN}║${NC} ${BOLD}Hervald setup complete${NC}                                  ${GREEN}║${NC}\n"
  printf "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}\n"
  print_receipt_line "URL" "${INSTALL_LOGIN_URL:-http://localhost:${PORT:-$DEFAULT_PORT}/org}"
  print_receipt_line "Account" "local bootstrap admin"
  print_receipt_line "Password" "not used"
  if [[ -n "$INSTALL_BOOTSTRAP_KEY" ]]; then
    print_receipt_line "Bootstrap API key" "$INSTALL_BOOTSTRAP_KEY"
    print_receipt_line "Key file" "$INSTALL_KEY_FILE"
  else
    print_receipt_line "Bootstrap API key" "not found; inspect $INSTALL_LOG_FILE"
  fi
  print_receipt_line "CLI" "$SHIM_PATH"
  print_receipt_line "Doctor" "hammurabi doctor"
  print_receipt_line "App directory" "$APP_DIR"
  print_receipt_line "Data directory" "$DATA_DIR"
  print_receipt_line "Autostart" "$INSTALL_AUTOSTART_STATUS"
  print_receipt_line "Log" "$INSTALL_LOG_FILE"

  if [[ -n "$INSTALL_PATH_NOTE" ]]; then
    printf "\n${YELLOW}PATH setup${NC}\n"
    printf "  %s\n" "$INSTALL_PATH_NOTE"
  fi

  print_provider_summary
}

printf "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}\n"
printf "${CYAN}║${NC} ${BOLD}${PRODUCT_NAME} installer${NC}                                        ${CYAN}║${NC}\n"
printf "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}\n"
printf "  app:  %s\n" "$APP_DIR"
printf "  repo: %s\n" "$REPO_ROOT"
printf "  bin:  %s\n\n" "$SHIM_PATH"

step "Checking prerequisites"
require_command_or_prompt curl
require_command_or_prompt tar
ensure_node
export PATH="$NODE_HOME/bin:$PATH"
ensure_pnpm
export PATH="$PROVIDER_BIN_DIR:$PNPM_HOME/bin:$NODE_HOME/bin:$PATH"

configure_environment

step "Installing workspace dependencies"
"$PNPM_BIN" --dir "$REPO_ROOT" install --frozen-lockfile

build_hammurabi

[ -x "$CLI_PKG_DIR/$CLI_BIN_REL" ] || chmod +x "$CLI_PKG_DIR/$CLI_BIN_REL" 2>/dev/null || true
[ -f "$CLI_PKG_DIR/dist/index.js" ] || fail "CLI build missing at $CLI_PKG_DIR/dist/index.js"

step "Recording app path"
mkdir -p "$DATA_DIR"
printf "%s\n" "$APP_DIR" > "$APP_PATH_FILE"
ok "wrote $APP_PATH_FILE"

step "Installing hammurabi CLI shim"
mkdir -p "$BIN_DIR"
cat > "$SHIM_PATH" <<EOF
#!/usr/bin/env bash
export PATH="$PROVIDER_BIN_DIR:$PNPM_HOME/bin:$NODE_HOME/bin:\$PATH"
exec "$NODE_BIN" "$CLI_PKG_DIR/$CLI_BIN_REL" "\$@"
EOF
chmod +x "$SHIM_PATH"
ensure_local_path_setup
ok "installed $SHIM_PATH"

install_default_skills
configure_providers

case ":$PATH:" in
  *":$BIN_DIR:"*) ok "$BIN_DIR already on PATH" ;;
  *)
    INSTALL_PATH_NOTE="Add $BIN_DIR to PATH, then reopen your shell: export PATH=\"$BIN_DIR:\$PATH\""
    warn "Add $BIN_DIR to PATH, then reopen your shell:"
    printf "    export PATH=\"%s:\$PATH\"\n" "$BIN_DIR"
    ;;
esac

PORT="$(read_configured_port)"
start_first_boot "$PORT"

install_launch_agent_if_needed

print_install_receipt

printf "\n${GREEN}Next:${NC}\n"
if [[ "$(uname -s)" == "Darwin" && "${HAMMURABI_INSTALL_AUTOSTART:-1}" != "0" ]]; then
  printf "  1. Sign in with the bootstrap key shown above.\n"
  printf "  2. Create a permanent API key in Settings, then rotate or revoke the bootstrap key.\n"
  printf "  3. Hervald now auto-starts at login via launchd.\n"
  printf "     Reload after config changes with:\n"
  printf "       ${CYAN}launchctl kickstart -k gui/%s/io.gehirn.hervald${NC}\n" "$(id -u)"
  printf "  4. Run ${CYAN}hammurabi doctor${NC} after provider authentication.\n"
  printf "  5. Optional: run ${CYAN}hammurabi onboard${NC} to seed CLI integrations.\n"
else
  printf "  1. Sign in with the bootstrap key shown above.\n"
  printf "  2. Create a permanent API key in Settings, then rotate or revoke the bootstrap key.\n"
  printf "  3. The server is already running in the background.\n"
  printf "     Restart later with ${CYAN}hammurabi up${NC} (or ${CYAN}hammurabi up --dev${NC} for hot reload).\n"
  printf "  4. Run ${CYAN}hammurabi doctor${NC} after provider authentication.\n"
  printf "  5. Optional: run ${CYAN}hammurabi onboard${NC} to seed CLI integrations.\n"
fi

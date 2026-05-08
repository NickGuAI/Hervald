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
NC='\033[0m'

PRODUCT_NAME="Hervald"
NODE_VERSION="${HERVALD_NODE_VERSION:-22.12.0}"
PNPM_VERSION="${HERVALD_PNPM_VERSION:-10.23.0}"

step() { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# Piped mode: when invoked via `curl ... | bash`, BASH_SOURCE[0] is empty
# and there is no local checkout to install from. Clone the public Hervald
# repo (or refresh an existing clone) and re-exec the in-tree installer.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -z "$SCRIPT_PATH" ] || [ ! -f "$SCRIPT_PATH" ]; then
  command -v git >/dev/null || fail "git not found (required when piping the installer)"
  REPO_URL="${HERVALD_REPO_URL:-https://github.com/NickGuAI/Hervald.git}"
  REPO_REF="${HERVALD_REPO_REF:-main}"
  CHECKOUT_DIR="${HERVALD_CHECKOUT_DIR:-$HOME/Hervald}"

  if [ -d "$CHECKOUT_DIR/.git" ]; then
    step "Refreshing existing Hervald checkout at $CHECKOUT_DIR"
    git -C "$CHECKOUT_DIR" fetch --quiet origin "$REPO_REF"
    git -C "$CHECKOUT_DIR" checkout --quiet "$REPO_REF"
    git -C "$CHECKOUT_DIR" reset --quiet --hard "origin/$REPO_REF"
  else
    step "Cloning Hervald into $CHECKOUT_DIR"
    git clone --quiet --branch "$REPO_REF" --single-branch "$REPO_URL" "$CHECKOUT_DIR"
  fi

  exec bash "$CHECKOUT_DIR/apps/hammurabi/install.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
if [ -f "$SCRIPT_DIR/apps/hammurabi/install.sh" ]; then
  exec bash "$SCRIPT_DIR/apps/hammurabi/install.sh" "$@"
fi

APP_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
CLI_PKG_DIR="$REPO_ROOT/packages/hammurabi-cli"
CLI_BIN_REL="bin/hammurabi.mjs"
DATA_DIR="${HAMMURABI_DATA_DIR:-$HOME/.hammurabi}"
TOOLCHAIN_DIR="${HAMMURABI_TOOLCHAIN_DIR:-$DATA_DIR/toolchain}"
APP_PATH_FILE="$DATA_DIR/app-path"
BOOTSTRAP_KEY_FILE="$DATA_DIR/bootstrap-key.txt"
BOOTSTRAP_LOG_DIR="$DATA_DIR/logs"
BOOTSTRAP_LOG_FILE="$BOOTSTRAP_LOG_DIR/first-boot.log"
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
  printf '%s' "$BIN_DIR:$PNPM_HOME/bin:$NODE_HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

ensure_path_block() {
  local file="$1"
  local export_line="export PATH=\"$BIN_DIR:\$PATH\""

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
    return 0
  fi

  if [[ "${HAMMURABI_INSTALL_AUTOSTART:-1}" == "0" ]]; then
    warn "Skipping launchd autostart because HAMMURABI_INSTALL_AUTOSTART=0"
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
  local login_url="http://localhost:${port}/app"

  step "Starting ${PRODUCT_NAME} for first boot"
  mkdir -p "$BOOTSTRAP_LOG_DIR"
  rm -f "$BOOTSTRAP_KEY_FILE" "$BOOTSTRAP_LOG_FILE"

  env HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1 "$SHIM_PATH" up >"$BOOTSTRAP_LOG_FILE" 2>&1 &
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
      printf '  URL: %s\n' "$login_url"
      printf '  API key: %s\n' "$bootstrap_key"
      printf '  Key file: %s\n' "$BOOTSTRAP_KEY_FILE"
      printf '  Log: %s\n' "$BOOTSTRAP_LOG_FILE"
      return 0
    fi
  fi

  warn "The server is healthy, but no bootstrap key file was found."
  printf '  URL: %s\n' "$login_url"
  printf '  Log: %s\n' "$BOOTSTRAP_LOG_FILE"
}

printf "${CYAN}${PRODUCT_NAME} installer${NC}\n"
printf "  app:  %s\n" "$APP_DIR"
printf "  repo: %s\n" "$REPO_ROOT"
printf "  bin:  %s\n\n" "$SHIM_PATH"

step "Checking prerequisites"
command -v curl >/dev/null || fail "curl not found"
command -v git >/dev/null || fail "git not found"
command -v tar >/dev/null || fail "tar not found"
ensure_node
ensure_pnpm
export PATH="$PNPM_HOME/bin:$NODE_HOME/bin:$PATH"

step "Installing workspace dependencies"
"$PNPM_BIN" --dir "$REPO_ROOT" install --frozen-lockfile

step "Building Hammurabi"
"$PNPM_BIN" --dir "$REPO_ROOT" --filter hammurabi run build

[ -x "$CLI_PKG_DIR/$CLI_BIN_REL" ] || chmod +x "$CLI_PKG_DIR/$CLI_BIN_REL" 2>/dev/null || true
[ -f "$CLI_PKG_DIR/dist/index.js" ] || fail "CLI build missing at $CLI_PKG_DIR/dist/index.js"

step "Configuring environment"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  ok "Created $APP_DIR/.env with zero-config defaults"
else
  ok ".env already present"
fi
ensure_default_master_key_env

step "Recording app path"
mkdir -p "$DATA_DIR"
printf "%s\n" "$APP_DIR" > "$APP_PATH_FILE"
ok "wrote $APP_PATH_FILE"

step "Installing hammurabi CLI shim"
mkdir -p "$BIN_DIR"
cat > "$SHIM_PATH" <<EOF
#!/usr/bin/env bash
export PATH="$PNPM_HOME/bin:$NODE_HOME/bin:\$PATH"
exec "$NODE_BIN" "$CLI_PKG_DIR/$CLI_BIN_REL" "\$@"
EOF
chmod +x "$SHIM_PATH"
ensure_local_path_setup
ok "installed $SHIM_PATH"

install_default_skills

case ":$PATH:" in
  *":$BIN_DIR:"*) ok "$BIN_DIR already on PATH" ;;
  *)
    warn "Add $BIN_DIR to PATH, then reopen your shell:"
    printf "    export PATH=\"%s:\$PATH\"\n" "$BIN_DIR"
    ;;
esac

PORT="$(read_configured_port)"
start_first_boot "$PORT"

install_launch_agent_if_needed

printf "\n${GREEN}Done.${NC} Next:\n"
if [[ "$(uname -s)" == "Darwin" && "${HAMMURABI_INSTALL_AUTOSTART:-1}" != "0" ]]; then
  printf "  1. Sign in with the bootstrap key shown above.\n"
  printf "  2. Create a permanent API key in Settings, then rotate or revoke the bootstrap key.\n"
  printf "  3. Hervald now auto-starts at login via launchd.\n"
  printf "     Reload after config changes with:\n"
  printf "       ${CYAN}launchctl kickstart -k gui/%s/io.gehirn.hervald${NC}\n" "$(id -u)"
  printf "  4. Optional: run ${CYAN}hammurabi onboard${NC} to seed CLI integrations.\n"
else
  printf "  1. Sign in with the bootstrap key shown above.\n"
  printf "  2. Create a permanent API key in Settings, then rotate or revoke the bootstrap key.\n"
  printf "  3. The server is already running in the background.\n"
  printf "     Restart later with ${CYAN}hammurabi up${NC} (or ${CYAN}hammurabi up --dev${NC} for hot reload).\n"
  printf "  4. Optional: run ${CYAN}hammurabi onboard${NC} to seed CLI integrations.\n"
fi

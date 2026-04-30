#!/usr/bin/env bash
# Hammurabi local installer.
#
# From apps/hammurabi (or anywhere), run:
#   ./install.sh

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

PRODUCT_NAME="Hervald"

step() { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
CLI_PKG_DIR="$REPO_ROOT/packages/hammurabi-cli"
CLI_BIN_REL="bin/hammurabi.mjs"
DATA_DIR="${HAMMURABI_DATA_DIR:-$HOME/.hammurabi}"
APP_PATH_FILE="$DATA_DIR/app-path"
BOOTSTRAP_KEY_FILE="$DATA_DIR/bootstrap-key.txt"
BOOTSTRAP_LOG_DIR="$DATA_DIR/logs"
BOOTSTRAP_LOG_FILE="$BOOTSTRAP_LOG_DIR/first-boot.log"
BIN_DIR="${HAMMURABI_BIN_DIR:-$HOME/.local/bin}"
SHIM_PATH="$BIN_DIR/hammurabi"
DEFAULT_PORT="20001"
HEALTHCHECK_TIMEOUT_SECONDS="${HAMMURABI_INSTALL_TIMEOUT_SECONDS:-120}"
LAUNCH_AGENT_TEMPLATE="$REPO_ROOT/operations/deploy/mac-mini/io.gehirn.hervald.plist"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_PATH="$LAUNCH_AGENT_DIR/io.gehirn.hervald.plist"
LAUNCH_LOG_DIR="$HOME/Library/Logs/hervald"

escape_sed_replacement() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//&/\\&}"
  printf '%s' "$value"
}

mac_launch_path() {
  printf '%s' "$BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
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
  ensure_path_block "$HOME/.bash_profile"
  ensure_path_block "$HOME/.profile"
}

install_launch_agent_if_needed() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi

  if [[ "${HAMMURABI_INSTALL_AUTOSTART:-1}" == "0" ]]; then
    warn "Skipping launchd autostart because HAMMURABI_INSTALL_AUTOSTART=0"
    return 0
  fi

  [[ -f "$LAUNCH_AGENT_TEMPLATE" ]] || fail "LaunchAgent template missing at $LAUNCH_AGENT_TEMPLATE"

  step "Installing launchd LaunchAgent"
  mkdir -p "$LAUNCH_AGENT_DIR" "$LAUNCH_LOG_DIR"

  sed \
    -e "s|__HAMMURABI_BIN__|$(escape_sed_replacement "$SHIM_PATH")|g" \
    -e "s|__HOME__|$(escape_sed_replacement "$HOME")|g" \
    -e "s|__PATH__|$(escape_sed_replacement "$(mac_launch_path)")|g" \
    -e "s|__DATA_DIR__|$(escape_sed_replacement "$DATA_DIR")|g" \
    -e "s|__LOG_DIR__|$(escape_sed_replacement "$LAUNCH_LOG_DIR")|g" \
    "$LAUNCH_AGENT_TEMPLATE" > "$LAUNCH_AGENT_PATH"

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
command -v node >/dev/null || fail "node not found (need Node 22+)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "node $NODE_MAJOR detected; need Node 22+"
ok "node $(node --version)"
command -v pnpm >/dev/null || fail "pnpm not found (install via: corepack enable && corepack prepare pnpm@10.23.0 --activate)"
ok "pnpm $(pnpm --version)"

step "Installing workspace dependencies"
pnpm --dir "$REPO_ROOT" install --frozen-lockfile

step "Building Hammurabi"
pnpm --dir "$REPO_ROOT" --filter hammurabi run build

[ -x "$CLI_PKG_DIR/$CLI_BIN_REL" ] || chmod +x "$CLI_PKG_DIR/$CLI_BIN_REL" 2>/dev/null || true
[ -f "$CLI_PKG_DIR/dist/index.js" ] || fail "CLI build missing at $CLI_PKG_DIR/dist/index.js"

step "Configuring environment"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  ok "Created $APP_DIR/.env with zero-config defaults"
else
  ok ".env already present"
fi

step "Recording app path"
mkdir -p "$DATA_DIR"
printf "%s\n" "$APP_DIR" > "$APP_PATH_FILE"
ok "wrote $APP_PATH_FILE"

step "Installing hammurabi CLI shim"
mkdir -p "$BIN_DIR"
cat > "$SHIM_PATH" <<EOF
#!/usr/bin/env bash
exec node "$CLI_PKG_DIR/$CLI_BIN_REL" "\$@"
EOF
chmod +x "$SHIM_PATH"
ensure_local_path_setup
ok "installed $SHIM_PATH"

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

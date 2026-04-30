#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Hervald"
REPO_SLUG="${HERVALD_REPO_SLUG:-NickGuAI/Hervald}"
REPO_PRIVATE="${HERVALD_REPO_PRIVATE:-0}"
INSTALL_DIR="${HAMMURABI_INSTALL_DIR:-$HOME/.hammurabi}"
DATA_DIR="${HAMMURABI_DATA_DIR:-$HOME/.hammurabi}"
BOOTSTRAP_KEY_FILE="$DATA_DIR/bootstrap-key.txt"
BOOTSTRAP_LOG_DIR="$DATA_DIR/logs"
BOOTSTRAP_LOG_FILE="$BOOTSTRAP_LOG_DIR/first-boot.log"
CLI_NAME="hammurabi"
REQUIRED_NODE_MAJOR="22"
REQUIRED_NODE_VERSION="22.12.0"
REQUIRED_PNPM_VERSION="10.23.0"
REPO_BRANCH="${HERVALD_BRANCH:-main}"
DEFAULT_PORT="20001"
HEALTHCHECK_TIMEOUT_SECONDS="${HAMMURABI_INSTALL_TIMEOUT_SECONDS:-120}"

TARGET=""
TARGET_DOMAIN=""
APP_DIR=""
APP_PACKAGE_NAME=""
CLI_ENTRYPOINT=""
MAC_LAUNCH_TEMPLATE=""

log() {
  printf '%s\n' "$*"
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: curl https://hervald.gehirn.ai/install.sh | bash [--target mac-mini|ec2|local]

Options:
  --target <name>       mac-mini, ec2, or local
  --domain <fqdn>       Required for --target ec2
  --repo-slug <owner/name>
                        Override the GitHub repo (default: ${REPO_SLUG})
  --branch <branch>     Override the Git branch (default: ${REPO_BRANCH})
  --install-dir <path>  Override the checkout directory (default: ${INSTALL_DIR})
  -h, --help            Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target)
        [[ $# -ge 2 ]] || die "--target requires a value"
        TARGET="$2"
        shift 2
        ;;
      --target=*)
        TARGET="${1#*=}"
        shift
        ;;
      --domain)
        [[ $# -ge 2 ]] || die "--domain requires a value"
        TARGET_DOMAIN="$2"
        shift 2
        ;;
      --domain=*)
        TARGET_DOMAIN="${1#*=}"
        shift
        ;;
      --repo-slug)
        [[ $# -ge 2 ]] || die "--repo-slug requires a value"
        REPO_SLUG="$2"
        shift 2
        ;;
      --repo-slug=*)
        REPO_SLUG="${1#*=}"
        shift
        ;;
      --branch)
        [[ $# -ge 2 ]] || die "--branch requires a value"
        REPO_BRANCH="$2"
        shift 2
        ;;
      --branch=*)
        REPO_BRANCH="${1#*=}"
        shift
        ;;
      --install-dir)
        [[ $# -ge 2 ]] || die "--install-dir requires a value"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --install-dir=*)
        INSTALL_DIR="${1#*=}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

version_at_least() {
  local version="${1#v}"
  local required="${2#v}"
  local v_major=0
  local v_minor=0
  local v_patch=0
  local r_major=0
  local r_minor=0
  local r_patch=0

  IFS=. read -r v_major v_minor v_patch <<<"$version"
  IFS=. read -r r_major r_minor r_patch <<<"$required"

  if (( v_major > r_major )); then
    return 0
  fi
  if (( v_major < r_major )); then
    return 1
  fi
  if (( v_minor > r_minor )); then
    return 0
  fi
  if (( v_minor < r_minor )); then
    return 1
  fi
  if (( v_patch >= r_patch )); then
    return 0
  fi
  return 1
}

ensure_prereq() {
  command -v "$1" >/dev/null 2>&1 || die "Missing prerequisite: $1"
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    return 0
  fi

  return 1
}

install_nvm() {
  if load_nvm; then
    return 0
  fi

  log "Installing nvm..."
  if ! curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash; then
    log "nvm installation failed; trying the system package manager instead..."
    return 1
  fi

  load_nvm || return 1
}

install_node_with_nvm() {
  install_nvm || return 1
  log "Installing Node ${REQUIRED_NODE_VERSION} with nvm..."
  nvm install "$REQUIRED_NODE_VERSION" >/dev/null
  nvm alias default "$REQUIRED_NODE_VERSION" >/dev/null
  nvm use "$REQUIRED_NODE_VERSION" >/dev/null
}

install_node_with_package_manager() {
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        log "Installing Node ${REQUIRED_NODE_VERSION} with Homebrew..."
        brew install "node@${REQUIRED_NODE_MAJOR}"
        export PATH="$(brew --prefix "node@${REQUIRED_NODE_MAJOR}")/bin:$PATH"
        return 0
      fi
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        log "Installing Node ${REQUIRED_NODE_VERSION} with apt..."
        curl -fsSL "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo -E bash -
        sudo -E apt-get install -y nodejs
        return 0
      fi

      if command -v dnf >/dev/null 2>&1; then
        log "Installing Node ${REQUIRED_NODE_VERSION} with dnf..."
        curl -fsSL "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo -E bash -
        sudo -E dnf install -y nodejs
        return 0
      fi

      if command -v yum >/dev/null 2>&1; then
        log "Installing Node ${REQUIRED_NODE_VERSION} with yum..."
        curl -fsSL "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo -E bash -
        sudo -E yum install -y nodejs
        return 0
      fi

      if command -v pacman >/dev/null 2>&1; then
        log "Installing Node ${REQUIRED_NODE_VERSION} with pacman..."
        sudo pacman -Sy --noconfirm nodejs npm
        return 0
      fi
      ;;
  esac

  die "Unable to install Node ${REQUIRED_NODE_VERSION}. Install Node manually and re-run the installer."
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local current_node
    current_node="$(node -p 'process.version' 2>/dev/null || true)"
    if [[ -n "$current_node" ]] && version_at_least "$current_node" "$REQUIRED_NODE_VERSION"; then
      return 0
    fi
  fi

  if install_node_with_nvm; then
    return 0
  fi

  install_node_with_package_manager

  local current_node
  current_node="$(node -p 'process.version' 2>/dev/null || true)"
  if [[ -n "$current_node" ]] && version_at_least "$current_node" "$REQUIRED_NODE_VERSION"; then
    return 0
  fi

  die "Node ${REQUIRED_NODE_VERSION} or newer is required."
}

ensure_pnpm() {
  ensure_prereq corepack
  corepack enable >/dev/null 2>&1 || true
  corepack prepare "pnpm@${REQUIRED_PNPM_VERSION}" --activate >/dev/null
}

ensure_path_block() {
  local file="$1"
  local export_line="export PATH=\"$HOME/.local/bin:\$PATH\""

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

normalize_target() {
  if [[ -n "$TARGET" ]]; then
    case "$TARGET" in
      mac-mini|ec2|local) printf '%s' "$TARGET" ;;
      *) die "Unsupported target: $TARGET" ;;
    esac
    return 0
  fi

  case "$(uname -s)" in
    Darwin) printf 'mac-mini' ;;
    Linux) printf 'local' ;;
    *) die "Unsupported operating system: $(uname -s)" ;;
  esac
}

build_raw_github_url() {
  local relative_path="$1"
  printf 'https://raw.githubusercontent.com/%s/%s/%s\n' "$REPO_SLUG" "$REPO_BRANCH" "$relative_path"
}

prompt_for_domain() {
  if [[ -n "$TARGET_DOMAIN" ]]; then
    return 0
  fi

  if [[ -t 0 ]]; then
    read -r -p "Domain for Hervald (e.g. mybox.example.com): " TARGET_DOMAIN
  fi

  [[ -n "$TARGET_DOMAIN" ]] || die "--domain is required when --target ec2 is used."
}

delegate_ec2_install() {
  [[ "$(id -u)" -eq 0 ]] || die "EC2 installs must run under sudo."
  prompt_for_domain

  local raw_url
  raw_url="$(build_raw_github_url 'operations/deploy/ec2/install-ec2.sh')"

  log "Delegating EC2 install to ${raw_url}"
  curl -fsSL "$raw_url" | bash -s -- --domain "$TARGET_DOMAIN" --repo-slug "$REPO_SLUG" --branch "$REPO_BRANCH"
}

clone_or_update_repo() {
  local https_url="https://github.com/$REPO_SLUG.git"
  local ssh_url="git@github.com:$REPO_SLUG.git"
  local ssh_probe_command="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

  mkdir -p "$(dirname "$INSTALL_DIR")"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    local remote_url
    remote_url="$(git -C "$INSTALL_DIR" remote get-url origin)"
    case "$remote_url" in
      "$https_url" | "$ssh_url")
        ;;
      *)
        die "Existing checkout at $INSTALL_DIR points to $remote_url, expected $REPO_SLUG"
        ;;
    esac

    if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]]; then
      die "Existing checkout at $INSTALL_DIR has local changes. Clean it up before re-running the installer."
    fi

    git -C "$INSTALL_DIR" fetch origin "$REPO_BRANCH"
    git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"
    return 0
  fi

  if [[ -e "$INSTALL_DIR" ]]; then
    die "$INSTALL_DIR exists and is not a git checkout."
  fi

  if [[ "$REPO_PRIVATE" == "1" ]]; then
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      gh repo clone "$REPO_SLUG" "$INSTALL_DIR" -- --branch "$REPO_BRANCH"
      return 0
    fi

    if GIT_SSH_COMMAND="$ssh_probe_command" git ls-remote "$ssh_url" >/dev/null 2>&1; then
      GIT_SSH_COMMAND="$ssh_probe_command" git clone --branch "$REPO_BRANCH" --single-branch "$ssh_url" "$INSTALL_DIR"
      return 0
    fi

    die "Access to $REPO_SLUG is required. Run 'gh auth login' or configure GitHub SSH access, then re-run this installer."
  fi

  git clone --depth 1 --branch "$REPO_BRANCH" "$https_url" "$INSTALL_DIR"
}

resolve_repo_layout() {
  local candidate

  for candidate in "$INSTALL_DIR/apps/hammurabi" "$INSTALL_DIR/app"; do
    if [[ -f "$candidate/package.json" ]]; then
      APP_DIR="$candidate"
      break
    fi
  done

  [[ -n "$APP_DIR" ]] || die "Unable to locate the Hervald app directory in $INSTALL_DIR"

  for candidate in \
    "$INSTALL_DIR/packages/hammurabi-cli/bin/hammurabi.mjs" \
    "$INSTALL_DIR/packages/cli/bin/hammurabi.mjs"
  do
    if [[ -f "$candidate" ]]; then
      CLI_ENTRYPOINT="$candidate"
      break
    fi
  done

  [[ -n "$CLI_ENTRYPOINT" ]] || die "Unable to locate the hammurabi CLI entrypoint in $INSTALL_DIR"

  APP_PACKAGE_NAME="$(
    node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).name" \
      "$APP_DIR/package.json"
  )"

  MAC_LAUNCH_TEMPLATE="$INSTALL_DIR/operations/deploy/mac-mini/io.gehirn.hervald.plist"
}

install_and_build() {
  log "Installing workspace dependencies..."
  pnpm --dir "$INSTALL_DIR" install --frozen-lockfile

  log "Building ${APP_PACKAGE_NAME}..."
  pnpm --dir "$INSTALL_DIR" --filter "$APP_PACKAGE_NAME" run build
}

copy_env_example_if_missing() {
  if [[ -f "$APP_DIR/.env" || ! -f "$APP_DIR/.env.example" ]]; then
    return 0
  fi

  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  log "Created ${APP_DIR}/.env with zero-config defaults"
}

write_app_path_file() {
  mkdir -p "$DATA_DIR"
  printf '%s\n' "$APP_DIR" > "$DATA_DIR/app-path"
}

link_cli() {
  mkdir -p "$HOME/.local/bin"
  [[ -x "$CLI_ENTRYPOINT" ]] || chmod +x "$CLI_ENTRYPOINT" 2>/dev/null || true
  ln -sfn "$CLI_ENTRYPOINT" "$HOME/.local/bin/$CLI_NAME"
  ensure_local_path_setup
}

escape_sed_replacement() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//&/\\&}"
  printf '%s' "$value"
}

mac_launch_path() {
  printf '%s' "$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

install_mac_launch_agent() {
  [[ "$(uname -s)" == "Darwin" ]] || die "--target mac-mini is only supported on macOS."
  [[ -f "$MAC_LAUNCH_TEMPLATE" ]] || die "Missing LaunchAgent template at $MAC_LAUNCH_TEMPLATE"

  local launch_agent_dir="$HOME/Library/LaunchAgents"
  local launch_agent_path="$launch_agent_dir/io.gehirn.hervald.plist"
  local launch_log_dir="$HOME/Library/Logs/hervald"

  log "Installing launchd LaunchAgent..."
  mkdir -p "$launch_agent_dir" "$launch_log_dir"

  sed \
    -e "s|__HAMMURABI_BIN__|$(escape_sed_replacement "$HOME/.local/bin/$CLI_NAME")|g" \
    -e "s|__HOME__|$(escape_sed_replacement "$HOME")|g" \
    -e "s|__PATH__|$(escape_sed_replacement "$(mac_launch_path)")|g" \
    -e "s|__DATA_DIR__|$(escape_sed_replacement "$DATA_DIR")|g" \
    -e "s|__LOG_DIR__|$(escape_sed_replacement "$launch_log_dir")|g" \
    "$MAC_LAUNCH_TEMPLATE" > "$launch_agent_path"

  launchctl unload -w "$launch_agent_path" >/dev/null 2>&1 || true
  launchctl load -w "$launch_agent_path"
}

read_configured_port() {
  local env_file="$APP_DIR/.env"
  local line

  if [[ -f "$env_file" ]]; then
    line="$(grep -E '^PORT=' "$env_file" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
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

  while [[ "$SECONDS" -lt "$deadline" ]]; do
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

  log "Starting ${APP_NAME} for first boot..."
  mkdir -p "$BOOTSTRAP_LOG_DIR"
  rm -f "$BOOTSTRAP_KEY_FILE" "$BOOTSTRAP_LOG_FILE"

  env HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1 "$HOME/.local/bin/$CLI_NAME" up >"$BOOTSTRAP_LOG_FILE" 2>&1 &
  local boot_pid=$!

  if ! wait_for_first_boot "$port" "$boot_pid"; then
    if kill -0 "$boot_pid" >/dev/null 2>&1; then
      kill "$boot_pid" >/dev/null 2>&1 || true
    fi
    die "First boot did not become healthy in time. Inspect $BOOTSTRAP_LOG_FILE"
  fi

  log "${APP_NAME} is running at ${login_url}"

  if [[ -f "$BOOTSTRAP_KEY_FILE" ]]; then
    local bootstrap_key
    bootstrap_key="$(tr -d '\r\n' < "$BOOTSTRAP_KEY_FILE")"
    if [[ -n "$bootstrap_key" ]]; then
      log
      log "${APP_NAME} is ready."
      log "  URL: ${login_url}"
      log "  API key: ${bootstrap_key}"
      log "  Key file: ${BOOTSTRAP_KEY_FILE}"
      log "  Log: ${BOOTSTRAP_LOG_FILE}"
      return 0
    fi
  fi

  log "Warning: the server is healthy, but no bootstrap key file was found."
  log "  URL: ${login_url}"
  log "  Log: ${BOOTSTRAP_LOG_FILE}"
}

print_next_steps() {
  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    log "Reload your shell if \$HOME/.local/bin is not yet on PATH:"
    log "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  case "$TARGET" in
    mac-mini)
      log
      log "Install complete."
      log "Sign in with the bootstrap key shown above."
      log "Create a permanent API key in Settings, then rotate or revoke the bootstrap key."
      log "Autostart is configured via launchd."
      log "Reload after config changes with:"
      log "  launchctl kickstart -k gui/$(id -u)/io.gehirn.hervald"
      log "Optional: run '$CLI_NAME onboard' to seed CLI integrations."
      ;;
    local)
      log
      log "Install complete."
      log "Sign in with the bootstrap key shown above."
      log "Create a permanent API key in Settings, then rotate or revoke the bootstrap key."
      log "The server is already running in the background."
      log "Restart later with '$CLI_NAME up' or '$CLI_NAME up --dev'."
      log "Optional: run '$CLI_NAME onboard' to seed CLI integrations."
      ;;
  esac
}

main() {
  ensure_prereq curl
  ensure_prereq git
  ensure_prereq uname
  ensure_prereq ln

  parse_args "$@"
  TARGET="$(normalize_target)"

  if [[ "$TARGET" == "ec2" ]]; then
    delegate_ec2_install
    return 0
  fi

  ensure_node
  ensure_pnpm
  clone_or_update_repo
  resolve_repo_layout
  install_and_build
  copy_env_example_if_missing
  write_app_path_file
  link_cli

  local port
  port="$(read_configured_port)"
  start_first_boot "$port"

  if [[ "$TARGET" == "mac-mini" ]]; then
    install_mac_launch_agent
  fi

  print_next_steps
}

main "$@"

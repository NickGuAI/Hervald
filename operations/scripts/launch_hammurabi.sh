#!/bin/bash

# Script to launch Hervald in tmux

# Colors and symbols
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
CHECKMARK='✓'
CROSS='✗'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_launch_helpers.sh"
ensure_hermetic_launch_env "$@"


APP_DIR="$MONOREPO_DIR/apps/hammurabi"
PUBLIC_SHELL_PORT=20001
PUBLIC_SHELL_DOMAIN="hervald.gehirn.ai"
PRIVATE_API_PORT=20009
PRIVATE_BIND_HOST="127.0.0.1"
PORT=""
PORT_EXPLICIT=0
SESSION_NAME="server-hammurabi"
MODE="prod"
SESSION_NAME_EXPLICIT=0

print_usage() {
    cat <<EOF
Usage: launch_hammurabi.sh [--dev] [--port <port>] [--session-name <name>]

  --dev                  Run the tmux-managed dev server (pnpm run dev)
  --port <port>          Override listener port (dev default: 20001, prod default: 20009)
  --session-name <name>  Override tmux session name
  -h, --help             Show this help

Production mode launches the private API runtime for the split-shell deployment.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev)
            MODE="dev"
            shift
            ;;
        --port)
            [[ $# -ge 2 ]] || fail "--port requires a value"
            PORT="$2"
            PORT_EXPLICIT=1
            shift 2
            ;;
        --port=*)
            PORT="${1#*=}"
            PORT_EXPLICIT=1
            shift
            ;;
        --session-name)
            [[ $# -ge 2 ]] || fail "--session-name requires a value"
            SESSION_NAME="$2"
            SESSION_NAME_EXPLICIT=1
            shift 2
            ;;
        --session-name=*)
            SESSION_NAME="${1#*=}"
            SESSION_NAME_EXPLICIT=1
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            fail "Unknown argument: $1"
            ;;
    esac
done

[ -n "$SESSION_NAME" ] || fail "Session name must be non-empty"

if [ "$MODE" = "dev" ] && [ "$SESSION_NAME_EXPLICIT" -eq 0 ]; then
    SESSION_NAME="server-hammurabi-dev"
fi

if [ "$PORT_EXPLICIT" -eq 0 ]; then
    if [ "$MODE" = "dev" ]; then
        PORT="$PUBLIC_SHELL_PORT"
    else
        PORT="$PRIVATE_API_PORT"
    fi
fi

[[ "$PORT" =~ ^[0-9]+$ ]] || fail "Invalid port: $PORT"
[ "$PORT" -gt 0 ] || fail "Invalid port: $PORT"
if [ "$MODE" = "prod" ] && [ "$PORT" -eq "$PUBLIC_SHELL_PORT" ]; then
    fail "Refusing to run the Hervald API on public shell port $PUBLIC_SHELL_PORT. Use a private port behind Caddy, e.g. --port $PRIVATE_API_PORT."
fi

RUN_COMMAND="pnpm run start"
RUN_LABEL="production"
NODE_ENV_VALUE="production"
if [ "$MODE" = "dev" ]; then
    RUN_COMMAND="pnpm run dev"
    RUN_LABEL="dev"
    NODE_ENV_VALUE="development"
fi

CANDIDATE_PORT=$((PORT + 1000))
CANDIDATE_SESSION_NAME="${SESSION_NAME}-candidate-$$"

port_listener_pids() {
    local probe_port="${1:-$PORT}"
    if command -v lsof &>/dev/null; then
        lsof -tiTCP:"$probe_port" -sTCP:LISTEN 2>/dev/null || true
    elif command -v ss &>/dev/null; then
        ss -tlnp "sport = :$probe_port" 2>/dev/null | grep -oP 'pid=\K\d+' | sort -u || true
    fi
}

is_port_listening() {
    local probe_port="${1:-$PORT}"
    if command -v lsof &>/dev/null; then
        lsof -tiTCP:"$probe_port" -sTCP:LISTEN &>/dev/null
    elif command -v ss &>/dev/null; then
        ss -tlnp "sport = :$probe_port" 2>/dev/null | grep -q ":${probe_port} "
    else
        return 1
    fi
}

cleanup_old_session_and_port() {
    echo -n -e "${YELLOW}Cleaning up old session...${NC}"
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null

    # Kill actual process(es) listening on the port, not just tmux metadata.
    local _port_pids
    _port_pids="$(port_listener_pids "$PORT")"
    if [ -n "$_port_pids" ]; then
        echo "$_port_pids" | xargs -r kill -TERM 2>/dev/null || true
        sleep 1
        _port_pids="$(port_listener_pids "$PORT")"
        if [ -n "$_port_pids" ]; then
            echo "$_port_pids" | xargs -r kill -9 2>/dev/null || true
        fi
    fi
    echo -e " ${GREEN}${CHECKMARK}${NC}"
}

wait_for_service_health() {
    local health_port="${1:-$PORT}"
    local health_session="${2:-$SESSION_NAME}"
    local health_url="http://127.0.0.1:${health_port}/api/health"
    HEALTH_READY=false

    echo -n -e "${YELLOW}Waiting for Hervald health on port ${health_port}"
    for i in {1..60}; do
        echo -n "."
        sleep 1
        if curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then
            HEALTH_READY=true
            break
        fi
        if ! tmux has-session -t "$health_session" 2>/dev/null; then
            break
        fi
    done
    echo -e "${NC}"
}

launch_tmux_service() {
    local target_session="$1"
    local target_port="$2"
    local target_background_runtimes="${3:-1}"
    local target_stop_active_sessions_on_boot="${4:-0}"
    local target_host="${5:-}"
    local host_env=""

    if [ -n "$target_host" ]; then
        host_env="HAMMURABI_HOST=$target_host "
    fi

    tmux new-session -d -s "$target_session" -c "$APP_DIR" \
        "echo \"Build: $LAUNCH_COMMIT ($LAUNCH_BRANCH) @ $LAUNCH_TIME\" && \
         set -a && source .env && set +a && \
         while true; do \
           set -o pipefail; \
           ${host_env}NODE_ENV=$NODE_ENV_VALUE PORT=$target_port HAMMURABI_BACKGROUND_RUNTIMES=$target_background_runtimes HAMMURABI_STOP_ACTIVE_SESSIONS_ON_BOOT=$target_stop_active_sessions_on_boot LAUNCH_COMMIT=$LAUNCH_COMMIT $RUN_COMMAND 2>&1 | tee -a \"$LAUNCH_LOG_FILE\"; \
           EXIT_CODE=\${PIPESTATUS[0]}; \
           if [ \"\$EXIT_CODE\" -eq 0 ]; then \
             echo \"[INFO] \$(date -u +%Y-%m-%dT%H:%M:%SZ) Server exited cleanly (\$EXIT_CODE) - restarting in 5s\" | tee -a \"$LAUNCH_LOG_FILE\"; \
           else \
             echo \"[CRASH] \$(date -u +%Y-%m-%dT%H:%M:%SZ) Server exited (\$EXIT_CODE) - restarting in 5s\" | tee -a \"$LAUNCH_LOG_FILE\"; \
           fi; \
           sleep 5; \
         done"
}

init_launch_log "hammurabi" "$APP_DIR"

clear
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       ⚖️  Hervald Launcher ⚖️           ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo

# Check tmux
echo -n -e "${YELLOW}Checking tmux...${NC}"
if command -v tmux &> /dev/null; then
    echo -e " ${GREEN}${CHECKMARK}${NC}"
else
    echo -e " ${RED}${CROSS}${NC}"
    echo -e "${YELLOW}Installing tmux...${NC}"
    sudo yum install -y tmux || sudo apt-get install -y tmux
fi

# Check app directory
echo -n -e "${YELLOW}Checking Hervald source...${NC}"
if [ -d "$APP_DIR" ] && [ -f "$APP_DIR/package.json" ]; then
    echo -e " ${GREEN}${CHECKMARK}${NC}"
else
    echo -e " ${RED}${CROSS}${NC}"
    echo -e "${RED}Hervald source directory not found at $APP_DIR${NC}"
    exit 1
fi

# Check node
echo -n -e "${YELLOW}Checking Node.js...${NC}"
if command -v node &> /dev/null; then
    echo -e " ${GREEN}$(node --version)${NC}"
else
    echo -e " ${RED}${CROSS} Node.js not found${NC}"
    exit 1
fi

# Check pnpm
echo -n -e "${YELLOW}Checking pnpm...${NC}"
if command -v pnpm &> /dev/null; then
    echo -e " ${GREEN}$(pnpm --version)${NC}"
else
    echo -e " ${RED}${CROSS} pnpm not found${NC}"
    exit 1
fi

echo -n -e "${YELLOW}Checking curl...${NC}"
if command -v curl &> /dev/null; then
    echo -e " ${GREEN}${CHECKMARK}${NC}"
else
    echo -e " ${RED}${CROSS} curl not found${NC}"
    exit 1
fi

# Install dependencies and build before touching the live listener.
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Installing dependencies (workspace root)...${NC}"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
if ! pnpm --dir "$REPO_ROOT" install 2>&1; then
    echo -e "${RED}${CROSS} pnpm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}${CHECKMARK} Dependencies installed${NC}"

if [ "$MODE" = "dev" ]; then
    echo -e "${GREEN}${CHECKMARK} Dev mode selected — skipping production build${NC}"
else
    echo -e "${YELLOW}Building for production...${NC}"
    BUILD_OUTPUT=$(cd "$APP_DIR" && pnpm run build 2>&1)
    BUILD_EXIT=$?
    echo "$BUILD_OUTPUT"
    if [ $BUILD_EXIT -ne 0 ]; then
        echo -e "${RED}${CROSS} Build failed (exit $BUILD_EXIT)${NC}"
        exit 1
    fi
    echo -n -e "${YELLOW}Validating production build artifacts...${NC}"
    if [ ! -f "$APP_DIR/dist/index.html" ] || [ ! -f "$APP_DIR/dist-server/server/index.js" ]; then
        echo -e " ${RED}${CROSS}${NC}"
        echo -e "${RED}Expected dist/index.html and dist-server/server/index.js after build${NC}"
        exit 1
    fi
    echo -e " ${GREEN}${CHECKMARK}${NC}"
    echo -e "${GREEN}${CHECKMARK} Build complete${NC}"
fi

if [ "$MODE" = "prod" ]; then
    echo -n -e "${YELLOW}Checking candidate port $CANDIDATE_PORT...${NC}"
    if is_port_listening "$CANDIDATE_PORT"; then
        echo -e " ${RED}${CROSS} Candidate port $CANDIDATE_PORT is already in use. Aborting without touching live listener.${NC}"
        exit 1
    fi
    echo -e " ${GREEN}${CHECKMARK} (free)${NC}"

    echo -e "${GREEN}Launching Hervald background-disabled private API candidate on port $CANDIDATE_PORT before touching live listener...${NC}"
    launch_tmux_service "$CANDIDATE_SESSION_NAME" "$CANDIDATE_PORT" "0" "0" "$PRIVATE_BIND_HOST"
    wait_for_service_health "$CANDIDATE_PORT" "$CANDIDATE_SESSION_NAME"
    if ! $HEALTH_READY; then
        tmux kill-session -t "$CANDIDATE_SESSION_NAME" 2>/dev/null || true
        echo -e "${RED}${CROSS} Candidate did not pass /api/health. Existing listener was left untouched.${NC}"
        exit 1
    fi
    echo "[INFO] $(date -u +%Y-%m-%dT%H:%M:%SZ) Background-disabled candidate passed /api/health on port $CANDIDATE_PORT; stopping existing listener on port $PORT for handoff" >> "$LAUNCH_LOG_FILE"
else
    echo "[INFO] $(date -u +%Y-%m-%dT%H:%M:%SZ) Dev mode selected; stopping existing listener on port $PORT for handoff" >> "$LAUNCH_LOG_FILE"
fi
cleanup_old_session_and_port

# Verify port is free
echo -n -e "${YELLOW}Checking port $PORT...${NC}"
if is_port_listening "$PORT"; then
    echo -e " ${RED}${CROSS} Port $PORT still in use after cleanup. Aborting.${NC}"
    exit 1
fi
echo -e " ${GREEN}${CHECKMARK} (free)${NC}"

# Launch in tmux
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Launching Hervald (${RUN_LABEL})...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$MODE" = "prod" ]; then
    launch_tmux_service "$SESSION_NAME" "$PORT" "1" "1" "$PRIVATE_BIND_HOST"
else
    launch_tmux_service "$SESSION_NAME" "$PORT" "1" "1"
fi

# Wait for health after the new listener starts.
wait_for_service_health "$PORT" "$SESSION_NAME"
tmux kill-session -t "$CANDIDATE_SESSION_NAME" 2>/dev/null || true

# Report status
echo -n -e "${YELLOW}Hervald health /api/health...${NC}"
if $HEALTH_READY; then
    echo -e " ${GREEN}${CHECKMARK}${NC}"
    echo "[INFO] $(date -u +%Y-%m-%dT%H:%M:%SZ) /api/health returned 200 on port $PORT" >> "$LAUNCH_LOG_FILE"
else
    echo -e " ${RED}${CROSS} not healthy${NC}"
    echo "[ERROR] $(date -u +%Y-%m-%dT%H:%M:%SZ) /api/health did not return 200 on port $PORT before timeout" >> "$LAUNCH_LOG_FILE"
fi

# Final status
if tmux has-session -t "$SESSION_NAME" 2>/dev/null && $HEALTH_READY; then
    finalize_launch_log "running"
    echo -e "\n${GREEN}${CHECKMARK} Hervald is running!${NC}"
    echo -e "\n${CYAN}╔════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║          SERVICE INFORMATION           ║${NC}"
    echo -e "${CYAN}╠════════════════════════════════════════╣${NC}"
    if [ "$MODE" = "prod" ]; then
        echo -e "${CYAN}║${NC} API:       ${GREEN}http://127.0.0.1:$PORT/api/health${NC} ${CYAN}║${NC}"
        echo -e "${CYAN}║${NC} Shell:     ${GREEN}https://$PUBLIC_SHELL_DOMAIN/healthz${NC} ${CYAN}║${NC}"
    else
        echo -e "${CYAN}║${NC} Local:     ${GREEN}http://localhost:$PORT${NC}       ${CYAN}║${NC}"
        echo -e "${CYAN}║${NC} Health:    ${GREEN}/api/health${NC}                 ${CYAN}║${NC}"
    fi
    echo -e "${CYAN}║${NC} Session:   ${YELLOW}$SESSION_NAME${NC}          ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Commit:    ${YELLOW}$LAUNCH_COMMIT${NC} (${BLUE}$LAUNCH_BRANCH${NC})${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Launched:  ${YELLOW}$LAUNCH_TIME${NC}  ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Logs:      ${YELLOW}$LAUNCH_LOG_DIR${NC}  ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
    if [ "$MODE" = "prod" ]; then
        echo -e "${YELLOW}Run split-shell check:${NC} ${BLUE}bash $MONOREPO_DIR/operations/deploy/ec2/check-hammurabi-split-shell.sh --domain $PUBLIC_SHELL_DOMAIN --service-port $PORT --shell-port $PUBLIC_SHELL_PORT${NC}"
    fi
    echo -e "\n${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}▸${NC} Attach:  ${BLUE}tmux attach -t $SESSION_NAME${NC}"
    echo -e "  ${GREEN}▸${NC} Tail:    ${BLUE}tail -f $LAUNCH_LOG_FILE${NC}"
    echo -e "  ${GREEN}▸${NC} Detach:  ${BLUE}Ctrl+B, then D${NC}"
    echo -e "  ${GREEN}▸${NC} Stop:    ${BLUE}tmux kill-session -t $SESSION_NAME${NC}"
else
    finalize_launch_log "failed"
    echo -e "\n${RED}${CROSS} Failed to start Hervald!${NC}"
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo -e "${YELLOW}The tmux session exists, but /api/health did not return 200 before timeout.${NC}"
    else
        echo -e "${YELLOW}The tmux session exited before /api/health became healthy.${NC}"
    fi
    echo -e "${YELLOW}Check logs: tail -n 50 $LAUNCH_LOG_FILE${NC}"
    exit 1
fi

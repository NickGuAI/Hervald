#!/bin/bash

# Script to launch Hammurabi (monitoring dashboard) in tmux

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
PORT=20001
SESSION_NAME="server-hammurabi"
MODE="prod"
SESSION_NAME_EXPLICIT=0

print_usage() {
    cat <<EOF
Usage: launch_hammurabi.sh [--dev] [--port <port>] [--session-name <name>]

  --dev                  Run the tmux-managed dev server (pnpm run dev)
  --port <port>          Override listener port (default: 20001)
  --session-name <name>  Override tmux session name
  -h, --help             Show this help
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
            shift 2
            ;;
        --port=*)
            PORT="${1#*=}"
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

[[ "$PORT" =~ ^[0-9]+$ ]] || fail "Invalid port: $PORT"
[ "$PORT" -gt 0 ] || fail "Invalid port: $PORT"
[ -n "$SESSION_NAME" ] || fail "Session name must be non-empty"

if [ "$MODE" = "dev" ] && [ "$SESSION_NAME_EXPLICIT" -eq 0 ]; then
    SESSION_NAME="server-hammurabi-dev"
fi

RUN_SCRIPT="start"
RUN_LABEL="production"
NODE_ENV_VALUE="production"
if [ "$MODE" = "dev" ]; then
    RUN_SCRIPT="dev"
    RUN_LABEL="dev"
    NODE_ENV_VALUE="development"
fi

init_launch_log "hammurabi" "$APP_DIR"

clear
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      ⚖️  Hammurabi Launcher ⚖️          ║${NC}"
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
echo -n -e "${YELLOW}Checking Hammurabi source...${NC}"
if [ -d "$APP_DIR" ] && [ -f "$APP_DIR/package.json" ]; then
    echo -e " ${GREEN}${CHECKMARK}${NC}"
else
    echo -e " ${RED}${CROSS}${NC}"
    echo -e "${RED}Hammurabi directory not found at $APP_DIR${NC}"
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

# Kill existing session and the real listener process on the port
echo -n -e "${YELLOW}Cleaning up old session...${NC}"
tmux kill-session -t "$SESSION_NAME" 2>/dev/null
# Kill actual process(es) listening on the port, not just tmux metadata.
# Uses lsof (portable) with ss (Linux) as fallback.
_port_pids=""
if command -v lsof &>/dev/null; then
    _port_pids=$(lsof -ti :$PORT 2>/dev/null || true)
elif command -v ss &>/dev/null; then
    _port_pids=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+' | sort -u)
fi
if [ -n "$_port_pids" ]; then
    echo "$_port_pids" | xargs -r kill -TERM 2>/dev/null || true
    sleep 1
    # Force-kill survivors
    if command -v lsof &>/dev/null; then
        _port_pids=$(lsof -ti :$PORT 2>/dev/null || true)
    elif command -v ss &>/dev/null; then
        _port_pids=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+' | sort -u)
    fi
    if [ -n "$_port_pids" ]; then
        echo "$_port_pids" | xargs -r kill -9 2>/dev/null || true
    fi
fi
echo -e " ${GREEN}${CHECKMARK}${NC}"

# Verify port is free
echo -n -e "${YELLOW}Checking port $PORT...${NC}"
if ss -tlnp 2>/dev/null | grep -q ":${PORT} " || \
   (command -v lsof &>/dev/null && lsof -ti :$PORT &>/dev/null); then
    echo -e " ${RED}${CROSS} Port $PORT still in use after cleanup. Aborting.${NC}"
    exit 1
fi
echo -e " ${GREEN}${CHECKMARK} (free)${NC}"

# Install dependencies and build
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
    echo -e "${GREEN}${CHECKMARK} Build complete${NC}"
fi

# Launch in tmux
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Launching Hammurabi (${RUN_LABEL})...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

tmux new-session -d -s "$SESSION_NAME" -c "$APP_DIR" \
    "echo \"Build: $LAUNCH_COMMIT ($LAUNCH_BRANCH) @ $LAUNCH_TIME\" && \
     set -a && source .env && set +a && \
     while true; do \
       set -o pipefail; \
       NODE_ENV=$NODE_ENV_VALUE PORT=$PORT LAUNCH_COMMIT=$LAUNCH_COMMIT pnpm run $RUN_SCRIPT 2>&1 | tee -a \"$LAUNCH_LOG_FILE\"; \
       EXIT_CODE=\${PIPESTATUS[0]}; \
       if [ \"\$EXIT_CODE\" -eq 0 ]; then \
         echo \"[INFO] \$(date -u +%Y-%m-%dT%H:%M:%SZ) Server exited cleanly (\$EXIT_CODE) - restarting in 5s\" | tee -a \"$LAUNCH_LOG_FILE\"; \
       else \
         echo \"[CRASH] \$(date -u +%Y-%m-%dT%H:%M:%SZ) Server exited (\$EXIT_CODE) - restarting in 5s\" | tee -a \"$LAUNCH_LOG_FILE\"; \
       fi; \
       sleep 5; \
     done"

# Wait for service
echo -n -e "${YELLOW}Waiting for Hammurabi to start"
SERVICE_READY=false
for i in {1..15}; do
    echo -n "."
    sleep 1
    if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
        SERVICE_READY=true
        break
    fi
done
echo -e "${NC}"

# Report status
echo -n -e "${YELLOW}Hammurabi (port $PORT)...${NC}"
if $SERVICE_READY; then
    echo -e " ${GREEN}${CHECKMARK}${NC}"
else
    echo -e " ${YELLOW}(still starting)${NC}"
fi

# Final status
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    finalize_launch_log "running"
    echo -e "\n${GREEN}${CHECKMARK} Hammurabi is running!${NC}"
    echo -e "\n${CYAN}╔════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║          SERVICE INFORMATION           ║${NC}"
    echo -e "${CYAN}╠════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC} Local:     ${GREEN}http://localhost:$PORT${NC}       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Public:    ${GREEN}https://hervald.gehirn.ai${NC} ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Health:    ${GREEN}/api/health${NC}                 ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Session:   ${YELLOW}$SESSION_NAME${NC}          ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Commit:    ${YELLOW}$LAUNCH_COMMIT${NC} (${BLUE}$LAUNCH_BRANCH${NC})${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Launched:  ${YELLOW}$LAUNCH_TIME${NC}  ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Logs:      ${YELLOW}$LAUNCH_LOG_DIR${NC}  ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
    echo -e "\n${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}▸${NC} Attach:  ${BLUE}tmux attach -t $SESSION_NAME${NC}"
    echo -e "  ${GREEN}▸${NC} Tail:    ${BLUE}tail -f $LAUNCH_LOG_FILE${NC}"
    echo -e "  ${GREEN}▸${NC} Detach:  ${BLUE}Ctrl+B, then D${NC}"
    echo -e "  ${GREEN}▸${NC} Stop:    ${BLUE}tmux kill-session -t $SESSION_NAME${NC}"
else
    finalize_launch_log "failed"
    echo -e "\n${RED}${CROSS} Failed to start Hammurabi!${NC}"
    echo -e "${YELLOW}Check logs: tail -n 50 $LAUNCH_LOG_FILE${NC}"
    exit 1
fi

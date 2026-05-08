#!/bin/bash

# Shared helpers for launch scripts — commit tracking, timestamped log dirs, status metadata

MONOREPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_LOG_BASE="$MONOREPO_DIR/operations/logs/server"

is_hermetic_launch_key() {
    local key="$1"
    case "$key" in
        HOME|PATH|USER|LOGNAME|SHELL|TERM|LANG|TZ|TMPDIR|TMP|TEMP|PWD|SHLVL|XDG_RUNTIME_DIR|SSH_AUTH_SOCK|NVM_DIR|PNPM_HOME|LAUNCH_HERMETIC_ENV)
            return 0
            ;;
        LC_*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Build a minimal allowlisted env for hermetic launch re-exec.
build_hermetic_launch_env() {
    HERMETIC_LAUNCH_ENV=()
    local key
    while IFS='=' read -r key _; do
        if is_hermetic_launch_key "$key" && [[ -n ${!key+x} ]]; then
            HERMETIC_LAUNCH_ENV+=("${key}=${!key}")
        fi
    done < <(env)
}

# Re-exec once under a clean base environment.
ensure_hermetic_launch_env() {
    if [ "${LAUNCH_HERMETIC_ENV:-0}" = "1" ]; then
        local key
        while IFS='=' read -r key _; do
            if ! is_hermetic_launch_key "$key"; then
                unset "$key" 2>/dev/null || true
            fi
        done < <(env)
        return 0
    fi

    build_hermetic_launch_env
    exec env -i "${HERMETIC_LAUNCH_ENV[@]}" LAUNCH_HERMETIC_ENV=1 bash "$0" "$@"
}

# init_launch_log <service_name> <app_dir>
#
# Sets globals: LAUNCH_LOG_DIR, LAUNCH_LOG_FILE, LAUNCH_META_FILE,
#               LAUNCH_COMMIT, LAUNCH_BRANCH, LAUNCH_TIME
init_launch_log() {
    local service="$1"
    local app_dir="$2"

    _LAUNCH_SERVICE="$service"
    LAUNCH_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    local ts=$(date -u '+%Y%m%d-%H%M%S')

    # Git info from app dir if it's a repo, else from monorepo
    if git -C "$app_dir" rev-parse --git-dir &>/dev/null; then
        LAUNCH_COMMIT=$(git -C "$app_dir" rev-parse --short HEAD 2>/dev/null || echo "unknown")
        LAUNCH_BRANCH=$(git -C "$app_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    else
        LAUNCH_COMMIT=$(git -C "$MONOREPO_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
        LAUNCH_BRANCH=$(git -C "$MONOREPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    fi

    LAUNCH_LOG_DIR="$SERVER_LOG_BASE/$service/$ts"
    mkdir -p "$LAUNCH_LOG_DIR"
    LAUNCH_LOG_FILE="$LAUNCH_LOG_DIR/launch.log"
    LAUNCH_META_FILE="$LAUNCH_LOG_DIR/meta.json"

    # Symlink for quick access
    ln -sfn "$LAUNCH_LOG_DIR" "$SERVER_LOG_BASE/$service/latest"

    # Initial metadata
    cat > "$LAUNCH_META_FILE" <<EOF
{
  "service": "$service",
  "commit": "$LAUNCH_COMMIT",
  "branch": "$LAUNCH_BRANCH",
  "launched_at": "$LAUNCH_TIME",
  "status": "starting"
}
EOF
}

# finalize_launch_log <status>  ("running" or "failed")
finalize_launch_log() {
    local status="$1"
    local checked_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    cat > "$LAUNCH_META_FILE" <<EOF
{
  "service": "$_LAUNCH_SERVICE",
  "commit": "$LAUNCH_COMMIT",
  "branch": "$LAUNCH_BRANCH",
  "launched_at": "$LAUNCH_TIME",
  "status": "$status",
  "status_checked_at": "$checked_at"
}
EOF
}

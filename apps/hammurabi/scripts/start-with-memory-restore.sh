#!/usr/bin/env bash
set -euo pipefail

DEFAULT_HAMMURABI_DATA_DIR="${HOME}/.hammurabi"

# Production default: keep all runtime state outside the repo tree.
export HAMMURABI_DATA_DIR="${HAMMURABI_DATA_DIR:-${DEFAULT_HAMMURABI_DATA_DIR}}"
export COMMANDER_DATA_DIR="${COMMANDER_DATA_DIR:-${HAMMURABI_DATA_DIR}/commander}"

exec pnpm tsx server/index.ts

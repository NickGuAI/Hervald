import type { ClaudePermissionMode } from './types.js'

export const DEFAULT_MAX_SESSIONS = 10
export const DEFAULT_TASK_DELAY_MS = 3000
export const DEFAULT_WS_KEEPALIVE_INTERVAL_MS = 30000
export const DEFAULT_AUTO_ROTATE_ENTRY_THRESHOLD = 500
export const DEFAULT_CODEX_TURN_WATCHDOG_TIMEOUT_MS = 300_000
export const MAX_BUFFER_BYTES = 256 * 1024
export const WORKSPACE_EXEC_MAX_BUFFER_BYTES = 16 * 1024 * 1024
export const MAX_STREAM_EVENTS = 1000
export const SESSION_NAME_PATTERN = /^[\w-]+$/
export const FILE_NAME_PATTERN = /^[a-zA-Z0-9._\- ]+$/
export const DEFAULT_COLS = 120
export const DEFAULT_ROWS = 40
export const DEFAULT_SESSION_STORE_PATH = 'data/agents/stream-sessions.json'
export const COMMANDER_SESSION_NAME_PREFIX = 'commander-'
export const COMMANDER_PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/
export const COMMAND_ROOM_COMPLETED_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const DEFAULT_AGENT_PRUNER_ENABLED = true
export const DEFAULT_AGENT_PRUNER_SWEEP_INTERVAL_MS = 10 * 60 * 1000
export const DEFAULT_AGENT_PRUNER_STALE_SESSION_TTL_MS = 60 * 60 * 1000
export const DEFAULT_AGENT_PRUNER_EXITED_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const CODEX_SIDECAR_LOG_TAIL_LIMIT = 20
export const CODEX_SIDECAR_LOG_TEXT_LIMIT = 500
export const CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS = 5000
export const CODEX_RUNTIME_FORCE_KILL_WAIT_MS = 1000
export const CLAUDE_DISABLE_ADAPTIVE_THINKING_ENV = 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING'
export const RESTORED_REPLAY_TURN_LIMIT = 20

export const CODEX_MODE_COMMANDS: Record<ClaudePermissionMode, string> = {
  default: 'codex',
}

export const GEMINI_ACP_COMMAND = 'gemini'
export const GEMINI_ACP_ARGS = ['--acp']

export const EXTERNAL_SESSION_STALE_MS = 60_000

export const MACHINE_TOOL_KEYS = ['claude', 'codex', 'gemini', 'git', 'node'] as const

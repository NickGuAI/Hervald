import {
  ensureCodexProviderContext,
  readCodexRuntime,
  readCodexThreadId,
} from './providers/provider-session-context.js'
import type { AnySession } from './types.js'

const codexSessionMapsForProcessExit = new Set<Map<string, AnySession>>()
let codexProcessExitHookInstalled = false

export function registerCodexProcessExitSessionMap(sessions: Map<string, AnySession>): void {
  codexSessionMapsForProcessExit.add(sessions)
  if (codexProcessExitHookInstalled) {
    return
  }

  codexProcessExitHookInstalled = true
  process.on('exit', () => {
    for (const sessionMap of codexSessionMapsForProcessExit) {
      for (const session of sessionMap.values()) {
        if (session.kind !== 'stream' || session.agentType !== 'codex') {
          continue
        }

        if (session.codexTurnWatchdogTimer) {
          clearTimeout(session.codexTurnWatchdogTimer)
          session.codexTurnWatchdogTimer = undefined
        }
        session.codexTurnStaleAt = undefined
        ensureCodexProviderContext(session).notificationCleanup?.()
        ensureCodexProviderContext(session).notificationCleanup = undefined

        if (readCodexRuntime(session)) {
          readCodexRuntime(session)?.teardownOnProcessExit?.(readCodexThreadId(session))
          continue
        }

        try {
          session.process.kill('SIGTERM')
        } catch {
          // Best effort only during process exit.
        }
      }
    }
  })
}

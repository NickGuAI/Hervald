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
        session.codexNotificationCleanup?.()
        session.codexNotificationCleanup = undefined

        if (session.codexRuntime) {
          session.codexRuntime.teardownOnProcessExit?.(session.codexThreadId)
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

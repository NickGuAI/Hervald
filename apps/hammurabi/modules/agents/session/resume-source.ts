import {
  clearCodexTurnWatchdog,
  hasCodexRolloutFile,
  markCodexTurnHealthy,
} from '../adapters/codex/helpers.js'
import { getProvider } from '../providers/registry.js'
import {
  clearCodexResumeMetadata as clearCodexResumeMetadataForStore,
  retireLiveCodexSessionForResume as retireLiveCodexSessionForResumeForStore,
} from './persistence.js'
import {
  buildPersistedEntryFromExitedSession,
  buildPersistedEntryFromLiveStreamSession,
  canResumeLiveStreamSession,
  hasResumeIdentifier,
  snapshotExitedStreamSession,
} from './state.js'
import type {
  AnySession,
  ExitedStreamSessionState,
  PersistedSessionsState,
  PersistedStreamSession,
  ResolvedResumableSessionSource,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

interface SessionResumeRuntimeDeps {
  sessions: Map<string, AnySession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  schedulePersistedSessionsWrite(): void
  teardownProviderSession(session: StreamSession, reason: string): Promise<void>
}

export interface SessionResumeRuntime {
  clearCodexResumeMetadata(sessionName: string): void
  retireLiveSessionForResume(sessionName: string, session: StreamSession): void
  resolveResumableSessionSource(
    sessionName: string,
    persistedState: PersistedSessionsState,
  ): { source?: ResolvedResumableSessionSource; error?: { status: number; message: string } }
  isExitedSessionResumeAvailable(entry: PersistedStreamSession): Promise<boolean>
  isLiveSessionResumeAvailable(session: StreamSession): Promise<boolean>
}

export function createSessionResumeRuntime(
  deps: SessionResumeRuntimeDeps,
): SessionResumeRuntime {
  async function isExitedSessionResumeAvailable(entry: PersistedStreamSession): Promise<boolean> {
    if (!hasResumeIdentifier(entry)) {
      return false
    }

    const provider = getProvider(entry.agentType)
    const resumeId = provider?.getResumeId(entry as unknown as StreamSession)
    if (provider?.id !== 'codex' || !resumeId || entry.host) {
      return true
    }

    return hasCodexRolloutFile(resumeId, entry.createdAt)
  }

  async function isLiveSessionResumeAvailable(session: StreamSession): Promise<boolean> {
    const provider = getProvider(session.agentType)
    if (!canResumeLiveStreamSession(session)) {
      return false
    }
    const resumeId = provider?.getResumeId(session)
    if (!resumeId) {
      return false
    }
    if (provider?.id !== 'codex') {
      return true
    }
    if (session.host) {
      return true
    }
    return hasCodexRolloutFile(resumeId, session.createdAt)
  }

  function clearCodexResumeMetadata(sessionName: string): void {
    clearCodexResumeMetadataForStore(
      sessionName,
      deps.sessions,
      deps.exitedStreamSessions,
      deps.schedulePersistedSessionsWrite,
    )
  }

  function retireLiveSessionForResume(sessionName: string, session: StreamSession): void {
    if (getProvider(session.agentType)?.id === 'codex') {
      retireLiveCodexSessionForResumeForStore(
        sessionName,
        session,
        deps.exitedStreamSessions,
        deps.sessions,
        deps.sessionEventHandlers,
        clearCodexTurnWatchdog,
        markCodexTurnHealthy,
      )
      return
    }

    for (const client of session.clients) {
      client.close(1000, 'Session resumed')
    }
    void deps.teardownProviderSession(session, `Session "${sessionName}" resumed`).catch(() => undefined)
    deps.exitedStreamSessions.set(sessionName, snapshotExitedStreamSession(session))
    deps.sessions.delete(sessionName)
    deps.sessionEventHandlers.delete(sessionName)
  }

  function resolveResumableSessionSource(
    sessionName: string,
    persistedState: PersistedSessionsState,
  ): { source?: ResolvedResumableSessionSource; error?: { status: number; message: string } } {
    const liveSession = deps.sessions.get(sessionName)
    if (liveSession) {
      if (liveSession.kind !== 'stream') {
        return {
          error: { status: 404, message: `Session "${sessionName}" is not resumable` },
        }
      }
      if (!canResumeLiveStreamSession(liveSession)) {
        return {
          error: { status: 409, message: `Session "${sessionName}" is not resumable right now` },
        }
      }
      return {
        source: {
          source: buildPersistedEntryFromLiveStreamSession(sessionName, liveSession),
          liveSession,
        },
      }
    }

    const exitedSession = deps.exitedStreamSessions.get(sessionName)
    const persistedSource = persistedState.sessions.find((entry) => entry.name === sessionName)
    let source = exitedSession ? buildPersistedEntryFromExitedSession(sessionName, exitedSession) : undefined
    if ((!source || !hasResumeIdentifier(source)) && persistedSource) {
      source = persistedSource
    }

    if (!source) {
      return {
        error: { status: 404, message: `Session "${sessionName}" not found` },
      }
    }

    if (!hasResumeIdentifier(source)) {
      return {
        error: { status: 409, message: `Session "${sessionName}" is missing resume metadata` },
      }
    }

    return { source: { source } }
  }

  return {
    clearCodexResumeMetadata,
    retireLiveSessionForResume,
    resolveResumableSessionSource,
    isExitedSessionResumeAvailable,
    isLiveSessionResumeAvailable,
  }
}

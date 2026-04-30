import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { RequestHandler, Router } from 'express'
import type { WebSocketServer } from 'ws'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { createAuth0Verifier } from '../../server/middleware/auth0.js'
import type { MachineRegistryStore } from './machines.js'
import type {
  AnySession,
  AgentsRouterOptions,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  PersistedSessionsState,
  PersistedStreamSession,
  PtySession,
  StreamJsonEvent,
  StreamSession,
} from './types.js'

export interface AgentsAuthContext {
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  requireDispatchWorkerAccess: RequestHandler
  verifyWsAuth(req: IncomingMessage): Promise<boolean>
}

export interface AgentsSessionCallbacks {
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastStreamEvent(session: StreamSession | Exclude<AnySession, PtySession | StreamSession>, event: StreamJsonEvent): void
  sendTextToStreamSession(session: StreamSession, text: string): Promise<boolean>
  createStreamSession(
    sessionName: string,
    mode: StreamSession['mode'],
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: StreamSession['agentType'],
    options?: Record<string, unknown>,
  ): StreamSession
  createCodexAppServerSession(
    sessionName: string,
    mode: StreamSession['mode'],
    task: string,
    cwd: string | undefined,
    options?: Record<string, unknown>,
  ): Promise<StreamSession>
  createGeminiAcpSession(
    sessionName: string,
    mode: StreamSession['mode'],
    task: string,
    cwd: string | undefined,
    options?: Record<string, unknown>,
  ): Promise<StreamSession>
  teardownCodexSessionRuntime(session: StreamSession, reason: string): Promise<void>
  teardownGeminiSessionRuntime(session: StreamSession, reason: string): Promise<void>
  shutdownCodexRuntimes(reason?: string): Promise<void>
  shutdownGeminiRuntimes(reason?: string): Promise<void>
  applyCodexApprovalDecision(
    session: StreamSession,
    requestId: number,
    decision: 'accept' | 'decline',
  ): { ok: true } | { ok: false; code: string; reason: string }
  clearCodexTurnWatchdog(session: StreamSession): void
  markCodexTurnHealthy(session: StreamSession): void
  writeToStdin(session: StreamSession, data: string): boolean
}

export interface AgentsRouteContext {
  router: Router
  options: AgentsRouterOptions
  auth: AgentsAuthContext
  sessions: Map<string, AnySession>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  wss: WebSocketServer
  maxSessions: number
  taskDelayMs: number
  wsKeepAliveIntervalMs: number
  codexTurnWatchdogTimeoutMs: number
  machineRegistry: MachineRegistryStore
  getSpawner: () => Promise<import('./types.js').PtySpawner>
  schedulePersistedSessionsWrite: () => void
  readPersistedSessionsState: () => Promise<PersistedSessionsState>
  restorePersistedSessions: () => Promise<void>
  resolveResumableSessionSource: (
    sessionName: string,
    persistedState: PersistedSessionsState,
  ) => { source?: { source: PersistedStreamSession; liveSession?: StreamSession }; error?: { status: number; message: string } }
  clearCodexResumeMetadata: (sessionName: string) => void
  retireLiveCodexSessionForResume: (sessionName: string, session: StreamSession) => void
  getWorkerStates: (sourceSessionName: string) => import('./types.js').WorkerState[]
  launchers: AgentsSessionCallbacks
}

export function createAgentsAuthContext(options: AgentsRouterOptions): AgentsAuthContext {
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireDispatchWorkerAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const auth0Verifier = createAuth0Verifier({
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  async function verifyWsAuth(req: IncomingMessage): Promise<boolean> {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const accessToken = url.searchParams.get('access_token')
    const apiKeyParam = url.searchParams.get('api_key')
    const apiKeyHeader = req.headers['x-hammurabi-api-key'] as string | undefined
    const token = accessToken ?? apiKeyParam ?? apiKeyHeader

    if (!token) {
      return false
    }

    if (auth0Verifier) {
      try {
        await auth0Verifier(token)
        return true
      } catch {
        // Fall through to API key verification.
      }
    }

    if (options.apiKeyStore) {
      const result = await options.apiKeyStore.verifyKey(token, {
        requiredScopes: ['agents:write'],
      })
      return result.ok
    }

    return false
  }

  return {
    requireReadAccess,
    requireWriteAccess,
    requireDispatchWorkerAccess,
    verifyWsAuth,
  }
}

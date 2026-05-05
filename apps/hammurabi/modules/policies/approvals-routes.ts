import { Router } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AuthUser } from '@gehirn/auth-providers'
import type {
  ApprovalSessionsInterface,
  CodexApprovalQueueEvent,
  PendingCodexApprovalView,
} from '../agents/routes.js'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { createAuth0Verifier } from '../../server/middleware/auth0.js'
import { ApprovalCoordinator } from './pending-store.js'
import type { ApprovalHistoryEntry, PendingApproval } from './types.js'

export interface ApprovalsRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  approvalCoordinator: ApprovalCoordinator
  approvalSessionsInterface: ApprovalSessionsInterface
}

function toQueuedApprovalResponse(approval: PendingApproval) {
  const details = Object.entries(approval.context.details ?? {}).map(([label, value]) => ({
    label,
    value,
  }))

  return {
    id: approval.id,
    approvalId: approval.id,
    decisionId: approval.id,
    requestId: approval.resolverRef?.kind === 'codex' ? approval.resolverRef.requestId : approval.id,
    actionId: approval.actionId,
    actionLabel: approval.actionLabel,
    commanderId: approval.commanderId ?? null,
    commanderName: approval.commanderId ?? null,
    sessionName: approval.sessionId ?? null,
    source: approval.source,
    requestedAt: approval.requestedAt,
    summary: approval.context.summary,
    reason: null,
    risk: null,
    preview: approval.context.preview,
    previewText: approval.context.preview,
    details,
    context: {
      ...approval.context,
      commanderName: approval.commanderId ?? undefined,
      sessionName: approval.sessionId ?? undefined,
    },
    raw: {
      ...approval,
      details,
    },
  }
}

function toCodexApprovalResponse(approval: PendingCodexApprovalView) {
  const details = [
    approval.reason ? { label: 'Reason', value: approval.reason } : null,
    approval.risk ? { label: 'Risk', value: approval.risk } : null,
    approval.threadId ? { label: 'Thread', value: approval.threadId } : null,
    approval.turnId ? { label: 'Turn', value: approval.turnId } : null,
  ].filter((detail): detail is { label: string; value: string } => detail !== null)

  return {
    id: approval.id,
    approvalId: approval.id,
    decisionId: approval.id,
    requestId: approval.requestId,
    actionId: approval.actionId,
    actionLabel: approval.actionLabel,
    commanderId: approval.commanderScopeId ?? null,
    commanderName: approval.commanderScopeId ?? null,
    sessionName: approval.sessionName,
    source: 'codex',
    requestedAt: approval.requestedAt,
    summary: approval.reason ?? `${approval.actionLabel} requires approval.`,
    reason: approval.reason ?? null,
    risk: approval.risk ?? null,
    preview: approval.risk ?? undefined,
    previewText: approval.risk ?? approval.reason ?? null,
    details,
    context: {
      summary: approval.reason ?? `${approval.actionLabel} requires approval.`,
      details: Object.fromEntries(details.map((detail) => [detail.label, detail.value])),
      sessionName: approval.sessionName,
    },
    raw: approval,
  }
}

async function listApprovalResponses(options: ApprovalsRouterOptions) {
  const queuedApprovals = await options.approvalCoordinator.listPending()
  const codexApprovals = options.approvalSessionsInterface.listPendingCodexApprovals()
  return [
    ...queuedApprovals.map((approval) => toQueuedApprovalResponse(approval)),
    ...codexApprovals.map((approval) => toCodexApprovalResponse(approval)),
  ].sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return
  }
  ws.send(JSON.stringify(payload))
}

function buildCodexHistoryEntry(event: CodexApprovalQueueEvent): ApprovalHistoryEntry {
  const summary = event.approval.reason ?? `${event.approval.actionLabel} requires approval.`
  if (event.type === 'resolved') {
    return {
      timestamp: new Date().toISOString(),
      type: 'approval.resolved',
      approvalId: event.approval.id,
      actionId: event.approval.actionId,
      actionLabel: event.approval.actionLabel,
      commanderId: event.approval.commanderScopeId,
      sessionId: event.approval.sessionName,
      source: 'codex',
      summary,
      decision: event.decision,
      delivered: event.delivered,
      outcome: event.decision
        ? {
          decision: event.decision,
          allowed: event.decision === 'approve',
        }
        : undefined,
    }
  }

  return {
    timestamp: event.approval.requestedAt,
    type: 'approval.enqueued',
    approvalId: event.approval.id,
    actionId: event.approval.actionId,
    actionLabel: event.approval.actionLabel,
    commanderId: event.approval.commanderScopeId,
    sessionId: event.approval.sessionName,
    source: 'codex',
    summary,
  }
}

export function createApprovalsRouter(options: ApprovalsRouterOptions): {
  router: Router
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
} {
  const router = Router()
  const wss = new WebSocketServer({ noServer: true })
  const auth0Verifier = createAuth0Verifier({
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    internalToken: options.internalToken,
    verifyToken: options.verifyAuth0Token,
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
  })
  options.approvalSessionsInterface.subscribeToCodexApprovalQueue((event) => {
    void options.approvalCoordinator.recordHistoryEntry(buildCodexHistoryEntry(event))
  })

  router.get('/pending', requireReadAccess, async (_req, res) => {
    res.json({
      approvals: await listApprovalResponses(options),
    })
  })

  router.get('/history', requireReadAccess, async (req, res) => {
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
    const commanderId = typeof req.query.commander === 'string' && req.query.commander.trim().length > 0
      ? req.query.commander.trim()
      : undefined
    const actionId = typeof req.query.action === 'string' && req.query.action.trim().length > 0
      ? req.query.action.trim()
      : undefined
    const source = req.query.source === 'claude' || req.query.source === 'codex'
      ? req.query.source
      : undefined
    const rawFrom = typeof req.query.from === 'string' ? req.query.from.trim() : ''
    const from = rawFrom.length > 0 ? rawFrom : undefined
    const to = typeof req.query.to === 'string' && req.query.to.trim().length > 0
      ? req.query.to.trim()
      : undefined

    const historyFilter = {
      ...(commanderId ? { commanderId } : {}),
      ...(actionId ? { actionId } : {}),
      ...(source ? { source } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(typeof limit === 'number' && Number.isFinite(limit) ? { limit } : {}),
    }

    res.json({
      history: await options.approvalCoordinator.listHistory(historyFilter),
    })
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
        requiredScopes: ['agents:read'],
      })
      return result.ok
    }

    return false
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    if (!url.pathname.endsWith('/stream')) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    void verifyWsAuth(req).then((authorized) => {
      if (!authorized) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const unsubscribeQueuedApprovals = options.approvalCoordinator.subscribe((event) => {
          if (event.type === 'resolved') {
            sendJson(ws, {
              type: 'approval.resolved',
              approvalId: event.approval.id,
              approval: toQueuedApprovalResponse(event.approval),
              decision: event.decision,
              delivered: event.delivered,
            })
            return
          }

          sendJson(ws, {
            type: 'approval.enqueued',
            approvalId: event.approval.id,
            approval: toQueuedApprovalResponse(event.approval),
          })
        })
        const unsubscribeCodexApprovals = options.approvalSessionsInterface.subscribeToCodexApprovalQueue(
          (event: CodexApprovalQueueEvent) => {
            if (event.type === 'resolved') {
              sendJson(ws, {
                type: 'approval.resolved',
                approvalId: event.approval.id,
                approval: toCodexApprovalResponse(event.approval),
                decision: event.decision,
                delivered: event.delivered,
              })
              return
            }

            sendJson(ws, {
              type: 'approval.enqueued',
              approvalId: event.approval.id,
              approval: toCodexApprovalResponse(event.approval),
            })
          },
        )

        ws.on('close', () => {
          unsubscribeQueuedApprovals()
          unsubscribeCodexApprovals()
        })

        void listApprovalResponses(options).then((approvals) => {
          sendJson(ws, {
            type: 'approval.snapshot',
            approvals,
          })
        })
      })
    })
  }

  return {
    router,
    handleUpgrade,
  }
}

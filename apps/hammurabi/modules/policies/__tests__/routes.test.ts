import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type {
  ApprovalSessionContext,
  ApprovalSessionsInterface,
  CodexApprovalQueueEvent,
  PendingCodexApprovalView,
} from '../../agents/routes'
import type { StreamSession } from '../../agents/types'
import { ActionPolicyGate } from '../action-policy-gate'
import { createApprovalsRouter } from '../approvals-routes'
import { ApprovalCoordinator } from '../pending-store'
import { resolveActionPolicy } from '../resolver'
import { createPoliciesRouter } from '../routes'
import { PolicyStore } from '../store'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const INTERNAL_TOKEN = 'internal-secret'

const tempDirectories: string[] = []

interface ApprovalSessionsStub {
  interface: ApprovalSessionsInterface
  setSessionContext(name: string, context: ApprovalSessionContext, claudeSessionId?: string): void
  addCodexApproval(approval: PendingCodexApprovalView): void
  resolveCalls: Array<{ approvalId: string; decision: 'accept' | 'decline' }>
}

interface RunningServer {
  approvalCoordinator: ApprovalCoordinator
  approvalSessions: ApprovalSessionsStub
  baseUrl: string
  close: () => Promise<void>
  httpServer: Server
  policyStore: PolicyStore
}

async function removeDirectoryWithRetry(directory: string, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOTEMPTY' || attempt === attempts - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-04-15T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write'],
    },
  } satisfies Record<string, import('../../../server/api-keys/store').ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }

      return {
        ok: true as const,
        record,
      }
    },
  }
}

function createApprovalSessionsStub(): ApprovalSessionsStub {
  const sessionContexts = new Map<string, ApprovalSessionContext>()
  const claudeSessionNames = new Map<string, string>()
  const liveSessions = new Map<string, StreamSession>()
  const codexApprovals = new Map<string, PendingCodexApprovalView>()
  const listeners = new Set<(event: CodexApprovalQueueEvent) => void>()
  const resolveCalls: Array<{ approvalId: string; decision: 'accept' | 'decline' }> = []

  function buildLiveSession(context: ApprovalSessionContext): StreamSession {
    return {
      kind: 'stream',
      name: context.sessionName,
      sessionType: context.sessionType,
      creator: context.creator ?? { kind: 'human' },
      agentType: context.agentType,
      mode: 'default',
      cwd: context.cwd,
      host: context.host,
      currentSkillInvocation: context.currentSkillInvocation,
      spawnedWorkers: [],
      process: {} as StreamSession['process'],
      events: [],
      clients: new Set(),
      createdAt: new Date(0).toISOString(),
      lastEventAt: new Date(0).toISOString(),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      stdoutBuffer: '',
      stdinDraining: false,
      lastTurnCompleted: true,
      conversationEntryCount: 0,
      autoRotatePending: false,
      codexPendingApprovals: new Map(),
      codexUnclassifiedIncomingCount: 0,
      messageQueue: {} as StreamSession['messageQueue'],
      pendingDirectSendMessages: [],
      queuedMessageRetryDelayMs: 250,
      queuedMessageDrainScheduled: false,
      queuedMessageDrainPending: false,
      queuedMessageDrainPendingForce: false,
      restoredIdle: false,
    }
  }

  const approvalSessionsInterface: ApprovalSessionsInterface = {
    getSessionContext(name) {
      return sessionContexts.get(name) ?? null
    },
    findSessionContextByClaudeSessionId(sessionId) {
      const sessionName = claudeSessionNames.get(sessionId)
      return sessionName ? sessionContexts.get(sessionName) ?? null : null
    },
    getLiveSession(name) {
      return liveSessions.get(name) ?? null
    },
    findLiveSessionByClaudeSessionId(sessionId) {
      const sessionName = claudeSessionNames.get(sessionId)
      return sessionName ? liveSessions.get(sessionName) ?? null : null
    },
    listPendingCodexApprovals() {
      return Array.from(codexApprovals.values())
    },
    resolvePendingCodexApproval(approvalId, decision) {
      const approval = codexApprovals.get(approvalId)
      if (!approval) {
        return {
          ok: false,
          code: 'not_found',
          reason: `Pending approval "${approvalId}" was not found`,
        }
      }

      codexApprovals.delete(approvalId)
      resolveCalls.push({ approvalId, decision })
      for (const listener of listeners) {
        listener({
          type: 'resolved',
          approval,
          decision: decision === 'accept' ? 'approve' : 'reject',
          delivered: true,
        })
      }

      return { ok: true }
    },
    subscribeToCodexApprovalQueue(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    interface: approvalSessionsInterface,
    setSessionContext(name, context, claudeSessionId) {
      sessionContexts.set(name, context)
      liveSessions.set(name, buildLiveSession(context))
      if (claudeSessionId) {
        claudeSessionNames.set(claudeSessionId, name)
      }
    },
    addCodexApproval(approval) {
      codexApprovals.set(approval.id, approval)
      for (const listener of listeners) {
        listener({
          type: 'enqueued',
          approval,
        })
      }
    },
    resolveCalls,
  }
}

async function startServer(options: { rootDir?: string; now?: () => Date } = {}): Promise<RunningServer> {
  const rootDir = options.rootDir ?? await mkdtemp(path.join(tmpdir(), 'hammurabi-policies-routes-'))
  if (!options.rootDir) {
    tempDirectories.push(rootDir)
  }

  const policyStore = new PolicyStore({
    filePath: path.join(rootDir, 'policies.json'),
  })
  const approvalCoordinator = new ApprovalCoordinator({
    snapshotFilePath: path.join(rootDir, 'pending.json'),
    auditFilePath: path.join(rootDir, 'audit.jsonl'),
    now: options.now,
  })
  const approvalSessions = createApprovalSessionsStub()
  const actionPolicyGate = new ActionPolicyGate({
    policyStore,
    approvalCoordinator,
    getApprovalSessionsInterface: () => approvalSessions.interface,
  })

  const app = express()
  app.use(express.json())

  const policies = createPoliciesRouter({
    apiKeyStore: createTestApiKeyStore(),
    internalToken: INTERNAL_TOKEN,
    policyStore,
    approvalCoordinator,
    approvalSessionsInterface: approvalSessions.interface,
    actionPolicyGate,
  })
  const approvals = createApprovalsRouter({
    apiKeyStore: createTestApiKeyStore(),
    internalToken: INTERNAL_TOKEN,
    approvalCoordinator,
    approvalSessionsInterface: approvalSessions.interface,
  })

  app.use('/api', policies.router)
  app.use('/api/approvals', approvals.router)

  const httpServer = createServer(app)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/approvals/')) {
      approvals.handleUpgrade(req, socket, head)
      return
    }

    socket.destroy()
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    approvalCoordinator,
    approvalSessions,
    baseUrl: `http://127.0.0.1:${address.port}`,
    httpServer,
    policyStore,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      approvalCoordinator.shutdown()
    },
  }
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (payload) => {
      try {
        resolve(JSON.parse(payload.toString()) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    ws.once('error', reject)
  })
}

async function waitForDelivery(
  coordinator: ApprovalCoordinator,
  approvalId: string,
): Promise<void> {
  await vi.waitFor(async () => {
    expect(await coordinator.getStatus(approvalId)).toBeNull()
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of tempDirectories.splice(0)) {
    await removeDirectoryWithRetry(directory)
  }
})

describe('policies routes', () => {
  it('reads and updates policy timeout settings', async () => {
    const server = await startServer()

    try {
      const initialResponse = await fetch(`${server.baseUrl}/api/action-policies/settings`, {
        headers: AUTH_HEADERS,
      })
      expect(initialResponse.status).toBe(200)
      expect(await initialResponse.json()).toEqual({
        settings: {
          timeoutMinutes: 15,
          timeoutAction: 'block',
          standingApprovalExpiryDays: 30,
        },
      })

      const updateResponse = await fetch(`${server.baseUrl}/api/action-policies/settings`, {
        method: 'PUT',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          timeoutMinutes: 30,
          timeoutAction: 'auto',
          standingApprovalExpiryDays: 45,
        }),
      })
      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual({
        settings: {
          timeoutMinutes: 30,
          timeoutAction: 'auto',
          standingApprovalExpiryDays: 45,
        },
      })

      expect(await server.policyStore.getSettings()).toEqual({
        timeoutMinutes: 30,
        timeoutAction: 'auto',
        standingApprovalExpiryDays: 45,
      })
    } finally {
      await server.close()
    }
  })

  it('lists global policies and surfaces commander overrides', async () => {
    const server = await startServer()

    try {
      const globalWrite = await fetch(`${server.baseUrl}/api/action-policies`, {
        method: 'PUT',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'global',
          actionId: 'send-email',
          policy: 'block',
          blocklist: ['ceo@example.com'],
        }),
      })
      expect(globalWrite.status).toBe(200)

      const commanderWrite = await fetch(`${server.baseUrl}/api/action-policies`, {
        method: 'PUT',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'commander: commander-1',
          actionId: 'send-email',
          policy: 'auto',
          allowlist: ['ceo@example.com'],
        }),
      })
      expect(commanderWrite.status).toBe(200)

      const response = await fetch(`${server.baseUrl}/api/action-policies?scope=commander:commander-1`, {
        headers: AUTH_HEADERS,
      })
      const policies = await response.json() as Array<Record<string, unknown>>

      expect(response.status).toBe(200)
      expect(policies.find((entry) => entry.actionId === 'send-email')).toEqual(expect.objectContaining({
        actionId: 'send-email',
        scope: 'commander:commander-1',
        sourceScope: 'commander:commander-1',
        policy: 'auto',
        allowlist: ['ceo@example.com'],
        blocklist: [],
      }))
      expect(policies.find((entry) => entry.actionId === 'everything-else')).toEqual(expect.objectContaining({
        actionId: 'everything-else',
        policy: 'review',
        sourceScope: 'global',
      }))
    } finally {
      await server.close()
    }
  })

  it('denies blocked approval checks via the internal hook token', async () => {
    const server = await startServer()

    try {
      await fetch(`${server.baseUrl}/api/action-policies`, {
        method: 'PUT',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'global',
          actionId: 'send-email',
          policy: 'review',
          blocklist: ['ceo@example.com'],
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          tool_name: 'mcp__gmail__send_email',
          tool_input: {
            to: 'ceo@example.com',
            subject: 'Launch update',
          },
        }),
      })
      const payload = await response.json() as { decision: string; reason?: string }

      expect(response.status).toBe(200)
      expect(payload.decision).toBe('deny')
      expect(payload.reason).toContain('ceo@example.com')
    } finally {
      await server.close()
    }
  })

  it('routes Claude approval checks through the shared gate for sessions resolved by session_id', async () => {
    const server = await startServer()

    try {
      server.approvalSessions.setSessionContext(
        'stream-accept-edits-01',
        {
          sessionName: 'stream-accept-edits-01',
          sessionType: 'worker',
          creator: { kind: 'human' },
          agentType: 'claude',
          mode: 'default',
          cwd: '/tmp/worktree',
        },
        'claude-session-accept-edits-01',
      )

      const checkResponse = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          session_id: 'claude-session-accept-edits-01',
          tool_name: 'Bash',
          tool_input: {
            command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
          },
        }),
      })
      const checkPayload = await checkResponse.json() as {
        decision: string
        request_id: string
        retry_after_ms: number
      }

      let pendingApprovalId = ''
      await vi.waitFor(async () => {
        const approvals = await server.approvalCoordinator.listPending()
        expect(approvals).toHaveLength(1)
        pendingApprovalId = approvals[0].id
        expect(approvals[0]).toEqual(expect.objectContaining({
          actionId: 'send-email',
          sessionId: 'stream-accept-edits-01',
          source: 'claude',
        }))
      })
      expect(checkResponse.status).toBe(200)
      expect(checkPayload).toEqual({
        decision: 'pending',
        request_id: pendingApprovalId,
        retry_after_ms: 1000,
      })

      const decideResponse = await fetch(`${server.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: pendingApprovalId,
          decision: 'approve',
        }),
      })

      expect(decideResponse.status).toBe(200)
      const resolvedResponse = await fetch(`${server.baseUrl}/api/approval/check/${pendingApprovalId}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(resolvedResponse.status).toBe(200)
      expect(await resolvedResponse.json()).toEqual({
        decision: 'allow',
      })
      await waitForDelivery(server.approvalCoordinator, pendingApprovalId)
    } finally {
      await server.close()
    }
  })

  it('stricter of skill vs action wins (skill=auto + action=review => review)', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__gmail__send_email',
      toolInput: {
        to: 'outside@example.com',
      },
      policyView: {
        scope: { commanderId: 'commander-1' },
        fallbackPolicy: 'review',
        records: [],
      },
      session: {
        commanderId: 'commander-1',
        sessionId: 'stream-skill-01',
        currentSkillId: 'send-weekly-update',
        currentSkillName: '/send-weekly-update',
        currentSkillPolicy: 'auto',
      },
    })

    expect(resolved).toEqual(expect.objectContaining({
      decision: 'review',
      action: expect.objectContaining({ id: 'send-email' }),
      matchedBy: 'mcp',
    }))
  })

  it('stricter of skill vs action wins (skill=block + action=auto => block)', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__gmail__send_email',
      toolInput: {
        to: 'teammate@example.com',
      },
      policyView: {
        scope: { commanderId: 'commander-1' },
        fallbackPolicy: 'review',
        records: [
          {
            actionId: 'send-email',
            policy: 'auto',
            allowlist: [],
            blocklist: [],
          },
        ],
      },
      session: {
        commanderId: 'commander-1',
        sessionId: 'stream-skill-block-01',
        currentSkillId: 'lockdown',
        currentSkillName: '/lockdown',
        currentSkillPolicy: 'block',
      },
    })

    expect(resolved).toEqual(expect.objectContaining({
      decision: 'block',
      matchedBy: 'skill',
      action: expect.objectContaining({ id: 'skill:lockdown' }),
    }))
  })

  it('stricter of skill vs fallback action wins (skill=auto + fallback=review => review)', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'curl https://example.com',
      },
      policyView: {
        scope: { commanderId: 'commander-1' },
        fallbackPolicy: 'review',
        records: [],
      },
      session: {
        commanderId: 'commander-1',
        sessionId: 'stream-skill-fallback-01',
        currentSkillId: 'send-weekly-update',
        currentSkillName: '/send-weekly-update',
        currentSkillPolicy: 'auto',
      },
    })

    expect(resolved).toEqual(expect.objectContaining({
      decision: 'review',
      action: null,
      matchedBy: 'fallback',
    }))
  })

  it('uses the skill policy instead of auto-trusting every active skill invocation', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__gmail__send_email',
      toolInput: {
        to: 'outside@example.com',
        subject: 'Weekly update',
      },
      policyView: {
        scope: { commanderId: 'commander-1' },
        fallbackPolicy: 'review',
        records: [],
      },
      session: {
        commanderId: 'commander-1',
        sessionId: 'stream-skill-review-01',
        currentSkillId: 'send-weekly-update',
        currentSkillName: '/send-weekly-update',
        currentSkillPolicy: 'review',
      },
    })

    expect(resolved).toEqual(expect.objectContaining({
      decision: 'review',
      action: expect.objectContaining({
        id: 'skill:send-weekly-update',
        label: '/send-weekly-update',
        group: 'Skills',
      }),
      context: expect.objectContaining({
        summary: '/send-weekly-update',
        details: {
          Skill: '/send-weekly-update',
        },
      }),
    }))
  })

  it('keeps review when inherited skill context is stricter than an internal auto-allow action', async () => {
    const server = await startServer()

    try {
      server.approvalSessions.setSessionContext('worker-skill-review-01', {
        sessionName: 'worker-skill-review-01',
        sessionType: 'worker',
        creator: { kind: 'commander', id: 'cmdr-atlas' },
        agentType: 'claude',
        mode: 'default',
        cwd: '/tmp/worktree',
        currentSkillInvocation: {
          skillId: 'send-weekly-update',
          displayName: '/send-weekly-update',
          startedAt: '2026-04-26T12:00:00.000Z',
          toolUseId: 'toolu_123',
        },
      })

      const checkResponse = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          source: 'codex',
          hammurabi_session_name: 'worker-skill-review-01',
          tool_name: 'Bash',
          tool_input: {
            command: 'pwd',
          },
        }),
      })
      const checkPayload = await checkResponse.json() as {
        decision: string
        request_id: string
        retry_after_ms: number
      }

      await vi.waitFor(async () => {
        const approvals = await server.approvalCoordinator.listPending()
        expect(approvals).toHaveLength(1)
        expect(approvals[0]).toEqual(expect.objectContaining({
          actionId: 'skill:send-weekly-update',
          currentSkillId: 'send-weekly-update',
          currentSkillName: '/send-weekly-update',
          source: 'claude',
          sessionId: 'worker-skill-review-01',
        }))
      })

      const [pendingApproval] = await server.approvalCoordinator.listPending()
      expect(pendingApproval).toBeDefined()
      if (!pendingApproval) {
        throw new Error('Expected a pending approval for the inherited skill review test')
      }
      const decideResponse = await fetch(`${server.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: pendingApproval.id,
          decision: 'approve',
        }),
      })
      expect(decideResponse.status).toBe(200)

      expect(checkResponse.status).toBe(200)
      expect(checkPayload).toEqual({
        decision: 'pending',
        request_id: pendingApproval.id,
        retry_after_ms: 1000,
      })

      const resolvedResponse = await fetch(`${server.baseUrl}/api/approval/check/${pendingApproval.id}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(resolvedResponse.status).toBe(200)
      expect(await resolvedResponse.json()).toEqual({
        decision: 'allow',
      })
      await waitForDelivery(server.approvalCoordinator, pendingApproval.id)
    } finally {
      await server.close()
    }
  })

  it('queues review decisions and resolves them through the approvals API', async () => {
    const server = await startServer()

    try {
      const checkResponse = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          hammurabi_session_name: 'stream-review-01',
          tool_name: 'mcp__slack__post_message',
          tool_input: {
            channel: '#ops',
            message: 'Push the change now.',
          },
        }),
      })
      const checkPayload = await checkResponse.json() as {
        decision: string
        request_id: string
        retry_after_ms: number
      }

      let pendingApprovalId = ''
      await vi.waitFor(async () => {
        const approvals = await server.approvalCoordinator.listPending()
        expect(approvals).toHaveLength(1)
        pendingApprovalId = approvals[0].id
      })
      expect(checkResponse.status).toBe(200)
      expect(checkPayload).toEqual({
        decision: 'pending',
        request_id: pendingApprovalId,
        retry_after_ms: 1000,
      })

      const pendingResponse = await fetch(`${server.baseUrl}/api/approvals/pending`, {
        headers: AUTH_HEADERS,
      })
      const pendingPayload = await pendingResponse.json() as {
        approvals: Array<Record<string, unknown>>
      }

      expect(pendingResponse.status).toBe(200)
      expect(pendingPayload.approvals).toEqual([
        expect.objectContaining({
          approvalId: pendingApprovalId,
          actionId: 'send-message',
          source: 'claude',
          sessionName: 'stream-review-01',
        }),
      ])

      const decideResponse = await fetch(`${server.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: pendingApprovalId,
          decision: 'approve',
        }),
      })

      expect(decideResponse.status).toBe(200)
      expect(await decideResponse.json()).toEqual({
        ok: true,
        id: pendingApprovalId,
        decision: 'approve',
      })

      const resolvedResponse = await fetch(`${server.baseUrl}/api/approval/check/${pendingApprovalId}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(resolvedResponse.status).toBe(200)
      expect(await resolvedResponse.json()).toEqual({
        decision: 'allow',
      })
      await waitForDelivery(server.approvalCoordinator, pendingApprovalId)
      expect(await server.approvalCoordinator.listPending()).toHaveLength(0)

      await vi.waitFor(async () => {
        const historyResponse = await fetch(
          `${server.baseUrl}/api/approvals/history?commander=&limit=5`,
          { headers: AUTH_HEADERS },
        )
        expect(historyResponse.status).toBe(200)
        expect(await historyResponse.json()).toEqual({
          history: [
            expect.objectContaining({
              type: 'approval.resolved',
              approvalId: pendingApprovalId,
              actionId: 'send-message',
              decision: 'approve',
              delivered: true,
            }),
            expect.objectContaining({
              type: 'approval.enqueued',
              approvalId: pendingApprovalId,
              actionId: 'send-message',
            }),
          ],
        })
      })
    } finally {
      await server.close()
    }
  })

  it('drops resolved approvals older than 24h from /api/approvals/history by default', async () => {
    const fixedNow = new Date('2026-05-01T12:00:00.000Z')
    const server = await startServer({ now: () => new Date(fixedNow) })

    try {
      await server.approvalCoordinator.recordHistoryEntry({
        timestamp: new Date(fixedNow.getTime() - (25 * 60 * 60 * 1000)).toISOString(),
        type: 'approval.resolved',
        approvalId: 'resolved-older-than-24h',
        actionId: 'send-message',
        actionLabel: 'Send Message',
        source: 'claude',
        summary: 'Resolved too long ago',
        decision: 'approve',
        delivered: true,
        outcome: {
          decision: 'approve',
          allowed: true,
        },
      })

      const historyResponse = await fetch(`${server.baseUrl}/api/approvals/history?limit=5`, {
        headers: AUTH_HEADERS,
      })

      expect(historyResponse.status).toBe(200)
      expect(await historyResponse.json()).toEqual({ history: [] })
    } finally {
      await server.close()
    }
  })

  it('keeps resolved approvals from the last 24h in /api/approvals/history by default', async () => {
    const fixedNow = new Date('2026-05-01T12:00:00.000Z')
    const recentResolvedAt = new Date(fixedNow.getTime() - (23 * 60 * 60 * 1000)).toISOString()
    const server = await startServer({ now: () => new Date(fixedNow) })

    try {
      await server.approvalCoordinator.recordHistoryEntry({
        timestamp: recentResolvedAt,
        type: 'approval.resolved',
        approvalId: 'resolved-within-24h',
        actionId: 'send-message',
        actionLabel: 'Send Message',
        source: 'claude',
        summary: 'Resolved recently',
        decision: 'reject',
        delivered: true,
        outcome: {
          decision: 'reject',
          allowed: false,
        },
      })

      const historyResponse = await fetch(`${server.baseUrl}/api/approvals/history?limit=5`, {
        headers: AUTH_HEADERS,
      })

      expect(historyResponse.status).toBe(200)
      expect(await historyResponse.json()).toEqual({
        history: [
          expect.objectContaining({
            approvalId: 'resolved-within-24h',
            timestamp: recentResolvedAt,
            type: 'approval.resolved',
            decision: 'reject',
          }),
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('honors an explicit from override on /api/approvals/history', async () => {
    const fixedNow = new Date('2026-05-01T12:00:00.000Z')
    const olderResolvedAt = new Date(fixedNow.getTime() - (25 * 60 * 60 * 1000)).toISOString()
    const recentResolvedAt = new Date(fixedNow.getTime() - (23 * 60 * 60 * 1000)).toISOString()
    const explicitFrom = new Date(fixedNow.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString()
    const server = await startServer({ now: () => new Date(fixedNow) })

    try {
      await server.approvalCoordinator.recordHistoryEntry({
        timestamp: olderResolvedAt,
        type: 'approval.resolved',
        approvalId: 'resolved-older-than-24h',
        actionId: 'send-message',
        actionLabel: 'Send Message',
        source: 'claude',
        summary: 'Resolved too long ago',
        decision: 'approve',
        delivered: true,
        outcome: {
          decision: 'approve',
          allowed: true,
        },
      })
      await server.approvalCoordinator.recordHistoryEntry({
        timestamp: recentResolvedAt,
        type: 'approval.resolved',
        approvalId: 'resolved-within-24h',
        actionId: 'send-message',
        actionLabel: 'Send Message',
        source: 'claude',
        summary: 'Resolved recently',
        decision: 'reject',
        delivered: true,
        outcome: {
          decision: 'reject',
          allowed: false,
        },
      })

      const historyResponse = await fetch(
        `${server.baseUrl}/api/approvals/history?limit=5&from=${encodeURIComponent(explicitFrom)}`,
        { headers: AUTH_HEADERS },
      )

      expect(historyResponse.status).toBe(200)
      expect(await historyResponse.json()).toEqual({
        history: [
          expect.objectContaining({
            approvalId: 'resolved-within-24h',
            timestamp: recentResolvedAt,
          }),
          expect.objectContaining({
            approvalId: 'resolved-older-than-24h',
            timestamp: olderResolvedAt,
          }),
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('keeps older pending approvals visible in /api/approvals/pending', async () => {
    const fixedNow = new Date('2026-05-01T12:00:00.000Z')
    const requestedAt = new Date(fixedNow.getTime() - (25 * 60 * 60 * 1000)).toISOString()
    const server = await startServer({ now: () => new Date(fixedNow) })

    try {
      const approval = await server.approvalCoordinator.enqueue({
        source: 'claude',
        sessionId: 'older-pending-session',
        actionId: 'send-message',
        actionLabel: 'Send Message',
        toolName: 'bash',
        requestedAt,
        context: {
          summary: 'Pending approval remains visible',
          details: {
            target: '#ops',
          },
        },
      })

      const pendingResponse = await fetch(`${server.baseUrl}/api/approvals/pending`, {
        headers: AUTH_HEADERS,
      })
      const pendingPayload = await pendingResponse.json() as {
        approvals: Array<Record<string, unknown>>
      }

      expect(pendingResponse.status).toBe(200)
      expect(pendingPayload.approvals).toEqual([
        expect.objectContaining({
          approvalId: approval.id,
          requestedAt,
          source: 'claude',
          sessionName: 'older-pending-session',
        }),
      ])
    } finally {
      await server.close()
    }
  })

  it('returns pending from the polling endpoint until a review resolves', async () => {
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          hammurabi_session_name: 'stream-poll-01',
          tool_name: 'mcp__slack__post_message',
          tool_input: {
            channel: '#ops',
            message: 'Ship the hotfix.',
          },
        }),
      })
      const createPayload = await createResponse.json() as {
        decision: string
        request_id: string
        retry_after_ms: number
      }

      expect(createResponse.status).toBe(200)
      expect(createPayload.decision).toBe('pending')

      const pendingResponse = await fetch(`${server.baseUrl}/api/approval/check/${createPayload.request_id}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(pendingResponse.status).toBe(200)
      expect(await pendingResponse.json()).toEqual({
        decision: 'pending',
        request_id: createPayload.request_id,
        retry_after_ms: 1000,
      })

      const decideResponse = await fetch(`${server.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: createPayload.request_id,
          decision: 'approve',
        }),
      })
      expect(decideResponse.status).toBe(200)

      const resolvedResponse = await fetch(`${server.baseUrl}/api/approval/check/${createPayload.request_id}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(resolvedResponse.status).toBe(200)
      expect(await resolvedResponse.json()).toEqual({
        decision: 'allow',
      })
      await waitForDelivery(server.approvalCoordinator, createPayload.request_id)
    } finally {
      await server.close()
    }
  })

  it('keeps pending approvals restart-safe across the polling route', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-policies-routes-restart-'))
    tempDirectories.push(rootDir)

    const firstServer = await startServer({ rootDir })

    let requestId = ''
    try {
      const createResponse = await fetch(`${firstServer.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          hammurabi_session_name: 'stream-restart-01',
          tool_name: 'mcp__slack__post_message',
          tool_input: {
            channel: '#ops',
            message: 'Wait for restart.',
          },
        }),
      })
      const createPayload = await createResponse.json() as {
        decision: string
        request_id: string
      }
      requestId = createPayload.request_id
      expect(createPayload.decision).toBe('pending')
    } finally {
      await firstServer.close()
    }

    const secondServer = await startServer({ rootDir })
    try {
      const pendingResponse = await fetch(`${secondServer.baseUrl}/api/approval/check/${requestId}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(pendingResponse.status).toBe(200)
      expect(await pendingResponse.json()).toEqual({
        decision: 'pending',
        request_id: requestId,
        retry_after_ms: 1000,
      })

      const decideResponse = await fetch(`${secondServer.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: requestId,
          decision: 'approve',
        }),
      })
      expect(decideResponse.status).toBe(200)

      const resolvedResponse = await fetch(`${secondServer.baseUrl}/api/approval/check/${requestId}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(resolvedResponse.status).toBe(200)
      expect(await resolvedResponse.json()).toEqual({
        decision: 'allow',
      })
      await waitForDelivery(secondServer.approvalCoordinator, requestId)
    } finally {
      await secondServer.close()
    }
  })

  it('keeps 60+ minute reviews deliverable once polling is in place', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'))

    const server = await startServer()
    try {
      const settingsResponse = await fetch(`${server.baseUrl}/api/action-policies/settings`, {
        method: 'PUT',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          timeoutMinutes: 62,
        }),
      })
      expect(settingsResponse.status).toBe(200)

      const createResponse = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          hammurabi_session_name: 'stream-long-review-01',
          tool_name: 'mcp__slack__post_message',
          tool_input: {
            channel: '#ops',
            message: 'Long-running review.',
          },
        }),
      })
      const createPayload = await createResponse.json() as {
        decision: string
        request_id: string
      }
      expect(createPayload.decision).toBe('pending')

      await vi.advanceTimersByTimeAsync(61 * 60 * 1_000)

      const decideResponse = await fetch(`${server.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: createPayload.request_id,
          decision: 'approve',
        }),
      })
      expect(decideResponse.status).toBe(200)

      const resolvedResponse = await fetch(`${server.baseUrl}/api/approval/check/${createPayload.request_id}`, {
        headers: {
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
      })
      expect(resolvedResponse.status).toBe(200)
      expect(await resolvedResponse.json()).toEqual({
        decision: 'allow',
      })
      await waitForDelivery(server.approvalCoordinator, createPayload.request_id)

      await vi.waitFor(async () => {
        const historyResponse = await fetch(
          `${server.baseUrl}/api/approvals/history?commander=&limit=5`,
          { headers: AUTH_HEADERS },
        )
        expect(historyResponse.status).toBe(200)
        expect(await historyResponse.json()).toEqual({
          history: [
            expect.objectContaining({
              type: 'approval.resolved',
              approvalId: createPayload.request_id,
              delivered: true,
            }),
            expect.objectContaining({
              type: 'approval.enqueued',
              approvalId: createPayload.request_id,
            }),
          ],
        })
      })
    } finally {
      await server.close()
      vi.useRealTimers()
    }
  })

  it('auto-allows allowlisted send-email checks without enqueueing approval', async () => {
    const server = await startServer()

    try {
      await server.policyStore.putPolicy('global', 'send-email', {
        policy: 'review',
        allowlist: ['teammate@example.com'],
        blocklist: [],
      })

      const response = await fetch(`${server.baseUrl}/api/approval/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          tool_name: 'Bash',
          tool_input: {
            command: 'gog gmail send --to teammate@example.com --subject "Status"',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        decision: 'allow',
      })
      expect(await server.approvalCoordinator.listPending()).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('streams codex approval queue events and resolves codex approvals through the shared endpoint', async () => {
    const server = await startServer()
    const ws = new WebSocket(`${server.baseUrl.replace('http', 'ws')}/api/approvals/stream?api_key=test-key`)

    try {
      const snapshotMessage = waitForMessage(ws)
      await waitForOpen(ws)

      expect(await snapshotMessage).toEqual({
        type: 'approval.snapshot',
        approvals: [],
      })

      const codexApprovalRequestedAt = new Date(Date.now() - (60 * 60 * 1000)).toISOString()
      const codexApproval: PendingCodexApprovalView = {
        id: 'codex-approval-1',
        sessionName: 'codex-session-1',
        commanderScopeId: 'commander-2',
        requestId: 77,
        actionId: 'push-code-prs',
        actionLabel: 'Push Code / PRs',
        requestedAt: codexApprovalRequestedAt,
        reason: 'Would push origin main',
        risk: 'Touches protected branch',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }

      const enqueuedMessage = waitForMessage(ws)
      server.approvalSessions.addCodexApproval(codexApproval)

      expect(await enqueuedMessage).toEqual({
        type: 'approval.enqueued',
        approvalId: 'codex-approval-1',
        approval: expect.objectContaining({
          approvalId: 'codex-approval-1',
          requestId: 77,
          source: 'codex',
          actionId: 'push-code-prs',
          sessionName: 'codex-session-1',
        }),
      })

      const pendingResponse = await fetch(`${server.baseUrl}/api/approvals/pending`, {
        headers: AUTH_HEADERS,
      })
      const pendingPayload = await pendingResponse.json() as {
        approvals: Array<Record<string, unknown>>
      }
      expect(pendingPayload.approvals).toEqual([
        expect.objectContaining({
          approvalId: 'codex-approval-1',
          requestId: 77,
          source: 'codex',
        }),
      ])

      const resolvedMessage = waitForMessage(ws)
      const decideResponse = await fetch(`${server.baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: 'codex-approval-1',
          decision: 'reject',
        }),
      })

      expect(decideResponse.status).toBe(200)
      expect(await decideResponse.json()).toEqual({
        ok: true,
        id: 'codex-approval-1',
        decision: 'reject',
      })
      expect(server.approvalSessions.resolveCalls).toEqual([
        { approvalId: 'codex-approval-1', decision: 'decline' },
      ])
      expect(await resolvedMessage).toEqual({
        type: 'approval.resolved',
        approvalId: 'codex-approval-1',
        approval: expect.objectContaining({
          approvalId: 'codex-approval-1',
          requestId: 77,
          source: 'codex',
        }),
        decision: 'reject',
        delivered: true,
      })

      await vi.waitFor(async () => {
        const historyResponse = await fetch(
          `${server.baseUrl}/api/approvals/history?source=codex&limit=5`,
          { headers: AUTH_HEADERS },
        )
        expect(historyResponse.status).toBe(200)
        expect(await historyResponse.json()).toEqual({
          history: [
            expect.objectContaining({
              type: 'approval.resolved',
              approvalId: 'codex-approval-1',
              actionId: 'push-code-prs',
              source: 'codex',
              decision: 'reject',
              delivered: true,
            }),
            expect.objectContaining({
              type: 'approval.enqueued',
              approvalId: 'codex-approval-1',
              actionId: 'push-code-prs',
              source: 'codex',
            }),
          ],
        })
      })
    } finally {
      ws.close()
      await server.close()
    }
  })
})

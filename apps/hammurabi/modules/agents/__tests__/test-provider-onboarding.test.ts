import express from 'express'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { createAutomationsRouter } from '../../automations/routes.js'
import { AutomationStore } from '../../automations/store.js'
import { defaultOperatorStorePath, OperatorStore } from '../../operators/store.js'
import { createAgentsRouter } from '../routes.js'
import { createProviderRegistryRouter } from '../providers/http-router.js'
import { loadRegisteredMachineProviders, unregisterMachineProvider } from '../providers/machine-provider-adapter.js'
import {
  getProvider,
  loadRegisteredProviders,
  parseProviderId,
  unregisterProvider,
} from '../providers/registry.js'
import {
  buildNewAutomationCreateRequestBody,
  validateHireCommanderWizardStep,
} from '../../org/forms/helpers.js'
import type { ProviderRegistryEntry } from '@/types'

const TEST_PROVIDER_ID = 'test-foo'
const testFileDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(testFileDir, '../../..')
const adaptersRoot = path.join(appRoot, 'modules', 'agents', 'adapters')
const testProviderDir = path.join(adaptersRoot, TEST_PROVIDER_ID)
const generatorScriptPath = path.join(appRoot, 'scripts', 'generate-provider-registry.mjs')
const generatedRegistryLoadersPath = path.join(
  appRoot,
  'modules',
  'agents',
  'providers',
  '.generated',
  'registered-loaders.ts',
)
const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

type CallTrackingGlobal = typeof globalThis & {
  __TEST_FOO_CREATE_CALLS__?: string[]
}

function buildTestProviderFiles(): Record<string, string> {
  return {
    'helpers.ts': `import { EventEmitter } from 'node:events'
import type { ProviderSessionContext } from '../../providers/provider-session-context.js'

export interface TestFooProviderContext extends ProviderSessionContext {
  providerId: '${TEST_PROVIDER_ID}'
  sessionId?: string
}

export function createTestFooProviderContext(
  init: Omit<TestFooProviderContext, 'providerId'> = {},
): TestFooProviderContext {
  return {
    providerId: '${TEST_PROVIDER_ID}',
    ...init,
  }
}

export function readTestFooSessionId(
  value: { providerContext?: ProviderSessionContext },
): string | undefined {
  const context = value.providerContext
  return context?.providerId === '${TEST_PROVIDER_ID}'
    && typeof (context as TestFooProviderContext).sessionId === 'string'
    && (context as TestFooProviderContext).sessionId?.trim().length
    ? (context as TestFooProviderContext).sessionId?.trim()
    : undefined
}

export function createMockProcess() {
  const emitter = new EventEmitter()
  const stdoutEmitter = new EventEmitter()
  const stderrEmitter = new EventEmitter()
  const stdinEmitter = new EventEmitter()

  const stdout = Object.assign(stdoutEmitter, {
    pipe: () => stdout,
    on: stdoutEmitter.on.bind(stdoutEmitter),
  })
  const stderr = Object.assign(stderrEmitter, {
    on: stderrEmitter.on.bind(stderrEmitter),
  })
  const stdin = Object.assign(stdinEmitter, {
    writable: true,
    write: () => true,
    end: () => true,
    on: stdinEmitter.on.bind(stdinEmitter),
    once: stdinEmitter.once.bind(stdinEmitter),
  })

  return Object.assign(emitter, {
    pid: 9001,
    stdout,
    stderr,
    stdin,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  })
}
`,
    'approval-adapter.ts': `import type { ActionPolicyGateResult } from '../../../policies/action-policy-gate.js'
import type { ProviderApprovalAdapter } from '../../../policies/provider-approval-adapter.js'

export const testFooApprovalAdapter: ProviderApprovalAdapter<Record<string, never>, ActionPolicyGateResult> = {
  source: '${TEST_PROVIDER_ID}',
  toUnifiedRequest(_rawEvent, session) {
    return {
      source: '${TEST_PROVIDER_ID}',
      toolName: 'test-foo-tool',
      sessionName: session.name,
      providerContext: session.providerContext,
    }
  },
  sendReply(result) {
    return result
  },
}
`,
    'machine-adapter.ts': `import { registerMachineProvider } from '../../providers/machine-provider-adapter.js'

export const testFooMachineProvider = registerMachineProvider({
  id: '${TEST_PROVIDER_ID}',
  label: 'Test Foo',
  cliBinaryName: 'test-foo',
  authEnvKeys: ['TEST_FOO_API_KEY'],
  supportedAuthModes: ['api-key'],
  loginStatusCommand: null,
  modeRequiresSecret(mode) {
    return mode === 'api-key'
  },
  classifyAuthMethod({ envSourceKey }) {
    return envSourceKey ? 'api-key' : 'missing'
  },
  computeAuthSetupUpdates({ mode, secret }) {
    if (mode !== 'api-key') {
      return {}
    }
    return {
      TEST_FOO_API_KEY: secret ?? null,
    }
  },
})
`,
    'session.ts': `import { DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT, SessionMessageQueue } from '../../message-queue.js'
import type { ProviderCreateOptions } from '../../providers/provider-adapter.js'
import type { ExitedStreamSessionState, PersistedStreamSession, StreamSession } from '../../types.js'
import type { StreamSessionAdapter } from '../../types.js'
import { createMockProcess, createTestFooProviderContext, readTestFooSessionId } from './helpers.js'

function createBaseSession(
  options: ProviderCreateOptions,
  adapter: StreamSessionAdapter,
  sessionId: string,
): StreamSession {
  const createdAt = options.createdAt ?? new Date().toISOString()
  return {
    kind: 'stream',
    name: options.sessionName,
    sessionType: options.sessionType ?? 'worker',
    creator: options.creator ?? { kind: 'human' },
    conversationId: options.conversationId,
    agentType: '${TEST_PROVIDER_ID}',
    mode: options.mode,
    cwd: options.cwd ?? process.cwd(),
    host: options.machine?.id,
    currentSkillInvocation: options.currentSkillInvocation,
    spawnedBy: options.spawnedBy,
    spawnedWorkers: [...(options.spawnedWorkers ?? [])],
    task: options.task,
    process: createMockProcess() as never,
    events: [],
    clients: new Set(),
    createdAt,
    lastEventAt: createdAt,
    systemPrompt: options.systemPrompt,
    maxTurns: options.maxTurns,
    model: options.model,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: false,
    providerContext: createTestFooProviderContext({ sessionId }),
    resumedFrom: options.resumedFrom,
    conversationEntryCount: 0,
    autoRotatePending: false,
    codexUnclassifiedIncomingCount: 0,
    codexPendingApprovals: new Map(),
    messageQueue: new SessionMessageQueue(DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT),
    pendingDirectSendMessages: [],
    queuedMessageRetryDelayMs: 1000,
    queuedMessageDrainScheduled: false,
    queuedMessageDrainPending: false,
    queuedMessageDrainPendingForce: false,
    adapter,
    restoredIdle: false,
  }
}

export function createTestFooSession(
  options: ProviderCreateOptions,
  adapter: StreamSessionAdapter,
): StreamSession {
  const sessionId = options.resumeSessionId ?? '${TEST_PROVIDER_ID}-session-' + options.sessionName
  return createBaseSession(options, adapter, sessionId)
}

export function restoreTestFooSession(
  entry: PersistedStreamSession,
  options: ProviderCreateOptions,
  adapter: StreamSessionAdapter,
): StreamSession {
  return createBaseSession(
    options,
    adapter,
    readTestFooSessionId(entry) ?? '${TEST_PROVIDER_ID}-session-' + entry.name,
  )
}

export function snapshotTestFooSession(session: StreamSession): PersistedStreamSession {
  return {
    name: session.name,
    sessionType: session.sessionType,
    creator: session.creator,
    conversationId: session.conversationId,
    agentType: session.agentType,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: session.currentSkillInvocation,
    createdAt: session.createdAt,
    providerContext: createTestFooProviderContext({
      sessionId: readTestFooSessionId(session),
    }),
    activeTurnId: session.activeTurnId,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

export function snapshotExitedTestFooSession(session: StreamSession): ExitedStreamSessionState {
  return {
    phase: 'exited',
    hadResult: Boolean(session.finalResultEvent),
    sessionType: session.sessionType,
    creator: session.creator,
    conversationId: session.conversationId,
    agentType: session.agentType,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: session.currentSkillInvocation,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    createdAt: session.createdAt,
    providerContext: createTestFooProviderContext({
      sessionId: readTestFooSessionId(session),
    }),
    activeTurnId: session.activeTurnId,
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}
`,
    'provider.ts': `import { registerProvider } from '../../providers/registry.js'
import type { ProviderAdapterDeps, ProviderCreateOptions, ProviderPermissionModeOption } from '../../providers/provider-adapter.js'
import { testFooMachineProvider } from './machine-adapter.js'
import { testFooApprovalAdapter } from './approval-adapter.js'
import {
  createTestFooSession,
  restoreTestFooSession,
  snapshotExitedTestFooSession,
  snapshotTestFooSession,
} from './session.js'
import { readTestFooSessionId } from './helpers.js'

const permissionModes: ProviderPermissionModeOption[] = [
  {
    value: 'default',
    label: 'Default',
    description: 'Use provider-managed permissions.',
  },
]

export const testFooProvider = registerProvider({
  id: '${TEST_PROVIDER_ID}',
  label: 'Test Foo',
  eventProvider: '${TEST_PROVIDER_ID}',
  approvalAdapter: testFooApprovalAdapter,
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
  },
  uiCapabilities: {
    supportsEffort: false,
    supportsAdaptiveThinking: false,
    supportsSkills: false,
    supportsLoginMode: false,
    forcedTransport: 'stream',
    permissionModes,
  },
  machineAuth: testFooMachineProvider,
  preparePtyEnv() {
    return {}
  },
  buildStreamSessionAdapter(_deps: ProviderAdapterDeps) {
    return {
      async dispatchSend() {
        return { ok: true, delivered: 'live' as const }
      },
    }
  },
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps) {
    const calls = (globalThis as typeof globalThis & { __TEST_FOO_CREATE_CALLS__?: string[] }).__TEST_FOO_CREATE_CALLS__ ??= []
    calls.push(options.sessionName)
    return createTestFooSession(options, this.buildStreamSessionAdapter(deps))
  },
  restore(entry, machine, deps) {
    return restoreTestFooSession(entry, {
      sessionName: entry.name,
      mode: entry.mode,
      task: '',
      cwd: entry.cwd,
      machine,
      resumeSessionId: readTestFooSessionId(entry),
      createdAt: entry.createdAt,
      spawnedBy: entry.spawnedBy,
      spawnedWorkers: entry.spawnedWorkers,
      resumedFrom: entry.resumedFrom,
      sessionType: entry.sessionType,
      creator: entry.creator,
      conversationId: entry.conversationId,
      currentSkillInvocation: entry.currentSkillInvocation,
    }, this.buildStreamSessionAdapter(deps))
  },
  snapshotForPersist(session) {
    return snapshotTestFooSession(session)
  },
  snapshotExited(session) {
    return snapshotExitedTestFooSession(session)
  },
  hasResumeIdentifier(entry) {
    return Boolean(readTestFooSessionId(entry))
  },
  canResumeLiveSession(session) {
    return Boolean(readTestFooSessionId(session))
  },
  getResumeId(session) {
    return readTestFooSessionId(session)
  },
  transcriptId(session) {
    return readTestFooSessionId(session) ?? session.name
  },
  teardown(session) {
    try {
      session.process.kill('SIGTERM')
    } catch {
      // Best effort only.
    }
  },
})
`,
    'index.ts': `export * from './approval-adapter.js'
export * from './helpers.js'
export * from './machine-adapter.js'
export * from './provider.js'
export * from './session.js'
`,
  }
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false as const, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const record = {
        id: 'test-key-id',
        name: 'Test Key',
        keyHash: 'hash',
        prefix: 'hmrb_test',
        createdBy: 'test',
        createdAt: '2026-05-04T00:00:00.000Z',
        lastUsedAt: null,
        scopes: ['agents:read', 'agents:write', 'agents:admin', 'commanders:read', 'commanders:write'],
      }
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false as const, reason: 'insufficient_scope' as const }
      }

      return {
        ok: true as const,
        record,
      }
    },
  }
}

async function runProviderRegistryGenerator(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, [generatorScriptPath], { cwd: appRoot }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function writeTestProviderFixture(): Promise<void> {
  await mkdir(testProviderDir, { recursive: true })
  const files = buildTestProviderFiles()
  await Promise.all(
    Object.entries(files).map(async ([fileName, contents]) => {
      await writeFile(path.join(testProviderDir, fileName), contents, 'utf8')
    }),
  )
}

async function cleanupTestProviderFixture(): Promise<void> {
  unregisterProvider(TEST_PROVIDER_ID)
  unregisterMachineProvider(TEST_PROVIDER_ID)
  delete (globalThis as CallTrackingGlobal).__TEST_FOO_CREATE_CALLS__
  await rm(testProviderDir, { recursive: true, force: true })
  await runProviderRegistryGenerator()
}

async function startAutomationsServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const storeDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-'))
  const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-data-'))
  const previousDataDir = process.env.HAMMURABI_DATA_DIR
  process.env.HAMMURABI_DATA_DIR = dataDir

  const operatorStore = new OperatorStore(defaultOperatorStorePath(process.env))
  await operatorStore.saveFounder({
    id: 'founder',
    kind: 'founder',
    displayName: 'Test Founder',
    email: null,
    createdAt: new Date().toISOString(),
  })

  const app = express()
  app.use(express.json())

  const { router } = createAutomationsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store: new AutomationStore({
      dirPath: storeDir,
      commanderDataDir: storeDir,
    }),
    schedulerInitialized: Promise.resolve(),
  })
  app.use('/api', createProviderRegistryRouter({ apiKeyStore: createTestApiKeyStore() }))
  app.use('/api/automations', router)

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve automation test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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
      if (previousDataDir === undefined) {
        delete process.env.HAMMURABI_DATA_DIR
      } else {
        process.env.HAMMURABI_DATA_DIR = previousDataDir
      }
      await rm(dataDir, { recursive: true, force: true })
      await rm(storeDir, { recursive: true, force: true })
    },
  }
}

async function startAgentsServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-agents-'))
  const app = express()
  app.use(express.json())

  const agents = createAgentsRouter({
    apiKeyStore: createTestApiKeyStore(),
    autoResumeSessions: false,
    commanderSessionStorePath: path.join(runtimeDir, 'commander-sessions.json'),
    sessionStorePath: path.join(runtimeDir, 'stream-sessions.json'),
  })

  app.use('/api', createProviderRegistryRouter({ apiKeyStore: createTestApiKeyStore() }))
  app.use('/api/agents', agents.router)

  const httpServer = createServer(app)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/agents/')) {
      agents.handleUpgrade(req, socket, head)
      return
    }
    socket.destroy()
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve agents test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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
      await rm(runtimeDir, { recursive: true, force: true })
    },
  }
}

function parseProviderRegistryResponse(payload: unknown): ProviderRegistryEntry[] {
  if (Array.isArray(payload)) {
    return payload as ProviderRegistryEntry[]
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { providers?: unknown }).providers)) {
    return (payload as { providers: ProviderRegistryEntry[] }).providers
  }
  return []
}

afterEach(async () => {
  await cleanupTestProviderFixture()
})

describe('provider onboarding acceptance', () => {
  it('registers a new provider from one adapter directory with no manual registry edits', async () => {
    await writeTestProviderFixture()
    await runProviderRegistryGenerator()
    const generatedContents = await readFile(generatedRegistryLoadersPath, 'utf8')
    expect(generatedContents).toContain(`"${TEST_PROVIDER_ID}"`)
    await loadRegisteredMachineProviders()
    await loadRegisteredProviders()

    expect(parseProviderId(TEST_PROVIDER_ID)).toBe(TEST_PROVIDER_ID)
    expect(getProvider(TEST_PROVIDER_ID)?.label).toBe('Test Foo')

    const agentServer = await startAgentsServer()
    const automationServer = await startAutomationsServer()

    try {
      const providersResponse = await fetch(`${automationServer.baseUrl}/api/providers`, {
        headers: AUTH_HEADERS,
      })
      expect(providersResponse.status).toBe(200)
      const providers = parseProviderRegistryResponse(await providersResponse.json())
      expect(providers.some((provider) => provider.id === TEST_PROVIDER_ID)).toBe(true)

      const createSessionResponse = await fetch(`${agentServer.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'test-foo-session',
          mode: 'default',
          agentType: TEST_PROVIDER_ID,
        }),
      })
      const createSessionBody = await createSessionResponse.text()
      expect(createSessionResponse.status, createSessionBody).toBe(201)
      expect((globalThis as CallTrackingGlobal).__TEST_FOO_CREATE_CALLS__).toContain('test-foo-session')

      const createAutomationResponse = await fetch(`${automationServer.baseUrl}/api/automations`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'test-foo-automation',
          trigger: 'manual',
          instruction: 'Run the provider onboarding acceptance test.',
          agentType: TEST_PROVIDER_ID,
        }),
      })
      const createAutomationBody = await createAutomationResponse.text()
      expect(createAutomationResponse.status, createAutomationBody).toBe(201)
      const createdAutomation = JSON.parse(createAutomationBody) as { agentType: string }
      expect(createdAutomation.agentType).toBe(TEST_PROVIDER_ID)

      expect(
        buildNewAutomationCreateRequestBody(
          {
            trigger: 'manual',
            cadencePreset: 'every-5-minutes',
            customCron: '',
            questCommanderId: '',
            name: 'Test Foo Automation',
            instruction: 'Run',
            agentType: TEST_PROVIDER_ID,
          },
          {
            existingAutomationNames: [],
            commanders: [],
            owner: { kind: 'operator', id: 'founder' },
            providers,
          },
        ),
      ).not.toBeNull()

      const hireCommanderErrors = validateHireCommanderWizardStep({
        displayName: 'Test Foo Commander',
        roleKey: 'engineering',
        persona: '',
        agentType: TEST_PROVIDER_ID,
        effort: 'medium',
      }, 'review', {
        existingCommanderNames: [],
        providers,
      })
      expect(hireCommanderErrors).toEqual({
        global: null,
        displayName: null,
        roleKey: null,
      })

      expect(
        providers
          .filter((provider) => provider.capabilities.supportsCommanderConversation)
          .map((provider) => provider.id),
      ).toContain(TEST_PROVIDER_ID)
    } finally {
      await Promise.all([
        automationServer.close(),
        agentServer.close(),
      ])
    }
  })
})

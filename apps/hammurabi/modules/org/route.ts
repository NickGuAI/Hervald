import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { DEFAULT_CLAUDE_EFFORT_LEVEL } from '../claude-effort.js'
import {
  profileForApiResponse,
  GAIA_COMMANDER_AVATAR_URL,
  readCommanderUiProfile,
  resolveDefaultCommanderAvatarUrl,
  resolveCommanderAvatarUrl,
  writeCommanderUiProfile,
} from '../commanders/commander-profile.js'
import { ensureCommanderVisualProfile } from '../commanders/commander-visual-profile.js'
import { ConversationStore } from '../commanders/conversation-store.js'
import { createDefaultHeartbeatConfig } from '../commanders/heartbeat.js'
import { setCommanderDisplayName } from '../commanders/names-lock.js'
import {
  resolveCommanderDataDir,
  resolveCommanderNamesPath,
  resolveCommanderSessionStorePath,
} from '../commanders/paths.js'
import { QuestStore } from '../commanders/quest-store.js'
import { createDefaultCommanderRuntimeConfig } from '../commanders/runtime-config.shared.js'
import { CommanderSessionStore, type CommanderSession } from '../commanders/store.js'
import { mergeIdentityOperatingStyleIntoCommanderWorkflow } from '../commanders/templates/workflow.js'
import { defaultOperatorStorePath, OperatorStore } from '../operators/store.js'
import { FOUNDER_OPERATOR_NOT_FOUND_ERROR } from '../operators/constants.js'
import type { Operator } from '../operators/types.js'
import {
  createFounderBootstrapCandidate,
  resolveFounderAvatarBackfillUrl,
} from '../operators/founder-bootstrap.js'
import { resolveFounderAvatarSrc } from '../operators/founder-avatar.js'
import {
  DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES,
  FOUNDER_SETUP_COMPLETED_PATH,
  FOUNDER_SETUP_EMAIL_PATTERN,
  FOUNDER_SETUP_PATH,
  validateFounderOrgSetupFormValues,
  type FounderOrgSetupRequest,
  type FounderOrgSetupResponse,
  type FounderSetupStatus,
} from '../onboarding/contracts.js'
import { buildCommandRoomLaunchTarget } from '../command-room/route-metadata.js'
import { createOrgIdentityRouter } from '../org-identity/route.js'
import { normalizeOrgName, OrgIdentityStore, OrgIdentityValidationError } from '../org-identity/store.js'
import {
  buildOrgTree,
  type BuildOrgTreeDependencies,
  type OrgCommanderRecord,
  type OrgConversationRecord,
} from './aggregator.js'

export interface OrgRouterOptions {
  operatorStore?: BuildOrgTreeDependencies['operatorStore']
  sessionStore?: OrgSessionStore
  automationStore?: BuildOrgTreeDependencies['automationStore']
  conversationStore?: OrgConversationStore
  questStore?: BuildOrgTreeDependencies['questStore']
  profileStore?: BuildOrgTreeDependencies['profileStore']
  orgIdentityStore?: OrgIdentityStore
  commanderDataDir?: string
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

type FutureCommanderOrgFields = {
  displayName?: string
  operatorId?: string
  templateId?: string | null
  replicatedFromCommanderId?: string | null
  activeWorkers?: number
  archived?: boolean
  archivedAt?: string
}

type OrgSessionStore = Pick<CommanderSessionStore, 'list'> &
  Partial<Pick<CommanderSessionStore, 'create'>>

type OrgLaunchConversationRecord = OrgConversationRecord & { id?: string }

type OrgConversationStore = {
  listByCommander(commanderId: string): Promise<ReadonlyArray<OrgLaunchConversationRecord>>
} & Partial<Pick<ConversationStore, 'ensureDefaultConversation' | 'getActiveChatForCommander'>>

const GAIA_HOST = 'gaia'
const GAIA_DISPLAY_NAME = 'Gaia'
const GAIA_TEMPLATE_ID = 'gaia-onboarding'
const GAIA_SPEAKING_TONE = 'Mother-of-all onboarding'
const GAIA_IDENTITY = [
  'Gaia is the mother-of-all onboarding commander for Hervald.',
  'She helps the founder understand the organization, create and manage commanders, and keep onboarding decisions routed through backend APIs instead of fragile frontend-only logic.',
].join(' ')

type DiskBackedOperatorStore = BuildOrgTreeDependencies['operatorStore'] & {
  getFounderForUser(user: AuthUser | undefined): Promise<Operator | null>
  saveFounder(operator: Operator): Promise<Operator>
}

type FounderWriteStore = BuildOrgTreeDependencies['operatorStore'] & {
  saveFounder(operator: Operator): Promise<Operator>
}

class OrgSetupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrgSetupValidationError'
  }
}

async function readCommanderDisplayNames(dataDir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(resolveCommanderNamesPath(dataDir), 'utf8')
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

function createCommanderOrgStore(
  sessionStore: Pick<CommanderSessionStore, 'list'>,
  dataDir: string,
  fallbackOperatorId: string,
  options: { includeArchived?: boolean } = {},
): BuildOrgTreeDependencies['commanderSessionStore'] {
  return {
    async list(): Promise<ReadonlyArray<OrgCommanderRecord>> {
      const [sessions, displayNames] = await Promise.all([
        sessionStore.list(),
        readCommanderDisplayNames(dataDir),
      ])

      return sessions
        .filter((session) => options.includeArchived || session.archived !== true)
        .map((session) => {
          const future = session as CommanderSession & FutureCommanderOrgFields
          const displayName = future.displayName?.trim() || displayNames[session.id]?.trim() || session.host
          return {
            id: session.id,
            displayName,
            operatorId: future.operatorId?.trim() || fallbackOperatorId,
            state: session.state,
            created: session.created,
            templateId: future.templateId ?? null,
            replicatedFromCommanderId: future.replicatedFromCommanderId ?? null,
            activeWorkers: future.activeWorkers ?? (session.state === 'running' ? 1 : 0),
            archived: future.archived === true,
            archivedAt: future.archivedAt,
          }
        })
    },
  }
}

function createProfileStore(
  commanderDataDir: string,
  sessionStore: Pick<CommanderSessionStore, 'list'>,
): BuildOrgTreeDependencies['profileStore'] {
  return {
    async getAvatarUrl(commanderId: string): Promise<string | null> {
      const [profile, sessions] = await Promise.all([
        readCommanderUiProfile(commanderId, commanderDataDir),
        sessionStore.list(),
      ])
      const session = sessions.find((entry) => entry.id === commanderId)
      return resolveCommanderAvatarUrl(
        commanderId,
        commanderDataDir,
        profile,
        {
          defaultAvatarUrl: resolveDefaultCommanderAvatarUrl({
            host: session?.host ?? null,
            templateId: session?.templateId ?? null,
          }),
        },
      )
    },
    async getProfile(commanderId: string) {
      return profileForApiResponse(commanderId, await readCommanderUiProfile(commanderId, commanderDataDir))
    },
  }
}

function createAutomationStoreFallback(): BuildOrgTreeDependencies['automationStore'] {
  return {
    async list() {
      return []
    },
  }
}

function parseFounderDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OrgSetupValidationError('founder.displayName must be a non-empty string up to 120 characters')
  }

  const normalized = raw.trim()
  if (normalized.length === 0 || normalized.length > 120) {
    throw new OrgSetupValidationError('founder.displayName must be a non-empty string up to 120 characters')
  }

  return normalized
}

function parseFounderEmail(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OrgSetupValidationError('founder.email must be a valid email address')
  }

  const normalized = raw.trim()
  if (!FOUNDER_SETUP_EMAIL_PATTERN.test(normalized)) {
    throw new OrgSetupValidationError('founder.email must be a valid email address')
  }

  return normalized
}

function parseFounderOrgSetupRequest(raw: unknown): FounderOrgSetupRequest {
  const body = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : null
  const founder = typeof body?.founder === 'object' && body.founder !== null
    ? body.founder as Record<string, unknown>
    : null

  try {
    return {
      displayName: normalizeOrgName(body?.displayName),
      founder: {
        displayName: parseFounderDisplayName(founder?.displayName),
        email: parseFounderEmail(founder?.email),
      },
    }
  } catch (error) {
    if (error instanceof OrgIdentityValidationError) {
      throw new OrgSetupValidationError(error.message)
    }
    throw error
  }
}

function parseCommanderId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const normalized = raw.trim()
  return normalized.length > 0 ? normalized : null
}

function buildFounderIdFromEmail(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  return `founder-${digest.slice(0, 12)}`
}

async function backfillFounderAvatarFromUser(
  store: FounderWriteStore,
  founder: Operator,
  user: AuthUser | undefined,
): Promise<Operator> {
  const avatarUrl = resolveFounderAvatarBackfillUrl(founder, user)
  if (!avatarUrl) {
    return founder
  }

  return store.saveFounder({
    ...founder,
    avatarUrl,
  })
}

function createDiskBackedOperatorStore(): DiskBackedOperatorStore {
  const filePath = defaultOperatorStorePath()
  const store = new OperatorStore(filePath)
  let bootstrapFounderPromise: Promise<Operator | null> | null = null

  return {
    async getFounder() {
      return store.getFounder()
    },
    async saveFounder(operator) {
      return store.saveFounder(operator)
    },
    async getFounderForUser(user) {
      const founder = await store.getFounder()
      if (founder) {
        return backfillFounderAvatarFromUser(store, founder, user)
      }

      const bootstrapCandidate = createFounderBootstrapCandidate(user)
      if (!bootstrapCandidate) {
        return null
      }

      if (!bootstrapFounderPromise) {
        bootstrapFounderPromise = (async () => {
          const existing = await store.getFounder()
          if (existing) {
            return backfillFounderAvatarFromUser(store, existing, user)
          }

          return store.saveFounder(bootstrapCandidate)
        })().finally(() => {
          bootstrapFounderPromise = null
        })
      }

      return bootstrapFounderPromise
    },
  }
}

async function loadAutomationStore(): Promise<BuildOrgTreeDependencies['automationStore']> {
  const modulePath = `../automations/${'store.js'}`
  try {
    const module = await import(modulePath)
    const AutomationStore = module.AutomationStore as (new () => BuildOrgTreeDependencies['automationStore']) | undefined
    return AutomationStore ? new AutomationStore() : createAutomationStoreFallback()
  } catch {
    return createAutomationStoreFallback()
  }
}

export function createOrgRouter(options: OrgRouterOptions = {}): Router {
  const router = Router()
  const commanderDataDir = options.commanderDataDir ?? resolveCommanderDataDir()
  let operatorStore: BuildOrgTreeDependencies['operatorStore']
  let diskBackedOperatorStore: DiskBackedOperatorStore | null = null
  let founderWriteStore: FounderWriteStore | null = null
  if (options.operatorStore) {
    operatorStore = options.operatorStore
    founderWriteStore = typeof (options.operatorStore as Partial<FounderWriteStore>).saveFounder === 'function'
      ? options.operatorStore as FounderWriteStore
      : null
  } else {
    diskBackedOperatorStore = createDiskBackedOperatorStore()
    operatorStore = diskBackedOperatorStore
    founderWriteStore = diskBackedOperatorStore
  }
  const sessionStore = options.sessionStore
    ?? new CommanderSessionStore(resolveCommanderSessionStorePath(commanderDataDir))
  const conversationStore = options.conversationStore ?? new ConversationStore(commanderDataDir)
  const questStore = options.questStore ?? new QuestStore(commanderDataDir)
  const profileStore = options.profileStore ?? createProfileStore(commanderDataDir, sessionStore)
  const orgIdentityStore = options.orgIdentityStore ?? new OrgIdentityStore()
  let automationStorePromise: Promise<BuildOrgTreeDependencies['automationStore']> | null = null
  let gaiaSeedPromise: Promise<void> | null = null

  async function ensureGaiaCommanderSeed(): Promise<CommanderSession[]> {
    const sessions = await sessionStore.list()
    const activeSessions = sessions.filter((session) => session.archived !== true)
    if (activeSessions.length > 0 || typeof sessionStore.create !== 'function') {
      return sessions
    }
    const createSession = sessionStore.create.bind(sessionStore)

    gaiaSeedPromise ??= (async () => {
      const latestSessions = await sessionStore.list()
      if (latestSessions.some((session) => session.archived !== true)) {
        return
      }

      const runtimeConfig = createDefaultCommanderRuntimeConfig()
      const createdAt = new Date().toISOString()
      const session: CommanderSession = {
        id: randomUUID(),
        host: GAIA_HOST,
        state: 'idle',
        created: createdAt,
        agentType: 'claude',
        effort: DEFAULT_CLAUDE_EFFORT_LEVEL,
        heartbeat: createDefaultHeartbeatConfig(),
        maxTurns: runtimeConfig.defaults.maxTurns,
        contextMode: 'thin',
        taskSource: null,
        templateId: GAIA_TEMPLATE_ID,
      }

      const created = await createSession(session)
      const sideEffects = [
        typeof conversationStore.ensureDefaultConversation === 'function'
          ? conversationStore.ensureDefaultConversation({
            commanderId: created.id,
            surface: 'ui',
            createdAt: created.created,
            currentTask: null,
          })
          : Promise.resolve(),
        mergeIdentityOperatingStyleIntoCommanderWorkflow(created.id, GAIA_IDENTITY, { basePath: commanderDataDir }),
        setCommanderDisplayName(commanderDataDir, created.id, GAIA_DISPLAY_NAME),
        writeCommanderUiProfile(created.id, commanderDataDir, ensureCommanderVisualProfile(created.id, {
          avatar: GAIA_COMMANDER_AVATAR_URL,
          speakingTone: GAIA_SPEAKING_TONE,
        })),
      ]
      const results = await Promise.allSettled(sideEffects)
      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[org] Gaia seed side effect failed:', result.reason)
        }
      }
    })().finally(() => {
      gaiaSeedPromise = null
    })

    await gaiaSeedPromise
    return sessionStore.list()
  }

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['org:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.use('/identity', createOrgIdentityRouter({
    store: orgIdentityStore,
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    verifyAuth0Token: options.verifyAuth0Token,
    internalToken: options.internalToken,
  }))

  async function buildFounderSetupStatus(user: AuthUser | undefined): Promise<FounderSetupStatus> {
    const founder = await operatorStore.getFounder()
    const orgIdentity = founder ? await orgIdentityStore.get() : null
    const bootstrapCandidate = founder ? null : createFounderBootstrapCandidate(user)
    const defaultValues = founder
      ? {
          orgDisplayName: orgIdentity?.name ?? '',
          founderDisplayName: founder.displayName,
          founderEmail: founder.email ?? '',
        }
      : {
          ...DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES,
          founderDisplayName: bootstrapCandidate?.displayName ?? '',
          founderEmail: bootstrapCandidate?.email ?? '',
        }

    return {
      setupComplete: Boolean(founder),
      defaultValues,
      validationErrors: validateFounderOrgSetupFormValues(defaultValues),
      nextRoute: founder ? FOUNDER_SETUP_COMPLETED_PATH : FOUNDER_SETUP_PATH,
    }
  }

  async function getActiveConversationId(commanderId: string): Promise<string | null> {
    try {
      if (typeof conversationStore.getActiveChatForCommander === 'function') {
        const activeConversation = await conversationStore.getActiveChatForCommander(commanderId)
        return activeConversation?.id ?? null
      }

      const conversations = await conversationStore.listByCommander(commanderId)
      const activeConversation = conversations
        .filter((conversation) => (
          conversation.id
          && (conversation.status === 'active' || conversation.status === 'idle')
          && (conversation.surface === undefined || ['ui', 'cli', 'api'].includes(conversation.surface))
        ))
        .sort((left, right) => {
          if (left.status !== right.status) {
            return left.status === 'active' ? -1 : 1
          }
          const createdDelta = Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? '')
          return Number.isFinite(createdDelta) && createdDelta !== 0
            ? createdDelta
            : String(left.id).localeCompare(String(right.id))
        })[0]
      return activeConversation?.id ?? null
    } catch {
      return null
    }
  }

  router.get('/setup-status', requireReadAccess, async (req, res) => {
    res.json(await buildFounderSetupStatus(req.user))
  })

  router.get('/commanders/:id/check-on-target', requireReadAccess, async (req, res) => {
    const commanderId = parseCommanderId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const sessions = await sessionStore.list()
    if (!sessions.some((session) => session.id === commanderId)) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const conversationId = await getActiveConversationId(commanderId)
    res.json({
      target: buildCommandRoomLaunchTarget({
        commanderId,
        conversationId,
      }),
    })
  })

  router.post('/', requireWriteAccess, async (req, res) => {
    if (!founderWriteStore) {
      res.status(500).json({ error: 'Founder setup is not available for this org router' })
      return
    }

    let payload: FounderOrgSetupRequest
    try {
      payload = parseFounderOrgSetupRequest(req.body)
    } catch (error) {
      if (error instanceof OrgSetupValidationError) {
        res.status(400).json({ error: error.message })
        return
      }
      throw error
    }

    const existingFounder = await founderWriteStore.getFounder()
    const bootstrapCandidate = createFounderBootstrapCandidate(req.user)
    const founderId = existingFounder?.id
      ?? bootstrapCandidate?.id
      ?? buildFounderIdFromEmail(payload.founder.email)
    const founderAvatarUrl = resolveFounderAvatarSrc(existingFounder, null)
      ?? resolveFounderAvatarSrc(bootstrapCandidate, null)
    const founderCreatedAt = existingFounder?.createdAt
      ?? bootstrapCandidate?.createdAt
      ?? new Date().toISOString()

    const [operator, orgIdentity] = await Promise.all([
      founderWriteStore.saveFounder({
        id: founderId,
        kind: 'founder',
        displayName: payload.founder.displayName,
        email: payload.founder.email,
        avatarUrl: founderAvatarUrl,
        createdAt: founderCreatedAt,
      }),
      orgIdentityStore.updateName(payload.displayName),
    ])

    const response: FounderOrgSetupResponse = {
      operator,
      orgIdentity,
      nextRoute: FOUNDER_SETUP_COMPLETED_PATH,
    }

    res.status(existingFounder ? 200 : 201).json(response)
  })

  router.get('/', requireReadAccess, async (req, res) => {
    const founder = diskBackedOperatorStore
      ? await diskBackedOperatorStore.getFounderForUser(req.user)
      : await operatorStore.getFounder()
    if (!founder) {
      res.status(404).json({ error: FOUNDER_OPERATOR_NOT_FOUND_ERROR })
      return
    }

    automationStorePromise ??= options.automationStore
      ? Promise.resolve(options.automationStore)
      : loadAutomationStore()
    const automationStore = await automationStorePromise
    const includeArchived = req.query.includeArchived === 'true'
    const sessions = await ensureGaiaCommanderSeed()
    const archivedCommandersCount = sessions.filter((session) => session.archived === true).length

    const [orgIdentity, orgTree] = await Promise.all([
      orgIdentityStore.get(),
      buildOrgTree({
        operatorStore: {
          async getFounder() {
            return founder
          },
        },
        commanderSessionStore: createCommanderOrgStore({
          async list() {
            return sessions
          },
        }, commanderDataDir, founder.id, { includeArchived }),
        automationStore,
        conversationStore,
        questStore,
        profileStore,
      }),
    ])

    res.json({
      ...orgTree,
      orgIdentity,
      archivedCommandersCount,
    })
  })

  return router
}

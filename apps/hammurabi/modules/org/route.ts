import { readFile } from 'node:fs/promises'
import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import {
  readCommanderUiProfile,
  resolveCommanderAvatarPath,
} from '../commanders/commander-profile.js'
import { ConversationStore } from '../commanders/conversation-store.js'
import {
  resolveCommanderDataDir,
  resolveCommanderNamesPath,
  resolveCommanderSessionStorePath,
} from '../commanders/paths.js'
import { QuestStore } from '../commanders/quest-store.js'
import { CommanderSessionStore, type CommanderSession } from '../commanders/store.js'
import { defaultOperatorStorePath, OperatorStore } from '../operators/store.js'
import type { Operator } from '../operators/types.js'
import { createFounderBootstrapCandidate } from '../operators/founder-bootstrap.js'
import { createOrgIdentityRouter } from '../org-identity/route.js'
import { OrgIdentityStore } from '../org-identity/store.js'
import type { OrgCommanderRoleKey } from './types.js'
import { buildOrgTree, type BuildOrgTreeDependencies, type OrgCommanderRecord } from './aggregator.js'

export interface OrgRouterOptions {
  operatorStore?: BuildOrgTreeDependencies['operatorStore']
  sessionStore?: Pick<CommanderSessionStore, 'list'>
  automationStore?: BuildOrgTreeDependencies['automationStore']
  conversationStore?: BuildOrgTreeDependencies['conversationStore']
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
  roleKey?: OrgCommanderRoleKey
  templateId?: string | null
  replicatedFromCommanderId?: string | null
  activeWorkers?: number
  archived?: boolean
  archivedAt?: string
}

type DiskBackedOperatorStore = BuildOrgTreeDependencies['operatorStore'] & {
  getFounderForUser(user: AuthUser | undefined): Promise<Operator | null>
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
          roleKey: future.roleKey,
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

function createProfileStore(commanderDataDir: string): BuildOrgTreeDependencies['profileStore'] {
  return {
    async getAvatarUrl(commanderId: string): Promise<string | null> {
      const profile = await readCommanderUiProfile(commanderId, commanderDataDir)
      const avatarPath = await resolveCommanderAvatarPath(commanderId, commanderDataDir, profile)
      return avatarPath ? `/api/commanders/${encodeURIComponent(commanderId)}/avatar` : null
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

function createDiskBackedOperatorStore(): DiskBackedOperatorStore {
  const filePath = defaultOperatorStorePath()
  const store = new OperatorStore(filePath)
  let bootstrapFounderPromise: Promise<Operator | null> | null = null

  return {
    async getFounder() {
      return store.getFounder()
    },
    async getFounderForUser(user) {
      const founder = await store.getFounder()
      if (founder) {
        return founder
      }

      const bootstrapCandidate = createFounderBootstrapCandidate(user)
      if (!bootstrapCandidate) {
        return null
      }

      if (!bootstrapFounderPromise) {
        bootstrapFounderPromise = (async () => {
          const existing = await store.getFounder()
          if (existing) {
            return existing
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
  if (options.operatorStore) {
    operatorStore = options.operatorStore
  } else {
    diskBackedOperatorStore = createDiskBackedOperatorStore()
    operatorStore = diskBackedOperatorStore
  }
  const sessionStore = options.sessionStore
    ?? new CommanderSessionStore(resolveCommanderSessionStorePath(commanderDataDir))
  const conversationStore = options.conversationStore ?? new ConversationStore(commanderDataDir)
  const questStore = options.questStore ?? new QuestStore(commanderDataDir)
  const profileStore = options.profileStore ?? createProfileStore(commanderDataDir)
  const orgIdentityStore = options.orgIdentityStore ?? new OrgIdentityStore()
  let automationStorePromise: Promise<BuildOrgTreeDependencies['automationStore']> | null = null

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:read'],
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

  router.get('/', requireReadAccess, async (req, res) => {
    const founder = diskBackedOperatorStore
      ? await diskBackedOperatorStore.getFounderForUser(req.user)
      : await operatorStore.getFounder()
    if (!founder) {
      res.status(404).json({ error: 'Founder operator not found' })
      return
    }

    automationStorePromise ??= options.automationStore
      ? Promise.resolve(options.automationStore)
      : loadAutomationStore()
    const automationStore = await automationStorePromise
    const includeArchived = req.query.includeArchived === 'true'
    const sessions = await sessionStore.list()
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

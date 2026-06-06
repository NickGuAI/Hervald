import type { AuthUser } from '@gehirn/auth-providers'
import { Router, type Request } from 'express'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import type { ProviderRegistryCapability } from '../../server/module-runtime-capabilities.js'
import type { AutomationScheduler } from '../automations/scheduler.js'
import type { AutomationStore } from '../automations/store.js'
import type { ConversationStore } from '../commanders/conversation-store.js'
import type { CommanderSessionStore } from '../commanders/store.js'
import type { OperatorStore } from '../operators/store.js'
import { OrgIdentityStore } from '../org-identity/store.js'
import {
  buildOnboardingStatus,
  seedGaiaCommander,
  seedStarterWorkforce,
  skipStarterWorkforce,
  type OnboardingShellRunner,
} from './status.js'

export interface OnboardingRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  operatorStore: Pick<OperatorStore, 'getFounder'>
  orgIdentityStore?: OrgIdentityStore
  sessionStore: Pick<CommanderSessionStore, 'list' | 'create' | 'delete'>
  conversationStore?: Pick<ConversationStore, 'listByCommander' | 'getActiveChatForCommander' | 'ensureDefaultConversation' | 'delete'>
  automationStore?: Pick<AutomationStore, 'create' | 'delete'>
  automationScheduler?: Pick<AutomationScheduler, 'createAutomation' | 'deleteAutomation'>
  automationSchedulerInitialized?: Promise<void>
  commanderDataDir: string
  providerRegistry: ProviderRegistryCapability
  shellRunner?: OnboardingShellRunner
  env?: NodeJS.ProcessEnv
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const first = raw?.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}

function normalizeConfiguredBaseUrl(value: string | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }

  try {
    return new URL(normalized).origin
  } catch {
    return null
  }
}

function resolvePublicBaseUrl(req: Request, env: NodeJS.ProcessEnv | undefined): string {
  const runtimeEnv = env ?? process.env
  const configured = normalizeConfiguredBaseUrl(runtimeEnv.HAMMURABI_PUBLIC_BASE_URL)
  if (configured) {
    return configured
  }

  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto'])
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host'])
  const host = forwardedHost ?? firstHeaderValue(req.headers.host) ?? 'localhost:20001'
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : req.protocol || 'http'

  return `${protocol}://${host}`
}

export function createOnboardingRouter(options: OnboardingRouterOptions): Router {
  const router = Router()
  const orgIdentityStore = options.orgIdentityStore ?? new OrgIdentityStore()

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:read'],
    requiredAuth0Permissions: ['commanders:read', 'org:read'],
    auth0PermissionMode: 'any',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:write'],
    requiredAuth0Permissions: ['commanders:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  async function status(req: Request) {
    return buildOnboardingStatus({
      user: req.user,
      operatorStore: options.operatorStore,
      orgIdentityStore,
      sessionStore: options.sessionStore,
      conversationStore: options.conversationStore,
      commanderDataDir: options.commanderDataDir,
      publicBaseUrl: resolvePublicBaseUrl(req, options.env),
      providers: options.providerRegistry.listProviders(),
      env: options.env,
      shellRunner: options.shellRunner,
    })
  }

  router.get('/status', requireReadAccess, async (req, res) => {
    res.json(await status(req))
  })

  router.post('/actions/seed-gaia', requireWriteAccess, async (req, res) => {
    const before = await status(req)
    const gaia = await seedGaiaCommander({
      user: req.user,
      operatorStore: options.operatorStore,
      orgIdentityStore,
      sessionStore: options.sessionStore,
      conversationStore: options.conversationStore,
      commanderDataDir: options.commanderDataDir,
      providers: options.providerRegistry.listProviders(),
      env: options.env,
      shellRunner: options.shellRunner,
    })
    res.status(before.gaia.exists ? 200 : 201).json({
      gaia,
      status: await status(req),
    })
  })

  router.post('/actions/seed-starter-workforce', requireWriteAccess, async (req, res) => {
    const before = await status(req)
    const installedBefore = before.starterWorkforce.totalCount > 0 &&
      before.starterWorkforce.installedCount === before.starterWorkforce.totalCount
    const starterWorkforce = await seedStarterWorkforce({
      user: req.user,
      operatorStore: options.operatorStore,
      orgIdentityStore,
      sessionStore: options.sessionStore,
      conversationStore: options.conversationStore,
      automationStore: options.automationStore,
      automationScheduler: options.automationScheduler,
      automationSchedulerInitialized: options.automationSchedulerInitialized,
      commanderDataDir: options.commanderDataDir,
      providers: options.providerRegistry.listProviders(),
      env: options.env,
      shellRunner: options.shellRunner,
    })
    res.status(installedBefore ? 200 : 201).json({
      starterWorkforce,
      status: await status(req),
    })
  })

  router.post('/actions/skip-starter-workforce', requireWriteAccess, async (req, res) => {
    const starterWorkforce = await skipStarterWorkforce({
      user: req.user,
      operatorStore: options.operatorStore,
      orgIdentityStore,
      sessionStore: options.sessionStore,
      conversationStore: options.conversationStore,
      commanderDataDir: options.commanderDataDir,
      providers: options.providerRegistry.listProviders(),
      env: options.env,
      shellRunner: options.shellRunner,
    })
    res.json({
      starterWorkforce,
      status: await status(req),
    })
  })

  router.post('/actions/finish', requireWriteAccess, async (req, res) => {
    const current = await status(req)
    res.json({
      launchTarget: current.launchTarget,
      status: current,
    })
  })

  return router
}

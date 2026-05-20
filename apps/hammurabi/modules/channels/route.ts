import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { parseSessionId } from '../commanders/route-parsers.js'
import { CommanderSessionStore } from '../commanders/store.js'
import { CommanderSecretsStore } from '../commanders/secrets-store.js'
import { listChannelProviderDescriptors } from './descriptors.js'
import {
  prepareEmailChannelConfigForStorage,
  stripEmailCredentialInputs,
} from './email/config.js'
import {
  prepareWhatsAppChannelConfigForStorage,
} from './whatsapp/config.js'
import {
  prepareGoogleChatChannelConfigForStorage,
} from './googlechat/config.js'
import { isGoogleChatChannelAdapter } from './googlechat/adapter.js'
import { getChannelAdapter } from './registry.js'
import {
  CommanderChannelBindingConflictError,
  CommanderChannelBindingStore,
  CommanderChannelValidationError,
} from './store.js'
import type { CommanderChannelBinding, CommanderChannelBindingConfig } from './types.js'
import { validateChannelConfigForDescriptor } from './validation.js'

export interface CommanderChannelsRouterOptions {
  store?: CommanderChannelBindingStore
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  sessionStore?: Pick<CommanderSessionStore, 'get'>
  secretsStore?: CommanderSecretsStore
  dataDir?: string
  onBindingCreated?: (binding: CommanderChannelBinding) => Promise<void> | void
  onBindingUpdated?: (binding: CommanderChannelBinding) => Promise<void> | void
  onBindingDeleted?: (binding: CommanderChannelBinding) => Promise<void> | void
}

function parseId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

export function createCommanderChannelsRouter(options: CommanderChannelsRouterOptions = {}): Router {
  const router = Router()
  const store = options.store ?? new CommanderChannelBindingStore()
  const sessionStore = options.sessionStore ?? new CommanderSessionStore()
  const secretsStore = options.secretsStore ?? new CommanderSecretsStore()
  const dataDir = options.dataDir
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
    requiredApiKeyScopes: ['commanders:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.post('/channels/googlechat/events', async (req, res) => {
    const adapter = getChannelAdapter('googlechat')
    if (!isGoogleChatChannelAdapter(adapter)) {
      res.status(503).json({ error: 'Google Chat channel adapter is not registered' })
      return
    }

    const result = await adapter.handleInteractionEvent({
      authorization: req.header('authorization') ?? undefined,
      body: req.body,
      accountId: parseId(req.query.accountId) ?? undefined,
      commanderId: parseId(req.query.commanderId) ?? undefined,
    })
    res.status(result.status).json(result.body)
  })

  router.get('/channels/providers', requireReadAccess, async (_req, res) => {
    res.json({ providers: listChannelProviderDescriptors() })
  })

  router.get('/:id/channels/providers', requireReadAccess, async (req, res) => {
    const commanderId = parseId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    res.json({
      providers: listChannelProviderDescriptors({
        commanderId,
        bindings: await store.listByCommander(commanderId),
      }),
    })
  })

  router.get('/:id/channels', requireReadAccess, async (req, res) => {
    const commanderId = parseId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    res.json(await store.listByCommander(commanderId))
  })

  router.post('/:id/channels', requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'commanderId')) {
      res.status(400).json({ error: 'commanderId is read from the URL path and must not be provided in the body' })
      return
    }

    try {
      const accountId = req.body?.accountId
      const provider = req.body?.provider
      const duplicate = await store.getByCommanderProviderAccount({
        commanderId,
        provider,
        accountId,
      })
      if (duplicate) {
        throw new CommanderChannelBindingConflictError(
          `Channel binding already exists for ${duplicate.commanderId}/${duplicate.provider}/${duplicate.accountId}`,
        )
      }
      const preparedConfig = await prepareChannelConfigForStorage({
        commanderId,
        provider,
        accountId,
        incomingConfig: req.body?.config,
        secretsStore,
        dataDir,
        deferCredentialWrite: true,
      })
      const created = await store.create({
        commanderId,
        provider,
        accountId,
        displayName: req.body?.displayName,
        enabled: req.body?.enabled,
        config: preparedConfig.config,
      })
      try {
        await preparedConfig.commitCredential?.()
      } catch (error) {
        await store.delete(commanderId, created.id).catch(() => undefined)
        throw error
      }
      await options.onBindingCreated?.(created)
      res.status(201).json(created)
    } catch (error) {
      if (error instanceof CommanderChannelValidationError) {
        res.status(400).json({ error: error.message })
        return
      }
      if (error instanceof CommanderChannelBindingConflictError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  })

  router.post('/:id/channels/pairing', requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const provider = parseId(req.body?.provider) ?? 'whatsapp'
    const adapter = getChannelAdapter(provider)
    if (!adapter) {
      res.status(404).json({ error: `No channel adapter registered for provider "${provider}"` })
      return
    }

    try {
      validateChannelConfigForDescriptor({
        provider,
        incomingConfig: req.body?.config ?? {},
      })
      const challenge = await adapter.beginPairing({
        provider,
        commanderId,
        accountId: parseId(req.body?.accountId) ?? undefined,
        displayName: parseId(req.body?.displayName) ?? undefined,
        config: req.body?.config,
        metadata: req.body?.metadata,
      })
      res.status(201).json(challenge)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to begin channel pairing' })
    }
  })

  router.get('/:id/channels/pairing/:challengeId/status', requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    const challengeId = parseId(req.params.challengeId)
    if (!commanderId || !challengeId) {
      res.status(400).json({ error: 'Invalid pairing challenge id' })
      return
    }

    const session = await sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const provider = parseId(req.query.provider) ?? 'whatsapp'
    const adapter = getChannelAdapter(provider)
    if (!adapter) {
      res.status(404).json({ error: `No channel adapter registered for provider "${provider}"` })
      return
    }
    if (!adapter.getPairingStatus) {
      res.status(404).json({ error: `No pairing status registered for provider "${provider}"` })
      return
    }

    try {
      const status = await adapter.getPairingStatus({
        provider,
        commanderId,
        id: challengeId,
        accountId: parseId(req.query.accountId) ?? undefined,
      })
      res.status(200).json(status)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to get channel pairing status' })
    }
  })

  router.post('/:id/channels/pairing/:challengeId/complete', requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    const challengeId = parseId(req.params.challengeId)
    if (!commanderId || !challengeId) {
      res.status(400).json({ error: 'Invalid pairing challenge id' })
      return
    }

    const session = await sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const provider = parseId(req.body?.provider) ?? 'whatsapp'
    const adapter = getChannelAdapter(provider)
    if (!adapter) {
      res.status(404).json({ error: `No channel adapter registered for provider "${provider}"` })
      return
    }

    try {
      validateChannelConfigForDescriptor({
        provider,
        incomingConfig: req.body?.config ?? {},
      })
      const binding = await adapter.completePairing(
        {
          provider,
          commanderId,
          id: challengeId,
          accountId: parseId(req.body?.accountId) ?? undefined,
        },
        {
          provider,
          challengeId,
          accountId: parseId(req.body?.accountId) ?? undefined,
          displayName: parseId(req.body?.displayName) ?? undefined,
          config: req.body?.config,
          metadata: req.body?.metadata,
        },
      )
      await options.onBindingCreated?.(binding)
      res.status(201).json(binding)
    } catch (error) {
      if (error instanceof CommanderChannelBindingConflictError) {
        res.status(409).json({ error: error.message })
        return
      }
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to complete channel pairing' })
    }
  })

  router.get('/:id/channels/:bindingId/status', requireReadAccess, async (req, res) => {
    const commanderId = parseId(req.params.id)
    const bindingId = parseId(req.params.bindingId)
    if (!commanderId || !bindingId) {
      res.status(400).json({ error: 'Invalid channel binding id' })
      return
    }

    const binding = (await store.listByCommander(commanderId))
      .find((candidate) => candidate.id === bindingId)
    if (!binding) {
      res.status(404).json({ error: `Channel binding "${bindingId}" not found` })
      return
    }

    const adapter = getChannelAdapter(binding.provider)
    if (!adapter?.getStatus) {
      res.json({
        provider: binding.provider,
        accountId: binding.accountId,
        state: binding.enabled ? 'unknown' : 'stopped',
        connected: false,
      })
      return
    }

    res.json(await adapter.getStatus(binding))
  })

  router.patch('/:id/channels/:bindingId', requireWriteAccess, async (req, res) => {
    const commanderId = parseId(req.params.id)
    const bindingId = parseId(req.params.bindingId)
    if (!commanderId || !bindingId) {
      res.status(400).json({ error: 'Invalid channel binding id' })
      return
    }

    try {
      const existing = (await store.listByCommander(commanderId))
        .find((binding) => binding.id === bindingId)
      if (!existing) {
        res.status(404).json({ error: `Channel binding "${bindingId}" not found` })
        return
      }
      const preparedConfig = req.body?.config === undefined
        ? undefined
        : await prepareChannelConfigForStorage({
            commanderId,
            provider: existing.provider,
            accountId: existing.accountId,
            incomingConfig: req.body?.config,
            existingConfig: existing.config,
            secretsStore,
            dataDir,
            deferCredentialWrite: true,
          })
      const updated = await store.update(commanderId, bindingId, {
        displayName: req.body?.displayName,
        enabled: req.body?.enabled,
        ...(preparedConfig !== undefined ? { config: preparedConfig.config } : {}),
      })
      if (!updated) {
        res.status(404).json({ error: `Channel binding "${bindingId}" not found` })
        return
      }
      try {
        await preparedConfig?.commitCredential?.()
      } catch (error) {
        await store.update(commanderId, bindingId, {
          displayName: existing.displayName,
          enabled: existing.enabled,
          config: existing.config,
        }).catch(() => undefined)
        throw error
      }
      await options.onBindingUpdated?.(updated)
      res.json(updated)
    } catch (error) {
      if (error instanceof CommanderChannelValidationError) {
        res.status(400).json({ error: error.message })
        return
      }
      throw error
    }
  })

  router.delete('/:id/channels/:bindingId', requireWriteAccess, async (req, res) => {
    const commanderId = parseId(req.params.id)
    const bindingId = parseId(req.params.bindingId)
    if (!commanderId || !bindingId) {
      res.status(400).json({ error: 'Invalid channel binding id' })
      return
    }

    const existing = (await store.listByCommander(commanderId))
      .find((binding) => binding.id === bindingId) ?? null
    const deleted = await store.delete(commanderId, bindingId)
    if (!deleted) {
      res.status(404).json({ error: `Channel binding "${bindingId}" not found` })
      return
    }

    if (existing) {
      await options.onBindingDeleted?.(existing)
    }
    res.status(204).send()
  })

  return router
}

async function prepareChannelConfigForStorage(input: {
  commanderId: string
  provider: unknown
  accountId: unknown
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  dataDir?: string
  deferCredentialWrite?: boolean
}): Promise<{
  config: CommanderChannelBindingConfig
  commitCredential?: () => Promise<void>
}> {
  const provider = typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : ''
  const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : ''
  validateChannelConfigForDescriptor({
    provider,
    incomingConfig: input.incomingConfig ?? {},
    existingConfig: input.existingConfig,
  })
  if (provider !== 'email') {
    if (provider === 'whatsapp') {
      const prepared = await prepareWhatsAppChannelConfigForStorage({
        commanderId: input.commanderId,
        accountId,
        incomingConfig: input.incomingConfig,
        existingConfig: input.existingConfig,
        secretsStore: input.secretsStore,
        dataDir: input.dataDir,
        deferCredentialWrite: input.deferCredentialWrite,
      })
      return {
        config: prepared.config,
        ...(prepared.commitCredential ? { commitCredential: prepared.commitCredential } : {}),
      }
    }
    if (provider === 'googlechat') {
      const prepared = await prepareGoogleChatChannelConfigForStorage({
        commanderId: input.commanderId,
        accountId,
        incomingConfig: input.incomingConfig,
        existingConfig: input.existingConfig,
        secretsStore: input.secretsStore,
        deferCredentialWrite: input.deferCredentialWrite,
      })
      return {
        config: prepared.config,
        ...(prepared.commitCredential ? { commitCredential: prepared.commitCredential } : {}),
      }
    }
    return {
      config: stripEmailCredentialInputs(
        input.incomingConfig && typeof input.incomingConfig === 'object'
          ? input.incomingConfig as CommanderChannelBindingConfig
          : {},
      ),
    }
  }

  const prepared = await prepareEmailChannelConfigForStorage({
    commanderId: input.commanderId,
    accountId,
    incomingConfig: input.incomingConfig,
    existingConfig: input.existingConfig,
    secretsStore: input.secretsStore,
    deferCredentialWrite: input.deferCredentialWrite,
  })
  return {
    config: prepared.config,
    ...(prepared.commitCredential ? { commitCredential: prepared.commitCredential } : {}),
  }
}

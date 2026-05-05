import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { parseSessionId } from '../commanders/route-parsers.js'
import { CommanderSessionStore } from '../commanders/store.js'
import {
  CommanderChannelBindingStore,
  CommanderChannelValidationError,
} from './store.js'

export interface CommanderChannelsRouterOptions {
  store?: CommanderChannelBindingStore
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  sessionStore?: Pick<CommanderSessionStore, 'get'>
}

function parseId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

export function createCommanderChannelsRouter(options: CommanderChannelsRouterOptions = {}): Router {
  const router = Router()
  const store = options.store ?? new CommanderChannelBindingStore()
  const sessionStore = options.sessionStore ?? new CommanderSessionStore()
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

    try {
      const created = await store.create({
        commanderId,
        provider: req.body?.provider,
        accountId: req.body?.accountId,
        displayName: req.body?.displayName,
        enabled: req.body?.enabled,
        config: req.body?.config,
      })
      res.status(201).json(created)
    } catch (error) {
      if (error instanceof CommanderChannelValidationError) {
        res.status(400).json({ error: error.message })
        return
      }
      throw error
    }
  })

  router.patch('/:id/channels/:bindingId', requireWriteAccess, async (req, res) => {
    const commanderId = parseId(req.params.id)
    const bindingId = parseId(req.params.bindingId)
    if (!commanderId || !bindingId) {
      res.status(400).json({ error: 'Invalid channel binding id' })
      return
    }

    try {
      const updated = await store.update(commanderId, bindingId, {
        displayName: req.body?.displayName,
        enabled: req.body?.enabled,
        config: req.body?.config,
      })
      if (!updated) {
        res.status(404).json({ error: `Channel binding "${bindingId}" not found` })
        return
      }
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

    const deleted = await store.delete(commanderId, bindingId)
    if (!deleted) {
      res.status(404).json({ error: `Channel binding "${bindingId}" not found` })
      return
    }

    res.status(204).send()
  })

  return router
}

import { Router } from 'express'
import {
  API_KEY_SCOPES,
  ApiKeyJsonStore,
  isApiKeyScope,
  type ApiKeyScope,
} from '../api-keys/store.js'
import {
  OpenAITranscriptionKeyStore,
  type OpenAITranscriptionKeyStoreLike,
} from '../api-keys/transcription-store.js'
import { combinedAuth } from '../middleware/combined-auth.js'
import { type Auth0Options } from '../middleware/auth0.js'

interface ApiKeyView {
  id: string
  name: string
  prefix: string
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
  scopes: string[]
}

interface ApiKeysRouterOptions extends Auth0Options {
  store?: ApiKeyJsonStore
  transcriptionKeyStore?: OpenAITranscriptionKeyStoreLike
  now?: () => Date
}

function toApiKeyView(record: Awaited<ReturnType<ApiKeyJsonStore['listKeys']>>[number]): ApiKeyView {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    scopes: record.scopes,
  }
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }

  return normalized
}

function parseScopes(value: unknown): ApiKeyScope[] | null {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null
  }

  if (!value.every(isApiKeyScope)) {
    return null
  }

  return value
}

function parseOpenAIApiKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }

  return normalized
}

export function createApiKeysRouter(options: ApiKeysRouterOptions = {}): Router {
  const router = Router()
  const store = options.store ?? new ApiKeyJsonStore()
  const transcriptionKeyStore =
    options.transcriptionKeyStore ?? new OpenAITranscriptionKeyStore()
  const now = options.now ?? (() => new Date())

  // Per-route auth: master-API-key management requires `agents:admin` (the
  // elevated tier); operator-level transcription config requires the same
  // `services:read` / `services:write` scopes that sibling service routes use.
  // Both tiers accept Auth0 JWTs and Hammurabi API keys symmetrically via
  // combinedAuth — replacing the old auth0Middleware-only global gate that
  // forced every external caller through the API_KEY_SCOPES union and 403'd
  // bootstrap admins missing `agents:admin`. See issue/1221.
  const masterKeyAuth = combinedAuth({
    ...options,
    apiKeyStore: store,
    requiredApiKeyScopes: ['agents:admin'],
  })
  const transcriptionReadAuth = combinedAuth({
    ...options,
    apiKeyStore: store,
    requiredApiKeyScopes: ['services:read'],
  })
  const transcriptionWriteAuth = combinedAuth({
    ...options,
    apiKeyStore: store,
    requiredApiKeyScopes: ['services:write'],
  })

  router.post('/keys', masterKeyAuth, async (req, res) => {
    const name = parseName(req.body?.name)
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const scopes = parseScopes(req.body?.scopes)
    if (!scopes) {
      res.status(400).json({
        error: `scopes must be an array containing only: ${API_KEY_SCOPES.join(', ')}`,
      })
      return
    }

    try {
      const created = await store.createKey({
        name,
        scopes,
        createdBy: req.user?.email ?? req.user?.id ?? 'unknown',
        now: now(),
      })

      res.status(201).json({
        ...toApiKeyView(created.record),
        key: created.key,
      })
    } catch {
      res.status(500).json({ error: 'Failed to create API key' })
    }
  })

  router.get('/keys', masterKeyAuth, async (_req, res) => {
    try {
      const keys = await store.listKeys()
      res.json(keys.map((record) => toApiKeyView(record)))
    } catch {
      res.status(500).json({ error: 'Failed to list API keys' })
    }
  })

  router.delete('/keys/:id', masterKeyAuth, async (req, res) => {
    const id = parseName(req.params.id)
    if (!id) {
      res.status(400).json({ error: 'Invalid key id' })
      return
    }

    try {
      const deleted = await store.revokeKey(id)
      if (!deleted) {
        res.status(404).json({ error: 'API key not found' })
        return
      }

      res.status(204).send()
    } catch {
      res.status(500).json({ error: 'Failed to revoke API key' })
    }
  })

  router.get('/transcription/openai', transcriptionReadAuth, async (_req, res) => {
    try {
      const status = await transcriptionKeyStore.getStatus()
      res.json(status)
    } catch {
      res.status(500).json({ error: 'Failed to read transcription settings' })
    }
  })

  router.put('/transcription/openai', transcriptionWriteAuth, async (req, res) => {
    const rawKey = parseOpenAIApiKey(req.body?.apiKey)
    if (!rawKey) {
      res.status(400).json({ error: 'apiKey is required' })
      return
    }

    try {
      await transcriptionKeyStore.setOpenAIApiKey(rawKey, { now: now() })
      res.status(204).send()
    } catch {
      res.status(500).json({ error: 'Failed to store transcription settings' })
    }
  })

  router.delete('/transcription/openai', transcriptionWriteAuth, async (_req, res) => {
    try {
      await transcriptionKeyStore.clearOpenAIApiKey()
      res.status(204).send()
    } catch {
      res.status(500).json({ error: 'Failed to clear transcription settings' })
    }
  })

  return router
}

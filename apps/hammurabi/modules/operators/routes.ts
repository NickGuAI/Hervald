import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { resolveHammurabiDataDir } from '../data-dir.js'
import { createFounderBootstrapCandidate } from './founder-bootstrap.js'
import {
  mimeTypeForAvatarFile,
  readOperatorUiProfile,
  resolveOperatorAvatarPath,
  resolveOperatorUiRoot,
  writeOperatorUiProfile,
} from './profile.js'
import { OperatorStore } from './store.js'

export interface OperatorsRouterOptions {
  store?: OperatorStore
  dataDir?: string
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

function parseOperatorId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const normalized = raw.trim()
  return normalized.length > 0 ? normalized : null
}

function parseDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const normalized = raw.trim()
  if (normalized.length === 0 || normalized.length > 120) {
    return null
  }

  return normalized
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ])
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true)
      return
    }

    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'))
  },
})

async function getFounderForUser(
  store: OperatorStore,
  user: AuthUser | undefined,
) {
  const founder = await store.getFounder()
  if (founder) {
    return founder
  }

  const bootstrapCandidate = createFounderBootstrapCandidate(user)
  if (!bootstrapCandidate) {
    return null
  }

  return store.saveFounder(bootstrapCandidate)
}

export function createOperatorsRouter(options: OperatorsRouterOptions = {}): Router {
  const router = Router()
  const store = options.store ?? new OperatorStore()
  const dataDir = path.resolve(options.dataDir ?? resolveHammurabiDataDir())
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

  router.get('/founder/avatar', async (_req, res) => {
    const founder = await store.getFounder()
    if (!founder) {
      res.status(404).json({ error: 'Founder operator not found' })
      return
    }

    const profile = await readOperatorUiProfile(founder.id, dataDir)
    const avatarPath = await resolveOperatorAvatarPath(founder.id, dataDir, profile)
    if (!avatarPath) {
      res.status(404).json({ error: 'Avatar not configured' })
      return
    }

    try {
      const buffer = await readFile(avatarPath)
      res.setHeader('Content-Type', mimeTypeForAvatarFile(avatarPath))
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.send(buffer)
    } catch {
      res.status(404).json({ error: 'Avatar file missing' })
    }
  })

  router.get('/founder', requireReadAccess, async (req, res) => {
    const founder = await getFounderForUser(store, req.user)
    if (!founder) {
      res.status(404).json({ error: 'Founder operator not found' })
      return
    }

    res.json(founder)
  })

  router.patch('/founder/profile', requireWriteAccess, async (req, res) => {
    const founder = await getFounderForUser(store, req.user)
    if (!founder) {
      res.status(404).json({ error: 'Founder operator not found' })
      return
    }

    const displayName = parseDisplayName(req.body?.displayName)
    if (!displayName) {
      res.status(400).json({ error: 'displayName must be a non-empty string up to 120 characters' })
      return
    }

    const updated = await store.saveFounder({
      ...founder,
      displayName,
    })

    res.json(updated)
  })

  router.post('/founder/avatar', requireWriteAccess, avatarUpload.single('avatar'), async (req, res) => {
    const founder = await getFounderForUser(store, req.user)
    if (!founder) {
      res.status(404).json({ error: 'Founder operator not found' })
      return
    }

    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'No avatar file uploaded' })
      return
    }

    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    }
    const ext = extMap[file.mimetype] ?? '.bin'
    const avatarFileName = `avatar${ext}`
    const operatorRoot = resolveOperatorUiRoot(founder.id, dataDir)

    await mkdir(operatorRoot, { recursive: true })
    await writeFile(path.join(operatorRoot, avatarFileName), file.buffer)
    await writeOperatorUiProfile(founder.id, dataDir, { avatar: avatarFileName })

    await store.saveFounder({
      ...founder,
      avatarUrl: '/api/operators/founder/avatar',
    })

    res.json({ avatarUrl: '/api/operators/founder/avatar' })
  })

  router.get('/:id', requireReadAccess, async (req, res) => {
    const operatorId = parseOperatorId(req.params.id)
    if (!operatorId) {
      res.status(400).json({ error: 'Invalid operator id' })
      return
    }

    const operator = await store.getFounderById(operatorId)
    if (!operator) {
      res.status(404).json({ error: `Operator "${operatorId}" not found` })
      return
    }

    res.json(operator)
  })

  return router
}

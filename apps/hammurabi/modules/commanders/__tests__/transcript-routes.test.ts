import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'

const { searchCommanderTranscriptIndexMock } = vi.hoisted(() => ({
  searchCommanderTranscriptIndexMock: vi.fn(),
}))

vi.mock('../transcript-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transcript-index.js')>()
  return {
    ...actual,
    searchCommanderTranscriptIndex: searchCommanderTranscriptIndexMock,
  }
})

import { createCommandersRouter, type CommandersRouterOptions } from '../routes.js'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
}

const tempDirs: string[] = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  const record = {
    id: 'test-key-id',
    name: 'Test Key',
    keyHash: 'hash',
    prefix: 'hmrb_test',
    createdBy: 'test',
    createdAt: '2026-03-11T00:00:00.000Z',
    lastUsedAt: null,
    scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
  } satisfies import('../../../server/api-keys/store.js').ApiKeyRecord

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }
      const requiredScopes = options?.requiredScopes ?? []
      if (!requiredScopes.every((scope) => record.scopes.includes(scope))) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }
      return { ok: true as const, record }
    },
  }
}

async function startServer(
  options: Partial<CommandersRouterOptions> = {},
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
  })
  app.use('/api/commanders', commanders.router)

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    httpServer,
    close: async () => {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createCommander(baseUrl: string, host: string): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/api/commanders`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ host }),
  })
  expect(response.status).toBe(201)
  return await response.json() as { id: string }
}

afterEach(async () => {
  searchCommanderTranscriptIndexMock.mockReset()
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('commander transcript search routes', () => {
  it('returns transcript hits through the API', async () => {
    const dir = await createTempDir('hammurabi-commanders-transcript-search-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')

    searchCommanderTranscriptIndexMock.mockResolvedValue([
      {
        score: 0.9142,
        text: 'Reset rebuilt the commander identity and system prompt from disk.',
        sourceFile: '/tmp/commander/sessions/2026-03-28.jsonl',
        transcriptId: '2026-03-28',
        timestamp: '2026-03-28T11:20:00.000Z',
        role: 'assistant',
        turnNumber: 142,
        messageIndex: 1,
      },
    ])

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      const commander = await createCommander(server.baseUrl, 'transcript-search-route')
      const response = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/transcripts/search`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: 'rotation reset',
          topK: 3,
        }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        hits: [
          {
            score: 0.9142,
            text: 'Reset rebuilt the commander identity and system prompt from disk.',
            sourceFile: '/tmp/commander/sessions/2026-03-28.jsonl',
            transcriptId: '2026-03-28',
            timestamp: '2026-03-28T11:20:00.000Z',
            role: 'assistant',
            turnNumber: 142,
            messageIndex: 1,
          },
        ],
      })
      expect(searchCommanderTranscriptIndexMock).toHaveBeenCalledWith(
        'rotation reset',
        3,
        {
          commanderId: commander.id,
          basePath: memoryBasePath,
        },
      )
    } finally {
      await server.close()
    }
  })

  it('defaults transcript search to the shipped top-k when omitted', async () => {
    const dir = await createTempDir('hammurabi-commanders-transcript-default-topk-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')

    searchCommanderTranscriptIndexMock.mockResolvedValue([])

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      const commander = await createCommander(server.baseUrl, 'transcript-search-default')
      const response = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/transcripts/search`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: 'rotation reset',
        }),
      })

      expect(response.status).toBe(200)
      expect(searchCommanderTranscriptIndexMock).toHaveBeenCalledWith(
        'rotation reset',
        8,
        {
          commanderId: commander.id,
          basePath: memoryBasePath,
        },
      )
    } finally {
      await server.close()
    }
  })

  it('rejects transcript searches without a query', async () => {
    const dir = await createTempDir('hammurabi-commanders-transcript-search-invalid-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      const commander = await createCommander(server.baseUrl, 'transcript-search-invalid')
      const response = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/transcripts/search`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: '   ',
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'query is required' })
      expect(searchCommanderTranscriptIndexMock).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})

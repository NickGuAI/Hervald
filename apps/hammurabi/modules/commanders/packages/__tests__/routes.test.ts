import express from 'express'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AutomationStore } from '../../../automations/store'
import { OperatorStore } from '../../../operators/store'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../../../../server/api-keys/store'
import { ASINA_COMMANDER_AVATAR_URL } from '../../commander-profile'
import { createCommandersRouter } from '../../routes'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []
const previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function apiKeyStore(): ApiKeyStoreLike {
  const record: ApiKeyRecord = {
    id: 'test-key',
    name: 'Test',
    keyHash: 'hash',
    prefix: 'test',
    createdBy: 'test',
    createdAt: '2026-05-20T00:00:00.000Z',
    lastUsedAt: null,
    scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
  }
  return {
    async hasAnyKeys() {
      return true
    },
    async verifyKey(rawKey, options) {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' }
      }
      const requiredScopes = options?.requiredScopes ?? []
      if (!requiredScopes.every((scope) => record.scopes.includes(scope))) {
        return { ok: false, reason: 'insufficient_scope' }
      }
      return { ok: true, record }
    },
  }
}

async function startServer(): Promise<RunningServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-package-routes-'))
  tempDirs.push(dataDir)
  process.env.HAMMURABI_DATA_DIR = dataDir
  const sessionStorePath = join(dataDir, 'commander', 'sessions.json')
  const commanderDataDir = dirname(sessionStorePath)
  await new OperatorStore(join(dataDir, 'operators.json')).saveFounder({
    id: 'founder-test',
    kind: 'founder',
    displayName: 'Founder Test',
    email: 'founder@example.com',
    avatarUrl: null,
    createdAt: '2026-05-20T00:00:00.000Z',
  })
  const automationStore = new AutomationStore({
    dirPath: join(dataDir, 'automations'),
    commanderDataDir,
  })
  const app = express()
  app.use(express.json())
  const commanders = createCommandersRouter({
    apiKeyStore: apiKeyStore(),
    sessionStorePath,
    memoryBasePath: commanderDataDir,
    automationStore,
    now: () => new Date('2026-05-20T00:00:00.000Z'),
  })
  app.use('/api/commanders', commanders.router)
  const server: Server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      commanders.dispose()
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

afterEach(async () => {
  if (previousHammurabiDataDir === undefined) {
    delete process.env.HAMMURABI_DATA_DIR
  } else {
    process.env.HAMMURABI_DATA_DIR = previousHammurabiDataDir
  }
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('commander package routes', () => {
  it('lists bundled packages and installs one idempotently', async () => {
    const server = await startServer()
    try {
      const listBefore = await fetch(`${server.baseUrl}/api/commanders/packages`, {
        headers: AUTH_HEADERS,
      })
      expect(listBefore.status).toBe(200)
      const beforePayload = await listBefore.json() as {
        packages: Array<{
          id: string
          installState: { installed: boolean }
          uiProfile?: { avatar?: string }
          automations: Array<{ id: string; status: string }>
        }>
      }
      expect(beforePayload.packages).toHaveLength(3)
      expect(beforePayload.packages.find((pkg) => pkg.id === 'engineering-manager')?.installState.installed).toBe(false)
      expect(beforePayload.packages.find((pkg) => pkg.id === 'engineering-manager')?.uiProfile?.avatar)
        .toBe(ASINA_COMMANDER_AVATAR_URL)
      expect(beforePayload.packages.find((pkg) => pkg.id === 'engineering-manager')?.automations)
        .toEqual([
          expect.objectContaining({ id: 'issue-triage-sweep', status: 'paused' }),
          expect.objectContaining({ id: 'release-drift-review', status: 'paused' }),
        ])

      const firstInstall = await fetch(`${server.baseUrl}/api/commanders/packages/engineering-manager/install`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(firstInstall.status).toBe(201)
      const firstPayload = await firstInstall.json() as {
        created: boolean
        commander: { id: string; avatarUrl?: string | null; displayName?: string; templateId?: string }
      }
      expect(firstPayload.created).toBe(true)
      expect(firstPayload.commander).toMatchObject({
        avatarUrl: ASINA_COMMANDER_AVATAR_URL,
        displayName: 'Asina',
        templateId: 'engineering-manager',
      })

      const automationsResponse = await fetch(`${server.baseUrl}/api/commanders/${firstPayload.commander.id}/automations`, {
        headers: AUTH_HEADERS,
      })
      expect(automationsResponse.status).toBe(200)
      const automationsPayload = await automationsResponse.json() as Array<{
        templateId?: string
        status?: string
      }>
      expect(automationsPayload.map((automation) => automation.templateId).sort()).toEqual([
        'engineering-manager:issue-triage-sweep',
        'engineering-manager:release-drift-review',
      ])
      expect(automationsPayload.every((automation) => automation.status === 'paused')).toBe(true)

      const profilePath = join(
        tempDirs.at(-1)!,
        'commander',
        firstPayload.commander.id,
        '.memory',
        'profile.json',
      )
      const legacyProfile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, unknown>
      delete legacyProfile.avatar
      await writeFile(profilePath, JSON.stringify(legacyProfile, null, 2), 'utf8')

      const commandersResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      expect(commandersResponse.status).toBe(200)
      const commandersPayload = await commandersResponse.json() as Array<{ id: string; avatarUrl?: string | null }>
      expect(commandersPayload.find((entry) => entry.id === firstPayload.commander.id)?.avatarUrl)
        .toBe(ASINA_COMMANDER_AVATAR_URL)

      const commanderDetail = await fetch(`${server.baseUrl}/api/commanders/${firstPayload.commander.id}`, {
        headers: AUTH_HEADERS,
      })
      expect(commanderDetail.status).toBe(200)
      expect((await commanderDetail.json()) as { avatarUrl?: string | null }).toMatchObject({
        avatarUrl: ASINA_COMMANDER_AVATAR_URL,
      })

      const secondInstall = await fetch(`${server.baseUrl}/api/commanders/packages/engineering-manager/install`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      const secondPayload = await secondInstall.json() as {
        created: boolean
        commander: { id: string }
      }
      expect(secondInstall.status).toBe(200)
      expect(secondPayload.created).toBe(false)
      expect(secondPayload.commander.id).toBe(firstPayload.commander.id)
    } finally {
      await server.close()
    }
  })
})

import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createSettingsRouter } from '../routes'
import { AppSettingsStore } from '../store'
import { DEFAULT_COMPOSER_ABILITIES } from '../composer-abilities'
import { getDefaultComposerSkillSlotSettings } from '../composer-skill-slots'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []

const expectedDefaultComposerAbilities = {
  defaultAbilities: DEFAULT_COMPOSER_ABILITIES.map((ability) => ({ ...ability })),
  customAbilities: [],
  customAbilitiesEnabled: false,
}
const expectedDefaultComposerSkillSlots = getDefaultComposerSkillSlotSettings()

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-05-03T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['commanders:read', 'commanders:write'],
    },
  } satisfies Record<string, import('../../../server/api-keys/store').ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }

      return { ok: true as const, record }
    },
  }
}

async function startServer(store: AppSettingsStore): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  app.use('/api/settings', createSettingsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store,
  }))

  const httpServer: Server = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

describe('settings routes', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  it('returns default backend settings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
      now: () => new Date('2026-05-03T00:00:00.000Z'),
    })
    const server = await startServer(store)

    try {
      const response = await fetch(`${server.baseUrl}/api/settings`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        settings: {
          theme: 'light',
          fontScale: 1,
          composerAbilities: expectedDefaultComposerAbilities,
          composerSkillSlots: expectedDefaultComposerSkillSlots,
          updatedAt: '2026-05-03T00:00:00.000Z',
        },
      })
    } finally {
      await server.close()
    }
  })

  it('returns mobile settings section DTOs in the current order', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
    })
    const server = await startServer(store)

    try {
      const response = await fetch(`${server.baseUrl}/api/settings/mobile`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        sections: [
          {
            id: 'account',
            label: 'Account',
            icon: 'circle-user-round',
            path: '/command-room/settings/account',
            fullPagePath: '/api-keys',
            visible: true,
            surfaces: ['mobile'],
          },
          {
            id: 'telemetry',
            label: 'Telemetry',
            icon: 'radio-tower',
            path: '/command-room/settings/telemetry',
            fullPagePath: '/telemetry',
            visible: true,
            surfaces: ['mobile'],
          },
          {
            id: 'notifications',
            label: 'Notifications',
            icon: 'bell',
            path: '/command-room/settings/notifications',
            fullPagePath: '/policies',
            visible: true,
            surfaces: ['mobile'],
          },
          {
            id: 'machines',
            label: 'Machines',
            icon: 'monitor',
            path: '/command-room/settings/machines',
            visible: true,
            surfaces: ['mobile'],
          },
          {
            id: 'appearance',
            label: 'Appearance',
            icon: 'eye',
            path: '/command-room/settings/appearance',
            visible: true,
            surfaces: ['mobile'],
          },
          {
            id: 'about',
            label: 'About',
            icon: 'info',
            path: '/command-room/settings/about',
            visible: true,
            surfaces: ['mobile'],
          },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('updates and persists the theme in backend settings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
      now: () => new Date('2026-05-03T01:00:00.000Z'),
    })
    const server = await startServer(store)

    try {
      const updateResponse = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ theme: 'dark' }),
      })

      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual({
        settings: {
          theme: 'dark',
          fontScale: 1,
          composerAbilities: expectedDefaultComposerAbilities,
          composerSkillSlots: expectedDefaultComposerSkillSlots,
          updatedAt: '2026-05-03T01:00:00.000Z',
        },
      })

      await expect(store.get()).resolves.toEqual({
        theme: 'dark',
        fontScale: 1,
        composerAbilities: expectedDefaultComposerAbilities,
        composerSkillSlots: expectedDefaultComposerSkillSlots,
        updatedAt: '2026-05-03T01:00:00.000Z',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects invalid theme values', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
    })
    const server = await startServer(store)

    try {
      const response = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ theme: 'system' }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'theme must be "light" or "dark"',
      })
    } finally {
      await server.close()
    }
  })

  it('updates, rounds, and persists font scale in backend settings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
      now: () => new Date('2026-05-03T02:00:00.000Z'),
    })
    const server = await startServer(store)

    try {
      const updateResponse = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ fontScale: 1.24 }),
      })

      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual({
        settings: {
          theme: 'light',
          fontScale: 1.2,
          composerAbilities: expectedDefaultComposerAbilities,
          composerSkillSlots: expectedDefaultComposerSkillSlots,
          updatedAt: '2026-05-03T02:00:00.000Z',
        },
      })

      await expect(store.get()).resolves.toEqual({
        theme: 'light',
        fontScale: 1.2,
        composerAbilities: expectedDefaultComposerAbilities,
        composerSkillSlots: expectedDefaultComposerSkillSlots,
        updatedAt: '2026-05-03T02:00:00.000Z',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects invalid font scale values', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
    })
    const server = await startServer(store)

    try {
      const response = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ fontScale: 1.7 }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'fontScale must be a number between 0.8 and 1.6',
      })
    } finally {
      await server.close()
    }
  })

  it('updates and persists composer ability settings separately from skills', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
      now: () => new Date('2026-05-03T03:00:00.000Z'),
    })
    const server = await startServer(store)

    try {
      const updateResponse = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          composerAbilities: {
            customAbilitiesEnabled: true,
            defaultAbilities: DEFAULT_COMPOSER_ABILITIES.map((ability) => ({
              ...ability,
              enabled: ability.id !== 'think-hard',
            })),
            customAbilities: [{
              id: 'custom-summarize',
              label: 'Summarize',
              prompt: 'Summarize the requested context before answering.',
              enabled: true,
            }],
          },
        }),
      })

      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual({
        settings: {
          theme: 'light',
          fontScale: 1,
          composerAbilities: {
            defaultAbilities: [
              {
                ...DEFAULT_COMPOSER_ABILITIES[0],
                enabled: false,
              },
            ],
            customAbilities: [{
              id: 'custom-summarize',
              label: 'Summarize',
              prompt: 'Summarize the requested context before answering.',
              enabled: true,
            }],
            customAbilitiesEnabled: true,
          },
          composerSkillSlots: expectedDefaultComposerSkillSlots,
          updatedAt: '2026-05-03T03:00:00.000Z',
        },
      })

      await expect(store.get()).resolves.toMatchObject({
        composerAbilities: {
          customAbilitiesEnabled: true,
          customAbilities: [{
            id: 'custom-summarize',
            label: 'Summarize',
            prompt: 'Summarize the requested context before answering.',
            enabled: true,
          }],
        },
      })
    } finally {
      await server.close()
    }
  })

  it('updates and persists composer quick skill slots separately from abilities', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
      now: () => new Date('2026-05-03T04:00:00.000Z'),
    })
    const server = await startServer(store)

    try {
      const updateResponse = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          composerSkillSlots: {
            slots: [{
              id: 'primary',
              skillName: '/create-quests',
            }],
          },
        }),
      })

      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual({
        settings: {
          theme: 'light',
          fontScale: 1,
          composerAbilities: expectedDefaultComposerAbilities,
          composerSkillSlots: {
            slots: [{
              id: 'primary',
              skillName: 'create-quests',
            }],
          },
          updatedAt: '2026-05-03T04:00:00.000Z',
        },
      })

      await expect(store.get()).resolves.toMatchObject({
        composerSkillSlots: {
          slots: [{
            id: 'primary',
            skillName: 'create-quests',
          }],
        },
      })
    } finally {
      await server.close()
    }
  })

  it('rejects malformed composer ability payloads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
    })
    const server = await startServer(store)

    try {
      const response = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          composerAbilities: {
            customAbilitiesEnabled: 'yes',
          },
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'composerAbilities.customAbilitiesEnabled must be a boolean',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects malformed composer quick skill slot payloads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-settings-route-'))
    tempDirs.push(dir)
    const store = new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
    })
    const server = await startServer(store)

    try {
      const response = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          composerSkillSlots: {
            slots: [{
              id: 'primary',
              skillName: '../not-a-skill',
            }],
          },
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'composer skill slot skillName must be a valid skill name',
      })
    } finally {
      await server.close()
    }
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../../../server/api-keys/store'
import { AGENT_SKILLS_DIR_ENV, DIRECT_SKILLS_DIRS_ENV } from '../skill-roots'
import { createSkillsRouter, discoverSkills } from '../routes'

const tempRoots: string[] = []
const originalAgentSkillsDir = process.env[AGENT_SKILLS_DIR_ENV]
const originalDirectSkillsDirs = process.env[DIRECT_SKILLS_DIRS_ENV]

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-skills-route-'))
  tempRoots.push(root)
  return root
}

async function startServer(options: {
  verifyAuth0Token: (token: string) => Promise<AuthUser>
  apiKeyStore?: ApiKeyStoreLike
}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  app.use('/api/skills', createSkillsRouter({
    apiKeyStore: options.apiKeyStore,
    verifyAuth0Token: options.verifyAuth0Token,
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

function makeApiKeyStore(keys: Record<string, readonly string[]>): ApiKeyStoreLike {
  return {
    async hasAnyKeys() {
      return Object.keys(keys).length > 0
    },
    async verifyKey(rawKey, options) {
      const scopes = keys[rawKey]
      if (!scopes) {
        return { ok: false, reason: 'not_found' }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasRequiredScopes = requiredScopes.every((scope) => scopes.includes(scope))
      if (!hasRequiredScopes) {
        return { ok: false, reason: 'insufficient_scope' }
      }

      const record: ApiKeyRecord = {
        id: rawKey,
        name: rawKey,
        keyHash: 'test-hash',
        prefix: rawKey.slice(0, 8),
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
        scopes: [...scopes],
      }

      return { ok: true, record }
    },
  }
}

afterEach(async () => {
  if (originalAgentSkillsDir === undefined) {
    delete process.env[AGENT_SKILLS_DIR_ENV]
  } else {
    process.env[AGENT_SKILLS_DIR_ENV] = originalAgentSkillsDir
  }
  if (originalDirectSkillsDirs === undefined) {
    delete process.env[DIRECT_SKILLS_DIRS_ENV]
  } else {
    process.env[DIRECT_SKILLS_DIRS_ENV] = originalDirectSkillsDirs
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('skills route discovery', () => {
  it('prefers directly installed user skills over bundled package duplicates', async () => {
    const root = await makeTempRoot()
    const directRoot = path.join(root, 'direct-skills')
    const packageRoot = path.join(root, 'agent-skills', 'general-skills')
    await mkdir(path.join(directRoot, 'publish-report'), { recursive: true })
    await mkdir(path.join(packageRoot, 'publish-report'), { recursive: true })
    await writeFile(
      path.join(directRoot, 'publish-report', 'SKILL.md'),
      [
        '---',
        'name: publish-report',
        'description: Direct installed skill',
        'user-invocable: true',
        'argument-hint: <report>',
        '---',
        '',
        '# Publish Report',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(packageRoot, 'publish-report', 'SKILL.md'),
      [
        '---',
        'name: publish-report',
        'description: Bundled package skill',
        '---',
        '',
        '# Publish Report',
      ].join('\n'),
      'utf8',
    )
    process.env[DIRECT_SKILLS_DIRS_ENV] = directRoot
    process.env[AGENT_SKILLS_DIR_ENV] = path.join(root, 'agent-skills')

    const skills = await discoverSkills()
    const skill = skills.find((entry) => entry.dirName === 'publish-report')

    expect(skill).toMatchObject({
      description: 'Direct installed skill',
      source: 'direct-skills',
      userInvocable: true,
      argumentHint: '<report>',
    })
  })

  it('allows commander Auth0 users to load installed skills', async () => {
    const root = await makeTempRoot()
    const directRoot = path.join(root, 'direct-skills')
    await mkdir(path.join(directRoot, 'legion-investigate'), { recursive: true })
    await writeFile(
      path.join(directRoot, 'legion-investigate', 'SKILL.md'),
      [
        '---',
        'name: legion-investigate',
        'description: Investigate a codebase problem',
        'user-invocable: true',
        'argument-hint: <problem>',
        '---',
        '',
        '# Legion Investigate',
      ].join('\n'),
      'utf8',
    )
    process.env[DIRECT_SKILLS_DIRS_ENV] = directRoot
    process.env[AGENT_SKILLS_DIR_ENV] = path.join(root, 'agent-skills')

    const server = await startServer({
      verifyAuth0Token: async (token) => {
        if (token !== 'commander-token') {
          throw new Error('invalid token')
        }

        return {
          id: 'auth0|commander-user',
          email: 'user@example.com',
          metadata: {
            permissions: ['commanders:read'],
          },
        }
      },
    })

    try {
      const response = await fetch(`${server.baseUrl}/api/skills`, {
        headers: {
          authorization: 'Bearer commander-token',
        },
      })

      expect(response.status).toBe(200)
      const skills = await response.json() as Array<Record<string, unknown>>
      expect(skills).toContainEqual(expect.objectContaining({
        dirName: 'legion-investigate',
        description: 'Investigate a codebase problem',
        userInvocable: true,
      }))
    } finally {
      await server.close()
    }
  })

  it('requires skills:read API key scope for discovery', async () => {
    const root = await makeTempRoot()
    const directRoot = path.join(root, 'direct-skills')
    await mkdir(path.join(directRoot, 'wide-research'), { recursive: true })
    await writeFile(
      path.join(directRoot, 'wide-research', 'SKILL.md'),
      [
        '---',
        'name: wide-research',
        'description: Parallel research',
        'user-invocable: true',
        '---',
        '',
        '# Wide Research',
      ].join('\n'),
      'utf8',
    )
    process.env[DIRECT_SKILLS_DIRS_ENV] = directRoot
    process.env[AGENT_SKILLS_DIR_ENV] = path.join(root, 'agent-skills')

    const server = await startServer({
      apiKeyStore: makeApiKeyStore({
        'skills-read-key': ['skills:read'],
        'agents-read-key': ['agents:read'],
        'commander-read-key': ['commanders:read'],
      }),
      verifyAuth0Token: async () => {
        throw new Error('unexpected Auth0 verification')
      },
    })

    try {
      const readResponse = await fetch(`${server.baseUrl}/api/skills`, {
        headers: {
          'x-hammurabi-api-key': 'skills-read-key',
        },
      })
      expect(readResponse.status).toBe(200)
      await expect(readResponse.json()).resolves.toContainEqual(expect.objectContaining({
        dirName: 'wide-research',
      }))

      const commanderScopedResponse = await fetch(`${server.baseUrl}/api/skills`, {
        headers: {
          'x-hammurabi-api-key': 'commander-read-key',
        },
      })
      expect(commanderScopedResponse.status).toBe(403)

      const nonSkillScopedDiscoveryResponse = await fetch(`${server.baseUrl}/api/skills`, {
        headers: {
          'x-hammurabi-api-key': 'agents-read-key',
        },
      })
      expect(nonSkillScopedDiscoveryResponse.status).toBe(403)
    } finally {
      await server.close()
    }
  })

  it('does not expose page-only config or history endpoints', async () => {
    const server = await startServer({
      apiKeyStore: makeApiKeyStore({
        'skills-read-key': ['skills:read'],
      }),
      verifyAuth0Token: async () => {
        throw new Error('unexpected Auth0 verification')
      },
    })

    try {
      const configReadResponse = await fetch(`${server.baseUrl}/api/skills/wide-research/config`, {
        headers: {
          'x-hammurabi-api-key': 'skills-read-key',
        },
      })
      expect(configReadResponse.status).toBe(404)

      const configWriteResponse = await fetch(`${server.baseUrl}/api/skills/wide-research/config`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-api-key': 'skills-read-key',
        },
        body: JSON.stringify({ fields: {} }),
      })
      expect(configWriteResponse.status).toBe(404)

      const historyResponse = await fetch(`${server.baseUrl}/api/skills/wide-research/history`, {
        headers: {
          'x-hammurabi-api-key': 'skills-read-key',
        },
      })
      expect(historyResponse.status).toBe(404)
    } finally {
      await server.close()
    }
  })
})

import { Router } from 'express'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { discoverSkillDirectorySources } from './skill-roots.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInfo {
  name: string
  dirName: string
  description: string
  userInvocable: boolean
  argumentHint?: string
  allowedTools?: string
  /** Source package (e.g. "pkos", "general-skills") */
  source: string
}

export interface SkillsRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): Record<string, string | boolean> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string | boolean> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let val = line.slice(colonIdx + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (val === 'true') {
      result[key] = true
    } else if (val === 'false') {
      result[key] = false
    } else {
      result[key] = val
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Skill discovery — scans installed skill roots and bundled agent-skills packages.
// ---------------------------------------------------------------------------

export async function discoverSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  const seen = new Set<string>()

  const skillSources = await discoverSkillDirectorySources()

  for (const skillSource of skillSources) {
    let skillDirs: string[]
    try {
      const entries = await readdir(skillSource.dir, { withFileTypes: true })
      skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      continue
    }

    for (const dirName of skillDirs) {
      if (seen.has(dirName)) continue
      const skillMd = path.join(skillSource.dir, dirName, 'SKILL.md')
      try {
        const content = await readFile(skillMd, 'utf-8')
        const fm = parseFrontmatter(content)
        const name = typeof fm.name === 'string' ? fm.name : dirName

        seen.add(dirName)
        skills.push({
          name,
          dirName,
          description: typeof fm.description === 'string' ? fm.description : '',
          userInvocable: fm['user-invocable'] === true || fm['user-invocable'] === 'true',
          argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined,
          allowedTools: typeof fm['allowed-tools'] === 'string' ? fm['allowed-tools'] : undefined,
          source: skillSource.source,
        })
      } catch {
        // No valid SKILL.md — skip
      }
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createSkillsRouter(options: SkillsRouterOptions = {}): Router {
  const router = Router()

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['skills:read'],
    requiredAuth0Permissions: ['skills:read', 'commanders:read'],
    auth0PermissionMode: 'any',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  // GET /api/skills — list all installed skills
  router.get('/', requireReadAccess, async (_req, res) => {
    try {
      const skills = await discoverSkills()
      res.json(skills)
    } catch (err) {
      res.status(500).json({ error: 'Failed to discover skills', detail: String(err) })
    }
  })

  return router
}

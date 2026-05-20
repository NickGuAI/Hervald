import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeUiProfile } from '../commander-profile.js'
import {
  DEFAULT_COMMANDER_CONTEXT_MODE,
  type CommanderContextMode,
} from '../store.js'
import type { AgentType } from '../../agents/types.js'
import { DEFAULT_CLAUDE_EFFORT_LEVEL, isClaudeEffortLevel } from '../../claude-effort.js'
import type {
  CommanderPackageDefinition,
  CommanderPackageExample,
  CommanderPackageSkill,
} from './types.js'

interface RawPackageManifest {
  schemaVersion?: unknown
  id?: unknown
  version?: unknown
  displayName?: unknown
  host?: unknown
  role?: unknown
  summary?: unknown
  description?: unknown
  agentType?: unknown
  effort?: unknown
  contextMode?: unknown
  uiProfile?: unknown
}

interface RawSkillsManifest {
  required?: unknown
  optional?: unknown
}

interface RawSkillEntry {
  id?: unknown
  label?: unknown
  purpose?: unknown
}

const bundledPackagesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'bundled',
)

export const STARTER_COMMANDER_PACKAGE_IDS = [
  'engineering-manager',
  'research-intelligence-analyst',
  'general-assistant',
] as const

function requireString(value: unknown, field: string, packageDir: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  throw new Error(`Commander package ${packageDir} is missing string field ${field}`)
}

function parseAgentType(value: unknown): AgentType {
  return typeof value === 'string' && value.trim() ? value.trim() : 'claude'
}

function parseContextMode(value: unknown): CommanderContextMode {
  return value === 'fat' || value === 'thin' ? value : DEFAULT_COMMANDER_CONTEXT_MODE
}

function parseSkillEntry(raw: unknown, required: boolean): CommanderPackageSkill {
  const entry = raw as RawSkillEntry
  return {
    id: requireString(entry.id, 'skills[].id', 'skills.manifest.json'),
    label: requireString(entry.label, 'skills[].label', 'skills.manifest.json'),
    purpose: requireString(entry.purpose, 'skills[].purpose', 'skills.manifest.json'),
    required,
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function readExamples(packageDir: string): Promise<CommanderPackageExample[]> {
  const examplesDir = path.join(packageDir, 'examples')
  const entries = await readdir(examplesDir, { withFileTypes: true }).catch(() => [])
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()

  return Promise.all(markdownFiles.map(async (fileName) => {
    const body = await readFile(path.join(examplesDir, fileName), 'utf8')
    const firstHeading = body.match(/^#\s+(.+)$/mu)?.[1]?.trim()
    return {
      id: fileName.replace(/\.md$/u, ''),
      title: firstHeading ?? fileName.replace(/[-_]/gu, ' ').replace(/\.md$/u, ''),
      body,
    }
  }))
}

export async function loadCommanderPackage(
  packageId: string,
  root: string = bundledPackagesRoot,
): Promise<CommanderPackageDefinition | null> {
  const safeId = packageId.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(safeId)) {
    return null
  }

  const packageDir = path.join(root, safeId)
  try {
    const manifest = await readJson<RawPackageManifest>(path.join(packageDir, 'package.json'))
    const skillsManifest = await readJson<RawSkillsManifest>(path.join(packageDir, 'skills.manifest.json'))
    const required = Array.isArray(skillsManifest.required) ? skillsManifest.required : []
    const optional = Array.isArray(skillsManifest.optional) ? skillsManifest.optional : []
    const uiProfile = sanitizeUiProfile(manifest.uiProfile)

    return {
      schemaVersion: 1,
      id: requireString(manifest.id, 'id', packageDir),
      version: requireString(manifest.version, 'version', packageDir),
      displayName: requireString(manifest.displayName, 'displayName', packageDir),
      host: requireString(manifest.host, 'host', packageDir),
      role: requireString(manifest.role, 'role', packageDir),
      summary: requireString(manifest.summary, 'summary', packageDir),
      description: requireString(manifest.description, 'description', packageDir),
      agentType: parseAgentType(manifest.agentType),
      effort: isClaudeEffortLevel(manifest.effort)
        ? manifest.effort
        : DEFAULT_CLAUDE_EFFORT_LEVEL,
      contextMode: parseContextMode(manifest.contextMode),
      uiProfile: uiProfile ?? {},
      skills: [
        ...required.map((entry) => parseSkillEntry(entry, true)),
        ...optional.map((entry) => parseSkillEntry(entry, false)),
      ],
      examples: await readExamples(packageDir),
      commanderMd: await readFile(path.join(packageDir, 'COMMANDER.md'), 'utf8'),
      onboarding: await readFile(path.join(packageDir, 'onboarding.md'), 'utf8'),
      memorySeed: await readFile(path.join(packageDir, 'memory-seed.md'), 'utf8'),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function listCommanderPackages(
  root: string = bundledPackagesRoot,
): Promise<CommanderPackageDefinition[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadCommanderPackage(entry.name, root)),
  )
  return packages
    .filter((definition): definition is CommanderPackageDefinition => Boolean(definition))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

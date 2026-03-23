import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCommanderPaths } from '../paths.js'

export const COMMANDER_IDENTITY_FILE = 'identity.md'
export const COMMANDER_IDENTITY_TEMPLATE_FILE = 'commander.md.template'

const DEFAULT_PERSONA_TEMPLATE =
  'You are Commander {{host}}, an autonomous orchestration agent for GitHub task execution.'

const DEFAULT_TEMPLATE = `---
id: {{id_yaml}}
host: {{host_yaml}}
persona: {{persona_yaml}}
created: {{created_yaml}}
cwd: {{cwd_yaml}}
---

# Commander Identity

## Persona
{{persona}}

## Hostname
{{host}}

## Metadata
- Commander ID: \`{{id}}\`
- Created: \`{{created}}\`
- Workspace CWD: {{cwd_display}}
`

const TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  COMMANDER_IDENTITY_TEMPLATE_FILE,
)

export interface CommanderIdentityTemplateInput {
  id: string
  host: string
  persona?: string
  created: string
  cwd?: string
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => values[key] ?? '')
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolvePersona(host: string, rawPersona: string | undefined): string {
  const persona = normalizeOptional(rawPersona)
  if (persona) {
    return persona
  }
  return DEFAULT_PERSONA_TEMPLATE.replace('{{host}}', host)
}

async function loadCommanderIdentityTemplate(): Promise<string> {
  try {
    return await readFile(TEMPLATE_PATH, 'utf8')
  } catch {
    return DEFAULT_TEMPLATE
  }
}

export async function renderCommanderIdentity(
  input: CommanderIdentityTemplateInput,
): Promise<string> {
  const template = await loadCommanderIdentityTemplate()
  const persona = resolvePersona(input.host, input.persona)
  const cwd = normalizeOptional(input.cwd)

  const rendered = interpolate(template, {
    id: input.id,
    host: input.host,
    persona,
    created: input.created,
    cwd_display: cwd ? `\`${cwd}\`` : '_not provided_',
    id_yaml: yamlString(input.id),
    host_yaml: yamlString(input.host),
    persona_yaml: yamlString(persona),
    created_yaml: yamlString(input.created),
    cwd_yaml: cwd ? yamlString(cwd) : 'null',
  }).trimEnd()

  return `${rendered}\n`
}

export async function scaffoldCommanderIdentity(
  commanderId: string,
  input: CommanderIdentityTemplateInput,
  basePath?: string,
): Promise<string> {
  const { memoryRoot } = resolveCommanderPaths(commanderId, basePath)
  await mkdir(memoryRoot, { recursive: true })

  const rendered = await renderCommanderIdentity(input)
  const filePath = path.join(memoryRoot, COMMANDER_IDENTITY_FILE)
  await writeFile(filePath, rendered, 'utf8')
  return filePath
}

export async function readCommanderIdentity(
  commanderId: string,
  basePath?: string,
): Promise<string | null> {
  const { memoryRoot } = resolveCommanderPaths(commanderId, basePath)
  const filePath = path.join(memoryRoot, COMMANDER_IDENTITY_FILE)
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export function extractCommanderIdentityBody(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, '').trim()
  if (!normalized.startsWith('---')) {
    return normalized
  }

  const frontMatterMatch = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!frontMatterMatch) {
    return normalized
  }

  return normalized.slice(frontMatterMatch[0].length).trim()
}

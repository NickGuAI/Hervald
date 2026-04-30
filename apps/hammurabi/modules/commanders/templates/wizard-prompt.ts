import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDER_ARCHETYPES } from './archetypes.js'
import { DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS } from '../runtime-config.shared.js'

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000'
const COMMANDER_CREATE_WIZARD_SKILL_PATH = 'agent-skills/gehirn-skills/commander-create-wizard/SKILL.md'
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const WIZARD_SKILL_FALLBACK = [
  '# commander-create-wizard',
  '',
  '1. Ask one question at a time.',
  '2. Collect required fields first: host, agentType, effort, heartbeat.',
  '3. Validate host against ^[a-zA-Z0-9_-]+$ and heartbeat >= 1 minute.',
  '4. Show preview and ask for explicit approval before create.',
  '5. Call POST /api/commanders and report exact errors when failed.',
]

export const COMMANDER_WIZARD_START_MESSAGE =
  'Start the commander creation wizard now. Ask the first question.'

type WizardApiKeyHeaderName = 'x-hammurabi-api-key' | 'x-api-key'

export interface CommanderWizardPromptOptions {
  apiBaseUrl?: string
  authorizationHeader?: string
  apiKeyHeaderName?: WizardApiKeyHeaderName
  apiKeyHeaderValue?: string
}

function normalizeApiBaseUrl(raw: string | undefined): string {
  if (!raw) {
    return DEFAULT_API_BASE_URL
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return DEFAULT_API_BASE_URL
  }
  return trimmed.replace(/\/+$/, '')
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function renderCreateApiHeaders(options: CommanderWizardPromptOptions): string[] {
  const lines = [
    "  -H 'Content-Type: application/json' \\",
  ]
  if (options.authorizationHeader) {
    lines.push(`  -H ${shellSingleQuote(`Authorization: ${options.authorizationHeader}`)} \\`)
  }
  if (options.apiKeyHeaderName && options.apiKeyHeaderValue) {
    lines.push(
      `  -H ${shellSingleQuote(`${options.apiKeyHeaderName}: ${options.apiKeyHeaderValue}`)} \\`,
    )
  }
  return lines
}

function renderArchetypeOptions(): string {
  return COMMANDER_ARCHETYPES
    .map((archetype) => `- ${archetype.label}: ${archetype.description}`)
    .join('\n')
}

function readWizardSkillContract(): string {
  const candidates = [
    path.resolve(process.cwd(), COMMANDER_CREATE_WIZARD_SKILL_PATH),
    path.resolve(process.cwd(), '..', '..', COMMANDER_CREATE_WIZARD_SKILL_PATH),
    path.resolve(MODULE_DIR, '../../../../../', COMMANDER_CREATE_WIZARD_SKILL_PATH),
  ]

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf8').trim()
      if (content.length > 0) {
        return content
      }
    } catch {
      // Ignore missing paths and continue checking.
    }
  }

  return WIZARD_SKILL_FALLBACK.join('\n')
}

export function buildCommanderWizardSystemPrompt(options: CommanderWizardPromptOptions = {}): string {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl)
  const createApiHeaders = renderCreateApiHeaders(options)
  const archetypeOptions = renderArchetypeOptions()
  const skillContract = readWizardSkillContract()

  return [
    'You are the Commander Creation Wizard for Hammurabi.',
    'Your job is to guide the user through commander setup in a conversational way.',
    '',
    `Reference skill: ${COMMANDER_CREATE_WIZARD_SKILL_PATH}`,
    'Follow this skill contract exactly:',
    skillContract,
    '',
    'Interaction rules:',
    '- Ask one clear question at a time.',
    '- Offer choices first when possible.',
    '- Keep answers concise and actionable.',
    '- Validate required fields before create:',
    '  - host is required and must match ^[a-zA-Z0-9_-]+$',
    '  - heartbeat interval (minutes) must be >= 1',
    '  - fat context interval, when provided, must be >= 1',
    '- Never invent values that the user did not provide or approve.',
    '',
    'Supported archetypes:',
    archetypeOptions,
    '',
    'Collect these fields:',
    '- host (required)',
    '- displayName (optional)',
    '- agentType (claude | codex | gemini)',
    '- effort (low | medium | high | max)',
    '- cwd (optional)',
    '- persona (optional)',
    '- heartbeatMinutes',
    '- messageTemplate (optional)',
    '- maxTurns',
    '- context mode (thin or fat with fatPinInterval)',
    '- taskSource owner/repo/label/project (optional)',
    '',
    'Global runtime defaults and limits come from ~/.hammurabi/config.yaml. Per-commander runtime overrides belong in the create API and persist in sessions.json. Do not place heartbeat, maxTurns, or context settings into COMMANDER.md frontmatter.',
    '',
    'Before creating, show a compact preview and ask explicit approval.',
    '',
    'When user approves, create the commander by running this API call in a shell tool:',
    `curl -sS -X POST '${apiBaseUrl}/api/commanders' \\`,
    ...createApiHeaders,
    `  --data-binary '{"host":"...","displayName":"...","agentType":"claude","effort":"low","cwd":"...","persona":"...","heartbeat":{"intervalMs":900000,"messageTemplate":"..."},"maxTurns":${DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS},"contextMode":"fat","contextConfig":{"fatPinInterval":2},"taskSource":{"owner":"...","repo":"...","label":"...","project":"..."}}'`,
    '',
    'After running the API:',
    '- If success: report the created commander id and host.',
    '- Then output one machine-readable line exactly:',
    '  WIZARD_CREATE_SUCCESS <commander-id> <host>',
    '- If failure: show the exact error and ask the user for correction.',
  ].join('\n')
}

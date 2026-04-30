import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HammurabiConfig } from './config.js'
import { runTranscriptsCli } from './transcripts.js'

const COMMANDER_FILENAME = 'COMMANDER.md'
const MEMORY_HEADER = '# Commander Memory\n\n'
const DEFAULT_REMOTE_POLL_INTERVAL_MS = 15_000
const REMOTE_SYNC_STATE_FILENAME = '.remote-sync-state.json'

const COMMANDER_TEMPLATE = `---
# heartbeat fire interval in milliseconds (default: 300000 = 5 min)
heartbeat.interval: 900000
#
# override the default heartbeat message sent to the agent
heartbeat.message: "Check your quest board. What is your current task? Post a progress note, then continue or pick up the next quest."
#
# max agent turns now default from ~/.hammurabi/config.yaml (default: 300)
# per-commander maxTurns overrides belong in Hammurabi Settings/UI or the create API, not COMMANDER.md frontmatter
#
# context delivery mode: "fat" (full) or "thin" (3000-token budget)
contextMode: fat
#
# System prompt: add text below the closing --- to replace the default Commander prompt.
---

You are [NAME], engineering commander for Gehirn / Pioneering Minds AI.
Workspace: [WORKSPACE_CWD]

## Quest Board (your primary work queue)

\`\`\`
hammurabi quests list
hammurabi quests claim <quest-id>
hammurabi quests note <quest-id> "<progress text>"
hammurabi quests done <quest-id> --note "<summary>"
\`\`\`

Rules:
- Check the board before doing anything.
- Claim one quest at a time.
- Post a progress note before context compacts or before handing off work.
- Never mark done without a completion note.

## Workers (worker agent sessions)

Workers are agent sessions you can manage, message, and retire.
Use them to parallelize implementation work or keep a long-lived task moving.

\`\`\`
hammurabi workers list
hammurabi workers dispatch --session [COMMANDER_ID] [--task "<initial task>"] [--cwd <path>] [--machine <id>]
hammurabi workers status <session-name>
hammurabi workers send <session-name> "<task>"
hammurabi workers kill <session-name>
\`\`\`

When to use workers:
- Well-defined implementation tasks that can be handed off.
- Parallelizing independent features.
- Code changes while you're in a planning/review loop.

When NOT to use workers:
- Task is ambiguous and needs clarification first.
- You need the result synchronously.
- The change overlaps shared files another worker is actively editing.

## Agent Sessions (persistent named agents)

Use \`hammurabi workers send <name> "<task>"\` to message existing named sessions.
These sessions are long-lived and keep context over time.

## Cron Sessions (scheduled tasks)

Command-room cron jobs create ephemeral \`command-room-*\` sessions per run.
Use the cron command set to inspect definitions and run history.

## Sentinels (automated watchers)

Sentinel jobs create ephemeral \`sentinel-*\` sessions on trigger.
Use sentinel commands to inspect definitions, status, and history.

\`\`\`
hammurabi cron list
hammurabi sentinel list --parent [COMMANDER_ID]
\`\`\`

## Memory

Your memory lives on disk. When you need context, read it yourself. Do not wait for a heartbeat to inject memory files mechanically.
Commander memory search/recollection is not a Hammurabi runtime feature.

### Files

- \`.memory/MEMORY.md\` for the main durable memory store
- \`.memory/LONG_TERM_MEM.md\` for distilled long-term context
- \`.memory/working-memory.md\` for the active scratchpad

### Commands

\`\`\`
cat .memory/MEMORY.md
cat .memory/LONG_TERM_MEM.md
cat .memory/working-memory.md
hammurabi memory save --commander [COMMANDER_ID] "<fact>"
hammurabi memory --type=working_memory append --commander [COMMANDER_ID] "<scratch note>"
hammurabi memory --type=working_memory read --commander [COMMANDER_ID]
hammurabi commander transcripts search --commander [COMMANDER_ID] "<query>"
\`\`\`

### When to read

- Before acting on prior context, file paths, or decisions
- When a quest or heartbeat references earlier work
- When you need exact facts from durable memory files

### When to save

- After discovering durable facts, decisions, paths, or commands
- After major progress so future recalls stay high-signal
- When the task direction changes materially

Rules:
- Read \`.memory/MEMORY.md\` and \`.memory/LONG_TERM_MEM.md\` directly when you need prior context.
- Use working memory for transient scratch notes, not durable conclusions.
- Save durable facts, not transient chatter.
- Leave memory cleanup and consolidation to external cron + skill orchestration.

## Session Transcripts

Indexed commander transcript search is a Hammurabi runtime feature.
Use it when you need prior execution context from earlier commander sessions without reading raw JSONL by hand.

### Command

\`\`\`
hammurabi commander transcripts search --commander [COMMANDER_ID] "<query>"
\`\`\`

### Rules

- Transcript search is for indexed session output, not durable memory facts.
- Commander memory search/recollection is still not a Hammurabi runtime feature.
- If you need durable facts or decisions, read \`.memory/*\` directly.
`

interface Writable {
  write(chunk: string): boolean
}

interface RemoteQuest {
  id: string
  instruction: string
}

export interface RemoteMemoryExportPayload {
  syncRevision: number
  memoryMd: string
}

export interface CommanderCliDependencies {
  cwd?: string
  fileExists?: (path: string) => boolean
  writeFile?: (path: string, content: string) => void
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HammurabiConfig | null>
  commanderId?: string | null
  sleep?: (ms: number) => Promise<void>
  maxPolls?: number
  stdout?: Writable
  stderr?: Writable
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi commander init\n')
  stdout.write('  hammurabi commander init --remote <server-url> --token <sync-token> [--commander <id>] [--poll-interval <seconds>] [--once]\n')
  stdout.write('  hammurabi commander transcripts search --commander <id> "<query>" [--top-k <count>]\n')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNonEmpty(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeEndpoint(raw: string): string {
  return raw.trim().replace(/\/+$/g, '')
}

function renderCommanderTemplate(cwd: string): string {
  return COMMANDER_TEMPLATE.split('[WORKSPACE_CWD]').join(cwd)
}

function parsePositiveInteger(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null
  }
  return parsed
}

function parseNonNegativeInteger(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return null
  }
  return raw
}

function buildApiUrl(endpoint: string, apiPath: string): string {
  return new URL(apiPath, `${normalizeEndpoint(endpoint)}/`).toString()
}

function buildRemoteAuthHeaders(token: string, includeJsonContentType: boolean): HeadersInit {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  }
  if (includeJsonContentType) {
    headers['content-type'] = 'application/json'
  }
  return headers
}

function parseRemoteMemoryExportPayload(payload: unknown): RemoteMemoryExportPayload | null {
  if (!isObject(payload)) {
    return null
  }

  const syncRevision = parseNonNegativeInteger(payload.syncRevision) ?? 0
  const memoryMd = typeof payload.memoryMd === 'string' ? payload.memoryMd : MEMORY_HEADER

  return { syncRevision, memoryMd }
}

function parseRemoteQuest(payload: unknown): RemoteQuest | null {
  if (!isObject(payload)) {
    return null
  }

  const id = parseNonEmpty(typeof payload.id === 'string' ? payload.id : null)
  const instruction = parseNonEmpty(
    typeof payload.instruction === 'string' ? payload.instruction : null,
  )
  if (!id || !instruction) {
    return null
  }

  return {
    id,
    instruction,
  }
}

function readLocalSyncRevision(cwd: string): number {
  const statePath = join(cwd, '.memory', REMOTE_SYNC_STATE_FILENAME)
  if (!existsSync(statePath)) {
    return 0
  }

  const raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown
  if (!isObject(raw)) {
    throw new Error(`Remote sync state at "${statePath}" is invalid`)
  }
  const revision = parseNonNegativeInteger(raw.revision)
  if (revision === null) {
    throw new Error(`Remote sync state at "${statePath}" is invalid`)
  }
  return revision
}

function writeLocalSyncRevision(cwd: string, revision: number): void {
  const memoryRoot = join(cwd, '.memory')
  mkdirSync(memoryRoot, { recursive: true })
  writeFileSync(
    join(memoryRoot, REMOTE_SYNC_STATE_FILENAME),
    `${JSON.stringify({ revision }, null, 2)}\n`,
    'utf8',
  )
}

function scaffoldLocalSnapshot(cwd: string, snapshot: RemoteMemoryExportPayload): void {
  const memoryRoot = join(cwd, '.memory')

  mkdirSync(memoryRoot, { recursive: true })

  writeFileSync(join(memoryRoot, 'MEMORY.md'), snapshot.memoryMd || MEMORY_HEADER, 'utf8')
  writeLocalSyncRevision(cwd, snapshot.syncRevision)
}

function collectLocalMemorySnapshot(cwd: string): {
  syncRevision: number
  memoryMd: string
} {
  const memoryRoot = join(cwd, '.memory')
  const memoryPath = join(memoryRoot, 'MEMORY.md')

  let memoryMd = MEMORY_HEADER
  if (existsSync(memoryPath)) {
    memoryMd = readFileSync(memoryPath, 'utf8')
  }

  return {
    syncRevision: readLocalSyncRevision(cwd),
    memoryMd,
  }
}

async function readErrorDetail(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.toLowerCase().includes('application/json')

  if (isJson) {
    try {
      const payload = (await response.json()) as unknown
      if (!isObject(payload)) {
        return null
      }

      const error = payload.error
      if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim()
      }

      const message = payload.message
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim()
      }
    } catch {
      return null
    }
    return null
  }

  try {
    const text = (await response.text()).trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

export async function fetchRemoteMemoryExport(
  fetchImpl: typeof fetch,
  remoteUrl: string,
  commanderId: string,
  token: string,
): Promise<RemoteMemoryExportPayload> {
  const response = await fetchImpl(
    buildApiUrl(
      remoteUrl,
      `/api/commanders/${encodeURIComponent(commanderId)}/memory/export`,
    ),
    {
      method: 'GET',
      headers: buildRemoteAuthHeaders(token, false),
    },
  )

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(
      detail
        ? `Memory export failed (${response.status}): ${detail}`
        : `Memory export failed (${response.status})`,
    )
  }

  const payload = parseRemoteMemoryExportPayload((await response.json()) as unknown)
  if (!payload) {
    throw new Error('Memory export payload is invalid')
  }

  return payload
}

async function claimNextRemoteQuest(
  fetchImpl: typeof fetch,
  remoteUrl: string,
  commanderId: string,
  token: string,
): Promise<RemoteQuest | null> {
  const response = await fetchImpl(
    buildApiUrl(remoteUrl, `/api/commanders/${encodeURIComponent(commanderId)}/quests/next`),
    {
      method: 'GET',
      headers: buildRemoteAuthHeaders(token, false),
    },
  )

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(
      detail
        ? `Quest claim failed (${response.status}): ${detail}`
        : `Quest claim failed (${response.status})`,
    )
  }

  const payload = (await response.json()) as unknown
  if (!isObject(payload)) {
    throw new Error('Quest claim payload is invalid')
  }
  if (payload.quest === null) {
    return null
  }

  const quest = parseRemoteQuest(payload.quest)
  if (!quest) {
    throw new Error('Quest claim payload is missing quest details')
  }

  return quest
}

async function putRemoteMemorySync(
  fetchImpl: typeof fetch,
  remoteUrl: string,
  commanderId: string,
  token: string,
  snapshot: {
    syncRevision: number
    memoryMd: string
  },
): Promise<number> {
  const response = await fetchImpl(
    buildApiUrl(
      remoteUrl,
      `/api/commanders/${encodeURIComponent(commanderId)}/memory/sync`,
    ),
    {
      method: 'PUT',
      headers: buildRemoteAuthHeaders(token, true),
      body: JSON.stringify({
        baseRevision: snapshot.syncRevision,
        memoryMd: snapshot.memoryMd,
      }),
    },
  )

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(
      detail
        ? `Memory sync failed (${response.status}): ${detail}`
        : `Memory sync failed (${response.status})`,
    )
  }

  const payload = (await response.json()) as unknown
  if (!isObject(payload)) {
    throw new Error('Memory sync response is invalid')
  }
  const appliedRevision = parseNonNegativeInteger(payload.appliedRevision)
  if (appliedRevision === null) {
    throw new Error('Memory sync response is missing appliedRevision')
  }
  return appliedRevision
}

async function runRemoteInit(
  args: readonly string[],
  deps: CommanderCliDependencies,
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const cwd = deps.cwd ?? process.cwd()
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  }))

  let remoteUrl: string | null = null
  let token: string | null = null
  let commanderIdArg: string | null = null
  let pollIntervalMs = DEFAULT_REMOTE_POLL_INTERVAL_MS
  let once = false

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--once') {
      once = true
      continue
    }

    const value = args[index + 1]
    if (!value) {
      printUsage(stdout)
      return 1
    }

    if (flag === '--remote') {
      remoteUrl = parseNonEmpty(value)
    } else if (flag === '--token') {
      token = parseNonEmpty(value)
    } else if (flag === '--commander') {
      commanderIdArg = parseNonEmpty(value)
    } else if (flag === '--poll-interval') {
      const seconds = parsePositiveInteger(parseNonEmpty(value))
      if (!seconds) {
        stderr.write('--poll-interval must be a positive integer (seconds).\n')
        return 1
      }
      pollIntervalMs = seconds * 1000
    } else {
      printUsage(stdout)
      return 1
    }

    index += 1
  }

  if (!remoteUrl || !token) {
    stderr.write('--remote and --token are required for remote init.\n')
    return 1
  }

  const commanderId = parseNonEmpty(
    commanderIdArg ?? deps.commanderId ?? process.env.HAMMURABI_COMMANDER_ID,
  )
  if (!commanderId) {
    stderr.write('--commander or HAMMURABI_COMMANDER_ID is required for remote init.\n')
    return 1
  }

  try {
    const snapshot = await fetchRemoteMemoryExport(fetchImpl, remoteUrl, commanderId, token)
    scaffoldLocalSnapshot(cwd, snapshot)
    stdout.write(`Bootstrapped remote memory for commander ${commanderId}.\n`)
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  const maxPolls = Number.isFinite(deps.maxPolls)
    ? Math.max(0, Math.floor(deps.maxPolls as number))
    : Number.POSITIVE_INFINITY
  let polls = 0

  while (polls < maxPolls) {
    let quest: RemoteQuest | null
    try {
      quest = await claimNextRemoteQuest(fetchImpl, remoteUrl, commanderId, token)
    } catch (error) {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }

    if (!quest) {
      if (once) {
        stdout.write('No pending quests.\n')
        return 0
      }
      await sleep(pollIntervalMs)
      polls += 1
      continue
    }

    try {
      const snapshot = collectLocalMemorySnapshot(cwd)
      const appliedRevision = await putRemoteMemorySync(fetchImpl, remoteUrl, commanderId, token, snapshot)
      writeLocalSyncRevision(cwd, appliedRevision)
      stdout.write(`Claimed and synced quest ${quest.id}.\n`)
    } catch (error) {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }

    if (once) {
      return 0
    }
    polls += 1
    await sleep(pollIntervalMs)
  }

  return 0
}

export async function runCommanderCli(
  args: readonly string[],
  deps: CommanderCliDependencies = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const cwd = deps.cwd ?? process.cwd()
  const fileExists = deps.fileExists ?? existsSync
  const writeFile = deps.writeFile ?? ((path: string, content: string) => writeFileSync(path, content, 'utf8'))

  const subcommand = args[0]

  if (subcommand === 'transcripts') {
    return runTranscriptsCli(args.slice(1), {
      fetchImpl: deps.fetchImpl,
      readConfig: deps.readConfig,
      stdout,
      stderr,
    })
  }

  if (subcommand !== 'init') {
    printUsage(stdout)
    return 1
  }

  const hasRemoteFlag = args.includes('--remote') || args.includes('--token')
  if (hasRemoteFlag) {
    return runRemoteInit(args.slice(1), deps)
  }

  if (args.length !== 1) {
    printUsage(stdout)
    return 1
  }

  const targetPath = join(cwd, COMMANDER_FILENAME)

  if (fileExists(targetPath)) {
    stderr.write(`Error: ${COMMANDER_FILENAME} already exists in this directory. Refusing to overwrite.\n`)
    return 1
  }

  writeFile(targetPath, renderCommanderTemplate(cwd))
  stdout.write(`Created ${COMMANDER_FILENAME}\n`)

  return 0
}

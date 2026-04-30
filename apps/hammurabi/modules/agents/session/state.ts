import { createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Response } from 'express'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store.js'
import { resolveCommanderNamesPath } from '../../commanders/paths.js'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  normalizeClaudeAdaptiveThinkingMode,
} from '../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  normalizeClaudeEffortLevel,
} from '../../claude-effort.js'
import {
  getMimeType,
  resolveWorkspacePath,
  toWorkspaceError,
} from '../../workspace/index.js'
import {
  COMMANDER_SESSION_NAME_PREFIX,
  EXTERNAL_SESSION_STALE_MS,
} from '../constants.js'
import type { QueuedMessage } from '../message-queue.js'
import {
  parseActiveSkillInvocation,
  parseOptionalHost,
  parseSessionCreator,
  parseSessionType,
} from './input.js'
import type {
  ActiveSkillInvocation,
  AnySession,
  CompletedSession,
  CompletedSessionMetadata,
  ExitedStreamSessionState,
  PersistedSessionsState,
  PersistedStreamSession,
  SessionCreator,
  SessionTransportType,
  SessionType,
  StreamJsonEvent,
  StreamSession,
  WorkerPhase,
  WorkerState,
  WorkerSummary,
  WorldAgent,
  WorldAgentPhase,
  WorldAgentRole,
  WorldAgentStatus,
} from '../types.js'
import type { TranscriptMeta } from '../transcript-store.js'

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

export function cloneActiveSkillInvocation(
  invocation: ActiveSkillInvocation | undefined,
): ActiveSkillInvocation | undefined {
  if (!invocation) {
    return undefined
  }

  return { ...invocation }
}

function resolveStoredSessionCreator(value: unknown): SessionCreator | undefined {
  return parseSessionCreator(value) ?? undefined
}

export function summarizeWorkerStates(workers: WorkerState[]): WorkerSummary {
  return workers.reduce<WorkerSummary>((summary, worker) => {
    summary.total += 1
    summary[worker.status] += 1
    return summary
  }, {
    total: 0,
    starting: 0,
    running: 0,
    down: 0,
    done: 0,
  })
}

export function parseFrontmatter(content: string): Record<string, string | boolean> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const result: Record<string, string | boolean> = {}
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim()
    let value = trimmed.slice(colon + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (value === 'true') result[key] = true
    else if (value === 'false') result[key] = false
    else result[key] = value
  }
  return result
}

export function countCompletedTurnEntries(events: StreamJsonEvent[]): number {
  return events.reduce((count, event) => (
    event.type === 'result' ? count + 1 : count
  ), 0)
}

function parseQueuedMessage(value: unknown): QueuedMessage | null {
  const message = asObject(value)
  if (!message) {
    return null
  }

  const id = typeof message.id === 'string' ? message.id.trim() : ''
  const text = typeof message.text === 'string' ? message.text : ''
  const priority = message.priority === 'high' || message.priority === 'low'
    ? message.priority
    : (message.priority === 'normal' ? 'normal' : null)
  const queuedAt = typeof message.queuedAt === 'string' ? message.queuedAt.trim() : ''
  const images = Array.isArray(message.images)
    ? message.images
      .map((image) => {
        const parsed = asObject(image)
        if (!parsed) {
          return null
        }
        const mediaType = typeof parsed.mediaType === 'string' ? parsed.mediaType.trim() : ''
        const data = typeof parsed.data === 'string' ? parsed.data.trim() : ''
        if (!mediaType || !data) {
          return null
        }
        return { mediaType, data }
      })
      .filter((image): image is NonNullable<typeof image> => image !== null)
    : []

  if (!id || !priority || !queuedAt || (!text && images.length === 0)) {
    return null
  }

  return {
    id,
    text,
    images: images.length > 0 ? images : undefined,
    priority,
    queuedAt,
  }
}

function parseQueuedMessages(value: unknown): QueuedMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value
    .map((message) => parseQueuedMessage(message))
    .filter((message): message is QueuedMessage => message !== null)
}

export function parsePersistedStreamSessionEntry(value: unknown): PersistedStreamSession | null {
  const entry = asObject(value)
  if (!entry) {
    return null
  }

  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (!name) {
    return null
  }

  if (entry.agentType === 'openclaw') {
    return null
  }

  const agentType = entry.agentType === 'codex' || entry.agentType === 'gemini'
    ? entry.agentType
    : 'claude'
  const mode = 'default'
  const cwd = typeof entry.cwd === 'string' && entry.cwd.trim().length > 0
    ? entry.cwd.trim()
    : undefined
  const createdAt = typeof entry.createdAt === 'string' && entry.createdAt.trim().length > 0
    ? entry.createdAt.trim()
    : undefined
  if (!cwd || !createdAt) {
    return null
  }

  const effort = normalizeClaudeEffortLevel(entry.effort, DEFAULT_CLAUDE_EFFORT_LEVEL)
  const adaptiveThinking = normalizeClaudeAdaptiveThinkingMode(
    entry.adaptiveThinking,
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const host = parseOptionalHost(entry.host)
  if (host === null) {
    return null
  }
  const sessionType = parseSessionType(entry.sessionType) ?? undefined
  const creator = resolveStoredSessionCreator(entry.creator)
  const parsedCurrentSkillInvocation = parseActiveSkillInvocation(entry.currentSkillInvocation)
  const currentSkillInvocation = parsedCurrentSkillInvocation === null
    ? undefined
    : parsedCurrentSkillInvocation
  const spawnedBy = typeof entry.spawnedBy === 'string' && entry.spawnedBy.trim().length > 0
    ? entry.spawnedBy.trim()
    : undefined
  const spawnedWorkers = Array.isArray(entry.spawnedWorkers)
    ? entry.spawnedWorkers.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined
  const resumedFrom = typeof entry.resumedFrom === 'string' && entry.resumedFrom.trim().length > 0
    ? entry.resumedFrom.trim()
    : undefined
  const conversationEntryCount = typeof entry.conversationEntryCount === 'number' && Number.isFinite(entry.conversationEntryCount)
    ? entry.conversationEntryCount
    : undefined
  const events = Array.isArray(entry.events)
    ? entry.events.filter((item): item is StreamJsonEvent => asObject(item) !== null)
    : undefined
  const sessionState = entry.sessionState === 'exited' ? 'exited' : (entry.sessionState === 'active' ? 'active' : undefined)
  const hadResult = typeof entry.hadResult === 'boolean' ? entry.hadResult : undefined
  const parsedQueuedMessages = parseQueuedMessages(entry.queuedMessages)
  const queuedMessages = parsedQueuedMessages?.filter((message) => message.priority !== 'high')
  const pendingDirectSendMessages = (
    parseQueuedMessages(entry.pendingDirectSendMessages)
      ?? parsedQueuedMessages?.filter((message) => message.priority === 'high')
  )?.filter((message) => message.priority === 'high')
  const currentQueuedMessage = parseQueuedMessage(entry.currentQueuedMessage)
  const activeTurnId = typeof entry.activeTurnId === 'string' && entry.activeTurnId.trim().length > 0
    ? entry.activeTurnId.trim()
    : undefined

  return {
    name,
    sessionType,
    creator,
    agentType,
    effort: agentType === 'claude' ? effort : undefined,
    adaptiveThinking: agentType === 'claude' ? adaptiveThinking : undefined,
    mode,
    cwd,
    host: host ?? undefined,
    currentSkillInvocation,
    createdAt,
    claudeSessionId: typeof entry.claudeSessionId === 'string' ? entry.claudeSessionId.trim() || undefined : undefined,
    codexThreadId: typeof entry.codexThreadId === 'string' ? entry.codexThreadId.trim() || undefined : undefined,
    activeTurnId,
    geminiSessionId: typeof entry.geminiSessionId === 'string' ? entry.geminiSessionId.trim() || undefined : undefined,
    conversationEntryCount,
    events,
    spawnedBy,
    spawnedWorkers,
    resumedFrom,
    sessionState,
    hadResult,
    queuedMessages,
    currentQueuedMessage: currentQueuedMessage ?? undefined,
    pendingDirectSendMessages,
  }
}

export function parsePersistedSessionsState(value: unknown): PersistedSessionsState {
  const payload = asObject(value)
  const sessions = Array.isArray(payload?.sessions)
    ? payload.sessions
      .map((entry) => parsePersistedStreamSessionEntry(entry))
      .filter((entry): entry is PersistedStreamSession => entry !== null)
    : []

  return { sessions }
}

export async function getCommanderLabels(
  commanderSessionStorePath?: string,
): Promise<Record<string, string>> {
  const dataDir = commanderSessionStorePath
    ? path.dirname(path.resolve(commanderSessionStorePath))
    : undefined

  let labels: Record<string, string> = {}

  try {
    const namesPath = resolveCommanderNamesPath(dataDir)
    const content = await readFile(namesPath, 'utf8')
    labels = JSON.parse(content) as Record<string, string>
  } catch {
    labels = {}
  }

  try {
    const commanderStore = commanderSessionStorePath !== undefined
      ? new CommanderSessionStore(commanderSessionStorePath)
      : new CommanderSessionStore()
    const commanderSessions = await commanderStore.list()
    for (const commanderSession of commanderSessions) {
      const host = commanderSession.host.trim()
      if (host.length > 0) {
        labels[commanderSession.id] = host
      }
    }
  } catch {
    // Fall back to names.json when the commander store is unavailable.
  }

  return labels
}

export function getWorldAgentRole(session: AnySession): WorldAgentRole {
  return session.sessionType === 'commander' ? 'commander' : 'worker'
}

export function getCommanderWorldAgentId(commanderId: string): string {
  if (commanderId.startsWith(COMMANDER_SESSION_NAME_PREFIX)) {
    return commanderId
  }
  return `${COMMANDER_SESSION_NAME_PREFIX}${commanderId}`
}

export function getCommanderWorldAgentStatus(session: CommanderSession): WorldAgentStatus {
  if (session.state === 'running') {
    return 'active'
  }
  return 'idle'
}

export function getCommanderWorldAgentPhase(session: CommanderSession): WorldAgentPhase {
  if (session.state === 'running') {
    return 'thinking'
  }
  if (session.state === 'paused') {
    return 'blocked'
  }
  return 'idle'
}

export function toCommanderWorldAgent(session: CommanderSession): WorldAgent {
  return {
    id: getCommanderWorldAgentId(session.id),
    agentType: session.agentType ?? 'claude',
    transportType: 'stream',
    status: getCommanderWorldAgentStatus(session),
    usage: { inputTokens: 0, outputTokens: 0, costUsd: session.totalCostUsd ?? 0 },
    task: session.currentTask?.issueUrl ?? '',
    phase: getCommanderWorldAgentPhase(session),
    lastToolUse: null,
    lastUpdatedAt: session.lastHeartbeat ?? session.created,
    role: 'commander',
  }
}

export function extractClaudeSessionId(event: StreamJsonEvent): string | undefined {
  const direct = typeof (event as Record<string, unknown>).session_id === 'string'
    ? (event as Record<string, unknown>).session_id as string
    : undefined
  if (direct && direct.trim().length > 0) {
    return direct.trim()
  }
  const camel = typeof (event as Record<string, unknown>).sessionId === 'string'
    ? (event as Record<string, unknown>).sessionId as string
    : undefined
  if (camel && camel.trim().length > 0) {
    return camel.trim()
  }
  const message = asObject(event.message)
  const metadata = asObject(message?.metadata)
  const nested = typeof metadata?.session_id === 'string' ? metadata.session_id : undefined
  return nested?.trim() || undefined
}

export function toCompletedSession(
  sessionName: string,
  completedAt: string,
  event: StreamJsonEvent,
  costUsd: number,
  metadata?: CompletedSessionMetadata,
): CompletedSession {
  const sessionType = parseSessionType(metadata?.sessionType) ?? 'worker'
  return {
    name: sessionName,
    createdAt: metadata?.createdAt,
    completedAt,
    subtype: typeof event.subtype === 'string' && event.subtype.trim().length > 0
      ? event.subtype.trim()
      : (event.is_error ? 'failed' : 'success'),
    finalComment: typeof event.result === 'string'
      ? event.result
      : (typeof event.text === 'string' ? event.text : ''),
    costUsd,
    sessionType,
    creator: metadata?.creator ?? { kind: 'human' },
    spawnedBy: metadata?.spawnedBy,
  }
}

export function toExitBasedCompletedSession(
  sessionName: string,
  event: StreamJsonEvent & { exitCode?: number; signal?: string | number; text?: string },
  costUsd: number,
  metadata?: CompletedSessionMetadata,
): CompletedSession {
  const code = typeof event.exitCode === 'number' ? event.exitCode : -1
  const signal = typeof event.signal === 'string' ? event.signal : ''
  const text = typeof event.text === 'string' ? event.text : ''
  const subtype = code === 0 ? 'success' : 'failed'
  const finalComment = text || (signal ? `Process exited (signal: ${signal})` : `Process exited with code ${code}`)
  const sessionType = parseSessionType(metadata?.sessionType) ?? 'worker'
  return {
    name: sessionName,
    createdAt: metadata?.createdAt,
    completedAt: new Date().toISOString(),
    subtype,
    finalComment,
    costUsd,
    sessionType,
    creator: metadata?.creator ?? { kind: 'human' },
    spawnedBy: metadata?.spawnedBy,
  }
}

export function mergePersistedSessionWithTranscriptMeta(
  entry: PersistedStreamSession,
  rawMeta: TranscriptMeta | null,
): PersistedStreamSession {
  const meta = asObject(rawMeta)
  if (!meta) {
    return entry
  }

  let agentType = entry.agentType
  if (meta.agentType === 'claude' || meta.agentType === 'codex' || meta.agentType === 'gemini') {
    agentType = meta.agentType
  }
  const effort = normalizeClaudeEffortLevel(
    meta.effort,
    entry.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
  )
  const adaptiveThinking = normalizeClaudeAdaptiveThinkingMode(
    meta.adaptiveThinking,
    entry.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )

  const metaCwd = typeof meta.cwd === 'string' ? meta.cwd.trim() : ''
  const cwd = metaCwd.startsWith('/') ? path.resolve(metaCwd) : entry.cwd
  const metaHost = parseOptionalHost(meta.host)
  const host = metaHost === null ? entry.host : metaHost
  const metaCreatedAt = typeof meta.createdAt === 'string' && meta.createdAt.trim().length > 0
    ? meta.createdAt
    : entry.createdAt
  const claudeSessionId = typeof meta.claudeSessionId === 'string' && meta.claudeSessionId.trim().length > 0
    ? meta.claudeSessionId.trim()
    : entry.claudeSessionId
  const codexThreadId = typeof meta.codexThreadId === 'string' && meta.codexThreadId.trim().length > 0
    ? meta.codexThreadId.trim()
    : entry.codexThreadId
  const geminiSessionId = typeof meta.geminiSessionId === 'string' && meta.geminiSessionId.trim().length > 0
    ? meta.geminiSessionId.trim()
    : entry.geminiSessionId
  const spawnedBy = typeof meta.spawnedBy === 'string' && meta.spawnedBy.trim().length > 0
    ? meta.spawnedBy.trim()
    : entry.spawnedBy

  return {
    ...entry,
    agentType,
    effort: agentType === 'claude' ? effort : undefined,
    adaptiveThinking: agentType === 'claude' ? adaptiveThinking : undefined,
    cwd,
    host: host ?? undefined,
    createdAt: metaCreatedAt,
    claudeSessionId,
    codexThreadId,
    geminiSessionId,
    spawnedBy,
  }
}

export function applyRestoredReplayState(
  session: StreamSession,
  events: StreamJsonEvent[],
  applyUsageEvent: (session: StreamSession, event: StreamJsonEvent) => void,
  conversationEntryCount?: number,
): void {
  session.events = [...events]
  session.usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  for (const event of session.events) {
    applyUsageEvent(session, event)
  }
  session.conversationEntryCount = conversationEntryCount ?? countCompletedTurnEntries(session.events)
}

export function resolveWorkerState(
  workerSessionName: string,
  sessions: Map<string, AnySession>,
  exitedStreamSessions: Map<string, ExitedStreamSessionState>,
  completedSessions: Map<string, CompletedSession>,
): WorkerState {
  const active = sessions.get(workerSessionName)
  if (active?.kind === 'stream') {
    if (active.lastTurnCompleted) {
      return { name: workerSessionName, status: 'done', phase: 'exited' }
    }
    const phase: WorkerPhase = active.events.length === 0 ? 'starting' : 'running'
    return {
      name: workerSessionName,
      status: phase === 'starting' ? 'starting' : 'running',
      phase,
    }
  }

  const exited = exitedStreamSessions.get(workerSessionName)
  if (exited) {
    return {
      name: workerSessionName,
      status: exited.hadResult ? 'done' : 'down',
      phase: exited.phase,
    }
  }

  if (completedSessions.has(workerSessionName)) {
    return { name: workerSessionName, status: 'done', phase: 'exited' }
  }

  return { name: workerSessionName, status: 'down', phase: 'exited' }
}

export function getWorkerStates(
  sourceSessionName: string,
  sessions: Map<string, AnySession>,
  exitedStreamSessions: Map<string, ExitedStreamSessionState>,
  completedSessions: Map<string, CompletedSession>,
): WorkerState[] {
  const workerNames = new Set<string>()
  const sourceSession = sessions.get(sourceSessionName)
  if (sourceSession?.kind === 'stream') {
    for (const workerName of sourceSession.spawnedWorkers) {
      workerNames.add(workerName)
    }
  }

  for (const session of sessions.values()) {
    if (session.kind !== 'stream') continue
    if (session.spawnedBy === sourceSessionName) {
      workerNames.add(session.name)
    }
  }

  const workers = [...workerNames]
    .map((workerName) => resolveWorkerState(workerName, sessions, exitedStreamSessions, completedSessions))
    .filter((worker) => worker.status !== 'down')
  workers.sort((left, right) => left.name.localeCompare(right.name))
  return workers
}

export function resolveLastUpdatedAt(session: AnySession): string {
  if (session.lastEventAt && Number.isFinite(Date.parse(session.lastEventAt))) {
    return session.lastEventAt
  }
  return session.createdAt
}

export function getToolUses(event: StreamJsonEvent): Array<{ id: string | null; name: string }> {
  const uses: Array<{ id: string | null; name: string }> = []
  const addToolUse = (rawBlock: unknown) => {
    const block = asObject(rawBlock)
    if (!block || block.type !== 'tool_use') {
      return
    }
    if (typeof block.name !== 'string' || block.name.trim().length === 0) {
      return
    }
    const id = typeof block.id === 'string' && block.id.trim().length > 0
      ? block.id.trim()
      : null
    uses.push({ id, name: block.name.trim() })
  }

  if (event.type === 'tool_use') {
    const directName = typeof event.name === 'string' ? event.name.trim() : ''
    if (directName.length > 0) {
      const directId = typeof event.id === 'string' && event.id.trim().length > 0
        ? event.id.trim()
        : null
      uses.push({ id: directId, name: directName })
    }
  }

  addToolUse(event.content_block)

  const message = asObject(event.message)
  if (Array.isArray(message?.content)) {
    for (const item of message.content) {
      addToolUse(item)
    }
  }

  return uses
}

export function getToolResultIds(event: StreamJsonEvent): string[] {
  const ids: string[] = []
  const addToolResult = (rawBlock: unknown) => {
    const block = asObject(rawBlock)
    if (!block || block.type !== 'tool_result') {
      return
    }
    if (typeof block.tool_use_id !== 'string' || block.tool_use_id.trim().length === 0) {
      return
    }
    ids.push(block.tool_use_id.trim())
  }

  if (event.type === 'tool_result' && typeof event.tool_use_id === 'string' && event.tool_use_id.trim().length > 0) {
    ids.push(event.tool_use_id.trim())
  }

  addToolResult(event.content_block)

  const message = asObject(event.message)
  if (Array.isArray(message?.content)) {
    for (const item of message.content) {
      addToolResult(item)
    }
  }

  return ids
}

export function getLastToolUse(session: StreamSession | AnySession): string | null {
  if (session.kind === 'pty') {
    return null
  }
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const toolUses = getToolUses(session.events[i])
    for (let j = toolUses.length - 1; j >= 0; j -= 1) {
      return toolUses[j].name
    }
  }
  return null
}

export function hasPendingAskUserQuestion(session: StreamSession | AnySession): boolean {
  if (session.kind === 'pty') {
    return false
  }
  const answeredToolIds = new Set<string>()
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    for (const toolResultId of getToolResultIds(event)) {
      answeredToolIds.add(toolResultId)
    }

    const toolUses = getToolUses(event)
    for (let j = toolUses.length - 1; j >= 0; j -= 1) {
      const toolUse = toolUses[j]
      if (toolUse.name !== 'AskUserQuestion') {
        continue
      }
      if (!toolUse.id) {
        return true
      }
      if (!answeredToolIds.has(toolUse.id)) {
        return true
      }
    }
  }
  return false
}

export function getWorldAgentStatus(session: AnySession, nowMs: number): WorldAgentStatus {
  if (session.kind === 'stream' && session.lastTurnCompleted && session.completedTurnAt) {
    return 'completed'
  }
  if (session.kind === 'stream' && !session.lastTurnCompleted && session.codexTurnStaleAt) {
    return 'stale'
  }
  if (session.kind === 'external') {
    const heartbeatAge = nowMs - session.lastHeartbeat
    if (heartbeatAge > EXTERNAL_SESSION_STALE_MS) return 'stale'
    return 'active'
  }

  const lastUpdatedAt = resolveLastUpdatedAt(session)
  const ageMs = nowMs - Date.parse(lastUpdatedAt)
  if (!Number.isFinite(ageMs) || ageMs < 60_000) {
    return 'active'
  }
  if (ageMs <= 5 * 60_000) {
    return 'idle'
  }
  return 'stale'
}

export function getWorldAgentPhase(session: AnySession, nowMs: number): WorldAgentPhase {
  if (session.kind === 'pty') return 'idle'
  if (session.kind === 'stream' && session.lastTurnCompleted && session.completedTurnAt) {
    return 'completed'
  }
  if (session.kind === 'stream' && getWorldAgentStatus(session, nowMs) === 'stale') {
    return 'stale'
  }
  if (hasPendingAskUserQuestion(session)) {
    return 'blocked'
  }

  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (getToolUses(event).length > 0) {
      return 'tool_use'
    }
    if (getToolResultIds(event).length > 0) {
      return 'thinking'
    }
    if (
      event.type === 'message_start' ||
      event.type === 'assistant' ||
      event.type === 'message_delta' ||
      event.type === 'content_block_start' ||
      event.type === 'content_block_delta' ||
      event.type === 'content_block_stop' ||
      event.type === 'user'
    ) {
      return 'thinking'
    }
  }

  return 'idle'
}

export function getWorldAgentUsage(session: AnySession): {
  inputTokens: number
  outputTokens: number
  costUsd: number
} {
  if (session.kind === 'stream') {
    return session.usage
  }
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

export function getWorldAgentTask(session: AnySession): string {
  return typeof session.task === 'string' ? session.task : ''
}

export function toWorldAgent(session: AnySession, nowMs: number): WorldAgent {
  const transportType: SessionTransportType =
    session.kind === 'external' ? 'external' : (session.kind === 'pty' ? 'pty' : 'stream')
  return {
    id: session.name,
    agentType: session.agentType,
    transportType,
    status: getWorldAgentStatus(session, nowMs),
    usage: getWorldAgentUsage(session),
    task: getWorldAgentTask(session),
    phase: getWorldAgentPhase(session, nowMs),
    lastToolUse: session.kind === 'pty' ? null : getLastToolUse(session),
    lastUpdatedAt: resolveLastUpdatedAt(session),
    role: getWorldAgentRole(session),
  }
}

export function sendWorkspaceError(res: Response, error: unknown): void {
  const workspaceError = toWorkspaceError(error)
  res.status(workspaceError.statusCode).json({ error: workspaceError.message })
}

export async function sendWorkspaceRawFile(
  res: Response,
  workspace: Parameters<typeof resolveWorkspacePath>[0],
  rawPath: string,
): Promise<void> {
  const { absolutePath } = await resolveWorkspacePath(workspace, rawPath, {
    expectFile: true,
  })
  const mimeType = getMimeType(absolutePath) ?? 'application/octet-stream'
  res.setHeader('Content-Type', mimeType)
  const stream = createReadStream(absolutePath)
  stream.on('error', (error) => {
    if (!res.headersSent) {
      sendWorkspaceError(res, error)
      return
    }
    res.destroy(error)
  })
  stream.pipe(res)
}

export function hasResumeIdentifier(entry: PersistedStreamSession): boolean {
  if (entry.agentType === 'claude') {
    return Boolean(entry.claudeSessionId)
  }
  if (entry.agentType === 'codex') {
    return Boolean(entry.codexThreadId)
  }
  if (entry.agentType === 'gemini') {
    return Boolean(entry.geminiSessionId)
  }
  return false
}

export function canResumeLiveStreamSession(session: StreamSession): boolean {
  return (
    session.agentType === 'codex' &&
    Boolean(session.codexThreadId) &&
    Boolean(session.codexTurnStaleAt)
  )
}

export function snapshotExitedStreamSession(session: StreamSession): ExitedStreamSessionState {
  return {
    phase: 'exited',
    hadResult: Boolean(session.finalResultEvent),
    sessionType: session.sessionType,
    creator: session.creator,
    agentType: session.agentType,
    effort: session.effort,
    adaptiveThinking: session.adaptiveThinking,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: cloneActiveSkillInvocation(session.currentSkillInvocation),
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    createdAt: session.createdAt,
    claudeSessionId: session.claudeSessionId,
    codexThreadId: session.codexThreadId,
    activeTurnId: session.activeTurnId,
    geminiSessionId: session.geminiSessionId,
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

export function snapshotDeletedResumableStreamSession(session: StreamSession): ExitedStreamSessionState | null {
  const claudeSessionId = session.agentType === 'claude' && session.lastTurnCompleted
    ? session.claudeSessionId
    : undefined
  const codexThreadId = session.agentType === 'codex'
    ? session.codexThreadId
    : undefined
  const geminiSessionId = session.agentType === 'gemini'
    ? session.geminiSessionId
    : undefined

  if (!claudeSessionId && !codexThreadId && !geminiSessionId) {
    return null
  }

  return {
    phase: 'exited',
    hadResult: Boolean(session.finalResultEvent),
    sessionType: session.sessionType,
    creator: session.creator,
    agentType: session.agentType,
    effort: session.effort,
    adaptiveThinking: session.adaptiveThinking,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: cloneActiveSkillInvocation(session.currentSkillInvocation),
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    createdAt: session.createdAt,
    claudeSessionId,
    codexThreadId,
    activeTurnId: session.activeTurnId,
    geminiSessionId,
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

export function buildPersistedEntryFromExitedSession(
  sessionName: string,
  exited: ExitedStreamSessionState,
): PersistedStreamSession {
  return {
    name: sessionName,
    sessionType: exited.sessionType,
    creator: exited.creator,
    agentType: exited.agentType,
    effort: exited.effort,
    adaptiveThinking: exited.adaptiveThinking,
    mode: exited.mode,
    cwd: exited.cwd,
    host: exited.host,
    currentSkillInvocation: cloneActiveSkillInvocation(exited.currentSkillInvocation),
    createdAt: exited.createdAt,
    claudeSessionId: exited.claudeSessionId,
    codexThreadId: exited.codexThreadId,
    activeTurnId: exited.activeTurnId,
    geminiSessionId: exited.geminiSessionId,
    spawnedBy: exited.spawnedBy,
    spawnedWorkers: [...exited.spawnedWorkers],
    resumedFrom: exited.resumedFrom,
    sessionState: 'exited',
    hadResult: exited.hadResult,
    conversationEntryCount: exited.conversationEntryCount,
    events: [...exited.events],
    queuedMessages: exited.queuedMessages ? [...exited.queuedMessages] : [],
    currentQueuedMessage: exited.currentQueuedMessage,
    pendingDirectSendMessages: exited.pendingDirectSendMessages ? [...exited.pendingDirectSendMessages] : [],
  }
}

export function buildPersistedEntryFromLiveStreamSession(
  sessionName: string,
  session: StreamSession,
): PersistedStreamSession {
  return {
    name: sessionName,
    sessionType: session.sessionType,
    creator: session.creator,
    agentType: session.agentType,
    effort: session.effort,
    adaptiveThinking: session.adaptiveThinking,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: cloneActiveSkillInvocation(session.currentSkillInvocation),
    createdAt: session.createdAt,
    claudeSessionId: session.claudeSessionId,
    codexThreadId: session.codexThreadId,
    activeTurnId: session.activeTurnId,
    geminiSessionId: session.geminiSessionId,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    resumedFrom: session.resumedFrom,
    sessionState: 'active',
    hadResult: Boolean(session.finalResultEvent),
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

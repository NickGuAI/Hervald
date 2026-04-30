import type { StreamEvent } from '@/types'
import type { FleetSessionStreamMap } from './use-fleet-session-streams'

export const FLEET_TIMELINE_SLOT_COUNT = 18

export type FleetActivityTone = 'idle' | 'active' | 'tool' | 'blocked'
export type FleetRowTone = 'active' | 'blocked' | 'stale' | 'idle' | 'completed'

export interface FleetCommander {
  id: string
  host: string
  state: string
  created?: string
  displayName?: string
  lastHeartbeat?: string | null
  totalCostUsd?: number
  currentTask?: {
    issueNumber: number
    title?: string
  } | null
  ui?: {
    accentColor?: string
  } | null
}

export interface FleetAgentSession {
  name: string
  label?: string
  created: string
  lastActivityAt?: string
  sessionType?: string
  transportType?: string
  status?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
  queuedMessageCount?: number
}

export interface FleetWorldAgent {
  id: string
  status: string
  phase: string
  lastUpdatedAt: string
  lastToolUse?: string | null
  role?: 'commander' | 'worker'
  usage: {
    costUsd: number
  }
}

export interface FleetApproval {
  id: string
  commanderId: string | null
  sessionName: string | null
}

export interface FleetLaneRow {
  id: string
  sessionName: string
  label: string
  caption: string
  roleLabel: string
  depth: number
  accentColor: string
  statusLabel: string
  statusTone: FleetRowTone
  pendingApprovalCount: number
  queuedCount: number
  costUsd: number
  lastUpdatedAt: string
  activity: FleetActivityTone[]
}

export interface FleetCommanderGroup {
  commanderId: string
  commanderLabel: string
  commanderState: string
  accentColor: string
  rows: FleetLaneRow[]
  approvalCount: number
  workerCount: number
  activeRowCount: number
  blockedRowCount: number
  idleRowCount: number
  loadTrend: number[]
}

export interface FleetViewModel {
  groups: FleetCommanderGroup[]
  visibleRowCount: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null
}

function resolveCommanderSessionName(commanderId: string): string {
  return `commander-${commanderId}`
}

function resolveAccentColor(commander: FleetCommander): string {
  const accentColor = commander.ui?.accentColor?.trim()
  return accentColor && accentColor.length > 0 ? accentColor : 'var(--sumi-black)'
}

function resolveCommanderLabel(commander: FleetCommander): string {
  const displayName = commander.displayName?.trim()
  if (displayName) {
    return displayName
  }
  const host = commander.host.trim()
  return host.length > 0 ? host : commander.id
}

function resolveTaskCaption(commander: FleetCommander): string | null {
  if (!commander.currentTask) {
    return null
  }
  const title = commander.currentTask.title?.trim()
  if (title) {
    return `#${commander.currentTask.issueNumber} ${title}`
  }
  return `#${commander.currentTask.issueNumber}`
}

function resolveParentName(session: FleetAgentSession): string | null {
  const spawnedBy = session.spawnedBy?.trim()
  return spawnedBy && spawnedBy.length > 0 ? spawnedBy : null
}

function resolveRootCommanderSessionName(
  session: FleetAgentSession,
  sessionsByName: Map<string, FleetAgentSession>,
): string | null {
  let currentName = session.name
  const visited = new Set<string>()

  while (!visited.has(currentName)) {
    visited.add(currentName)
    const currentSession = sessionsByName.get(currentName)
    if (!currentSession) {
      return null
    }
    if (currentSession.sessionType === 'commander') {
      return currentName
    }

    const parentName = resolveParentName(currentSession)
    if (!parentName) {
      return null
    }
    currentName = parentName
  }

  return null
}

function resolveDepth(
  sessionName: string,
  sessionsByName: Map<string, FleetAgentSession>,
  commanderSessionName: string,
): number {
  if (sessionName === commanderSessionName) {
    return 0
  }

  let depth = 1
  let currentName = sessionName
  const visited = new Set<string>()

  while (!visited.has(currentName)) {
    visited.add(currentName)
    const currentSession = sessionsByName.get(currentName)
    if (!currentSession) {
      return depth
    }

    const parentName = resolveParentName(currentSession)
    if (!parentName) {
      return depth
    }
    if (parentName === commanderSessionName) {
      return depth
    }

    depth += 1
    currentName = parentName
  }

  return depth
}

function resolveSessionLabel(session: FleetAgentSession | undefined, fallbackName: string): string {
  const label = session?.label?.trim()
  if (label) {
    return label
  }
  return fallbackName
}

function readBlocks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
}

function eventContainsBlockType(event: StreamEvent, blockType: 'tool_use' | 'tool_result'): boolean {
  if (event.type === blockType) {
    return true
  }

  const contentBlock = asRecord((event as Record<string, unknown>).content_block)
  if (contentBlock?.type === blockType) {
    return true
  }

  const message = asRecord((event as Record<string, unknown>).message)
  return readBlocks(message?.content).some((block) => block.type === blockType)
}

function resolveEventTone(event: StreamEvent): FleetActivityTone | null {
  if (eventContainsBlockType(event, 'tool_use') || eventContainsBlockType(event, 'tool_result')) {
    return 'tool'
  }

  if (event.type === 'system') {
    const eventText = typeof event.text === 'string' ? event.text.toLowerCase() : ''
    if (
      eventText.includes('awaiting')
      || eventText.includes('approval')
      || eventText.includes('blocked')
    ) {
      return 'blocked'
    }
    return 'active'
  }

  if (event.type === 'queue_update') {
    const queuedItems = Array.isArray(event.queue?.items) ? event.queue.items.length : 0
    return queuedItems > 0 ? 'blocked' : null
  }

  if (event.type === 'rate_limit_event') {
    return 'blocked'
  }

  return 'active'
}

function readEventTimestampMs(event: StreamEvent): number | null {
  const candidates = [
    readIsoDate(event.source?.normalizedAt),
    readIsoDate((event as Record<string, unknown>).timestamp),
    readIsoDate((event as Record<string, unknown>).createdAt),
    readIsoDate((event as Record<string, unknown>).occurredAt),
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    const parsed = Date.parse(candidate)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function toneWeight(tone: FleetActivityTone): number {
  switch (tone) {
    case 'blocked':
      return 4
    case 'tool':
      return 3
    case 'active':
      return 2
    default:
      return 1
  }
}

function strongerTone(current: FleetActivityTone, next: FleetActivityTone): FleetActivityTone {
  return toneWeight(next) >= toneWeight(current) ? next : current
}

function loadContribution(tone: FleetActivityTone): number {
  switch (tone) {
    case 'blocked':
      return 3
    case 'tool':
      return 2
    case 'active':
      return 1
    default:
      return 0
  }
}

export function buildFleetActivitySlots({
  events,
  anchorAt,
  nowMs,
  windowMinutes,
  slotCount,
  phase,
  status,
  pendingApprovalCount,
}: {
  events: StreamEvent[]
  anchorAt: string
  nowMs: number
  windowMinutes: number
  slotCount: number
  phase?: string
  status?: string
  pendingApprovalCount: number
}): FleetActivityTone[] {
  const slots = Array.from({ length: slotCount }, () => 'idle' as FleetActivityTone)
  const windowMs = windowMinutes * 60_000
  const anchorMs = Number.isFinite(Date.parse(anchorAt)) ? Date.parse(anchorAt) : nowMs
  const relevantEvents = events
    .map((event) => ({ event, tone: resolveEventTone(event) }))
    .filter((entry): entry is { event: StreamEvent; tone: FleetActivityTone } => entry.tone !== null)

  const placeTone = (timestampMs: number, tone: FleetActivityTone) => {
    const minutesAgo = (nowMs - timestampMs) / 60_000
    if (minutesAgo < 0 || minutesAgo > windowMinutes) {
      return
    }
    const slotIndex = Math.min(
      slotCount - 1,
      Math.max(0, slotCount - 1 - Math.floor((minutesAgo / windowMinutes) * slotCount)),
    )
    slots[slotIndex] = strongerTone(slots[slotIndex], tone)
  }

  const syntheticStepMs = relevantEvents.length > 0
    ? Math.max(20_000, Math.floor(windowMs / Math.max(relevantEvents.length, 1)))
    : windowMs

  relevantEvents.forEach((entry, index) => {
    const syntheticTimestampMs = anchorMs - ((relevantEvents.length - index - 1) * syntheticStepMs)
    placeTone(readEventTimestampMs(entry.event) ?? syntheticTimestampMs, entry.tone)
  })

  if (pendingApprovalCount > 0) {
    placeTone(Math.min(nowMs, anchorMs), 'blocked')
  }

  if (slots.every((slot) => slot === 'idle')) {
    if (phase === 'blocked') {
      slots[slotCount - 1] = 'blocked'
    } else if (phase === 'tool_use') {
      slots[slotCount - 1] = 'tool'
    } else if (status === 'active' || status === 'completed') {
      slots[slotCount - 1] = 'active'
    }
  }

  return slots
}

function resolveRowTone(status: string | undefined, phase: string | undefined, pendingApprovalCount: number): FleetRowTone {
  if (pendingApprovalCount > 0 || phase === 'blocked' || status === 'paused') {
    return 'blocked'
  }
  if (status === 'stale' || status === 'exited' || status === 'stopped') {
    return 'stale'
  }
  if (status === 'completed') {
    return 'completed'
  }
  if (status === 'active' || status === 'running' || status === 'connected') {
    return 'active'
  }
  return 'idle'
}

function resolveRowStatusLabel(tone: FleetRowTone, phase: string | undefined, pendingApprovalCount: number): string {
  if (pendingApprovalCount > 0) {
    return `${pendingApprovalCount} pending`
  }
  if (tone === 'active' && phase === 'tool_use') {
    return 'tool use'
  }
  if (tone === 'completed') {
    return 'completed'
  }
  return tone
}

function resolveRowCaption({
  commander,
  session,
  worldAgent,
  roleLabel,
  pendingApprovalCount,
}: {
  commander: FleetCommander
  session?: FleetAgentSession
  worldAgent?: FleetWorldAgent
  roleLabel: string
  pendingApprovalCount: number
}): string {
  if (pendingApprovalCount > 0) {
    return `${pendingApprovalCount} approval${pendingApprovalCount === 1 ? '' : 's'} waiting`
  }

  const taskCaption = resolveTaskCaption(commander)
  if (roleLabel === 'Commander' && taskCaption) {
    return taskCaption
  }

  const lastToolUse = worldAgent?.lastToolUse?.trim()
  if (lastToolUse) {
    return lastToolUse
  }

  const queuedCount = session?.queuedMessageCount ?? 0
  if (queuedCount > 0) {
    return `${queuedCount} queued`
  }

  return roleLabel === 'Commander' ? 'Standing by' : 'Live worker lane'
}

function countApprovalsForRow(
  approvals: readonly FleetApproval[],
  commanderId: string,
  commanderSessionName: string,
  rowSessionName: string,
): number {
  let count = 0
  for (const approval of approvals) {
    if (approval.sessionName && approval.sessionName === rowSessionName) {
      count += 1
      continue
    }
    if (
      !approval.sessionName
      && rowSessionName === commanderSessionName
      && approval.commanderId === commanderId
    ) {
      count += 1
    }
  }
  return count
}

function countApprovalsForGroup(
  approvals: readonly FleetApproval[],
  commanderId: string,
  sessionNames: Set<string>,
): number {
  let count = 0
  for (const approval of approvals) {
    if (approval.sessionName && sessionNames.has(approval.sessionName)) {
      count += 1
      continue
    }
    if (!approval.sessionName && approval.commanderId === commanderId) {
      count += 1
    }
  }
  return count
}

export function buildFleetViewModel({
  commanders,
  sessions,
  worldAgents,
  approvals,
  streams,
  nowMs,
  windowMinutes,
  slotCount = FLEET_TIMELINE_SLOT_COUNT,
}: {
  commanders: readonly FleetCommander[]
  sessions: readonly FleetAgentSession[]
  worldAgents: readonly FleetWorldAgent[]
  approvals: readonly FleetApproval[]
  streams: FleetSessionStreamMap
  nowMs: number
  windowMinutes: number
  slotCount?: number
}): FleetViewModel {
  const sessionsByName = new Map(sessions.map((session) => [session.name, session]))
  const worldAgentsById = new Map(worldAgents.map((worldAgent) => [worldAgent.id, worldAgent]))
  const descendantBuckets = new Map<string, FleetAgentSession[]>()

  for (const session of sessions) {
    const transportType = session.transportType
      ?? (session.sessionType === 'stream' || session.sessionType === 'pty' ? session.sessionType : undefined)
    if (transportType !== 'stream') {
      continue
    }
    if (session.sessionType === 'commander') {
      continue
    }
    const commanderSessionName = resolveRootCommanderSessionName(session, sessionsByName)
    if (!commanderSessionName) {
      continue
    }
    const bucket = descendantBuckets.get(commanderSessionName) ?? []
    bucket.push(session)
    descendantBuckets.set(commanderSessionName, bucket)
  }

  const groups = commanders.map((commander) => {
    const commanderSessionName = resolveCommanderSessionName(commander.id)
    const commanderSession = sessionsByName.get(commanderSessionName)
    const descendantSessions = [...(descendantBuckets.get(commanderSessionName) ?? [])]

    descendantSessions.sort((left, right) => {
      const leftDepth = resolveDepth(left.name, sessionsByName, commanderSessionName)
      const rightDepth = resolveDepth(right.name, sessionsByName, commanderSessionName)
      if (leftDepth !== rightDepth) {
        return leftDepth - rightDepth
      }
      const leftUpdatedAt = worldAgentsById.get(left.name)?.lastUpdatedAt ?? left.lastActivityAt ?? left.created
      const rightUpdatedAt = worldAgentsById.get(right.name)?.lastUpdatedAt ?? right.lastActivityAt ?? right.created
      return Date.parse(rightUpdatedAt) - Date.parse(leftUpdatedAt) || left.name.localeCompare(right.name)
    })

    const sessionNames = new Set<string>([commanderSessionName, ...descendantSessions.map((session) => session.name)])
    const rows: FleetLaneRow[] = []

    const buildRow = (
      sessionName: string,
      roleLabel: string,
      depth: number,
      fallbackSession: FleetAgentSession | undefined,
    ) => {
      const worldAgent = worldAgentsById.get(sessionName)
      const pendingApprovalCount = countApprovalsForRow(
        approvals,
        commander.id,
        commanderSessionName,
        sessionName,
      )
      const rawStatus = worldAgent?.status ?? (depth === 0 ? commander.state : fallbackSession?.status)
      const rowTone = resolveRowTone(rawStatus, worldAgent?.phase, pendingApprovalCount)
      const lastUpdatedAt = worldAgent?.lastUpdatedAt
        ?? fallbackSession?.lastActivityAt
        ?? commander.lastHeartbeat
        ?? fallbackSession?.created
        ?? commander.created
        ?? new Date(nowMs).toISOString()
      const activity = buildFleetActivitySlots({
        events: streams[sessionName]?.events ?? [],
        anchorAt: lastUpdatedAt,
        nowMs,
        windowMinutes,
        slotCount,
        phase: worldAgent?.phase,
        status: rawStatus,
        pendingApprovalCount,
      })

      rows.push({
        id: sessionName,
        sessionName,
        label: depth === 0
          ? resolveCommanderLabel(commander)
          : resolveSessionLabel(fallbackSession, sessionName),
        caption: resolveRowCaption({
          commander,
          session: fallbackSession,
          worldAgent,
          roleLabel,
          pendingApprovalCount,
        }),
        roleLabel,
        depth,
        accentColor: resolveAccentColor(commander),
        statusLabel: resolveRowStatusLabel(rowTone, worldAgent?.phase, pendingApprovalCount),
        statusTone: rowTone,
        pendingApprovalCount,
        queuedCount: fallbackSession?.queuedMessageCount ?? 0,
        costUsd: depth === 0
          ? (commander.totalCostUsd ?? worldAgent?.usage.costUsd ?? 0)
          : (worldAgent?.usage.costUsd ?? 0),
        lastUpdatedAt,
        activity,
      })
    }

    buildRow(commanderSessionName, 'Commander', 0, commanderSession)
    for (const session of descendantSessions) {
      const childSessionName = session.name
      const childHasDescendants = descendantSessions.some((candidate) => {
        if (candidate.name === childSessionName) {
          return false
        }
        return resolveParentName(candidate) === childSessionName
      })
      buildRow(childSessionName, childHasDescendants ? 'Lead' : 'Worker', resolveDepth(
        childSessionName,
        sessionsByName,
        commanderSessionName,
      ), session)
    }

    const loadTrend = Array.from({ length: slotCount }, (_, slotIndex) => rows.reduce(
      (total, row) => total + loadContribution(row.activity[slotIndex]),
      0,
    ))
    const approvalCount = countApprovalsForGroup(approvals, commander.id, sessionNames)
    const activeRowCount = rows.filter((row) => row.statusTone === 'active').length
    const blockedRowCount = rows.filter((row) => row.statusTone === 'blocked').length
    const idleRowCount = rows.filter((row) => row.statusTone === 'idle' || row.statusTone === 'stale').length

    return {
      commanderId: commander.id,
      commanderLabel: resolveCommanderLabel(commander),
      commanderState: commander.state,
      accentColor: resolveAccentColor(commander),
      rows,
      approvalCount,
      workerCount: Math.max(0, rows.length - 1),
      activeRowCount,
      blockedRowCount,
      idleRowCount,
      loadTrend,
    }
  }).sort((left, right) => {
    const leftLoad = left.activeRowCount + left.blockedRowCount
    const rightLoad = right.activeRowCount + right.blockedRowCount
    if (leftLoad !== rightLoad) {
      return rightLoad - leftLoad
    }
    if (left.approvalCount !== right.approvalCount) {
      return right.approvalCount - left.approvalCount
    }
    return left.commanderLabel.localeCompare(right.commanderLabel)
  })

  return {
    groups,
    visibleRowCount: groups.reduce((total, group) => total + group.rows.length, 0),
  }
}

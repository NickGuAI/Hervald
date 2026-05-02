export interface HeartbeatConfig {
  intervalMs: number
  messageTemplate: string
}

export interface CommanderHeartbeatState extends HeartbeatConfig {
  lastSentAt: string | null
  intervalOverridden?: boolean
}

export interface HeartbeatConfigPatch {
  intervalMs?: number
  messageTemplate?: string
}

export type HeartbeatPatchParseResult =
  | {
      ok: true
      value: HeartbeatConfigPatch
    }
  | {
      ok: false
      error: string
    }

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000
export const DEFAULT_HEARTBEAT_MESSAGE = `[HEARTBEAT {{timestamp}}]
Check your task list. Current status? What needs to be done next?
If current task is complete, mark it done and pick up the next one.`

const MIN_HEARTBEAT_INTERVAL_MS = 1

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseIntervalMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return null
  }

  const normalized = Math.floor(raw)
  if (normalized < MIN_HEARTBEAT_INTERVAL_MS) {
    return null
  }

  return normalized
}

function parseMessageTemplate(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  return trimmed
}

function parseLastSentAt(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  return trimmed || null
}

function parseIntervalOverridden(raw: unknown): boolean | undefined {
  return raw === true || raw === false
    ? raw
    : undefined
}

export function createDefaultHeartbeatState(): CommanderHeartbeatState {
  return {
    intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
    lastSentAt: null,
  }
}

export function normalizeHeartbeatState(
  raw: unknown,
  fallbackLastSentAt: string | null = null,
): CommanderHeartbeatState {
  const defaults = createDefaultHeartbeatState()

  if (!isObject(raw)) {
    return {
      ...defaults,
      lastSentAt: fallbackLastSentAt,
    }
  }

  const intervalMs = parseIntervalMs(raw.intervalMs) ?? defaults.intervalMs
  const intervalOverridden = parseIntervalOverridden(raw.intervalOverridden)
  // Legacy migration: if an existing session stores a non-default interval and has no explicit
  // override marker, treat it as user-authored so COMMANDER.md defaults do not clobber it.
  const inferredIntervalOverridden = intervalOverridden !== undefined
    ? intervalOverridden
    : intervalMs !== defaults.intervalMs

  return {
    intervalMs,
    messageTemplate: parseMessageTemplate(raw.messageTemplate) ?? defaults.messageTemplate,
    lastSentAt: parseLastSentAt(raw.lastSentAt) ?? fallbackLastSentAt,
    ...(inferredIntervalOverridden ? { intervalOverridden: true } : {}),
  }
}

export function mergeHeartbeatState(
  current: CommanderHeartbeatState,
  patch: HeartbeatConfigPatch,
): CommanderHeartbeatState {
  const intervalOverridden = current.intervalOverridden === true || patch.intervalMs !== undefined
  return {
    intervalMs: patch.intervalMs ?? current.intervalMs,
    messageTemplate: patch.messageTemplate ?? current.messageTemplate,
    lastSentAt: current.lastSentAt,
    ...(intervalOverridden ? { intervalOverridden: true } : {}),
  }
}

export function parseHeartbeatPatch(raw: unknown): HeartbeatPatchParseResult {
  if (!isObject(raw)) {
    return { ok: false, error: 'Invalid heartbeat payload' }
  }

  let intervalMs: number | undefined
  if (raw.intervalMs !== undefined) {
    const parsedIntervalMs = parseIntervalMs(raw.intervalMs)
    if (parsedIntervalMs === null) {
      return {
        ok: false,
        error: `intervalMs must be an integer >= ${MIN_HEARTBEAT_INTERVAL_MS}`,
      }
    }
    intervalMs = parsedIntervalMs
  }

  let messageTemplate: string | undefined
  if (raw.messageTemplate !== undefined) {
    const parsedMessageTemplate = parseMessageTemplate(raw.messageTemplate)
    if (parsedMessageTemplate === null) {
      return { ok: false, error: 'messageTemplate must be a non-empty string' }
    }
    messageTemplate = parsedMessageTemplate
  }

  if (intervalMs === undefined && messageTemplate === undefined) {
    return { ok: false, error: 'At least one heartbeat field must be provided' }
  }

  return {
    ok: true,
    value: {
      intervalMs,
      messageTemplate,
    },
  }
}

export function renderHeartbeatMessage(
  messageTemplate: string,
  timestamp: string,
): string {
  return messageTemplate.split('{{timestamp}}').join(timestamp)
}

export interface CommanderHeartbeatManagerOptions {
  now?: () => Date
  sendHeartbeat(input: {
    commanderId: string
    conversationId: string
    renderedMessage: string
    timestamp: string
    config: HeartbeatConfig
  }): Promise<boolean | 'retryable'>
  onHeartbeatSent?(input: {
    commanderId: string
    conversationId: string
    timestamp: string
    config: HeartbeatConfig
  }): Promise<void> | void
  onHeartbeatError?(input: {
    commanderId: string
    conversationId: string
    error: unknown
  }): void
}

interface HeartbeatLoop {
  commanderId: string
  timer: ReturnType<typeof setInterval>
  config: HeartbeatConfig
  inFlight: boolean
}

function normalizeHeartbeatConfig(config: HeartbeatConfig): HeartbeatConfig {
  return {
    intervalMs: parseIntervalMs(config.intervalMs) ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    messageTemplate: parseMessageTemplate(config.messageTemplate) ?? DEFAULT_HEARTBEAT_MESSAGE,
  }
}

export class CommanderHeartbeatManager {
  private readonly loops = new Map<string, HeartbeatLoop>()
  private readonly now: () => Date

  constructor(private readonly options: CommanderHeartbeatManagerOptions) {
    this.now = options.now ?? (() => new Date())
  }

  start(conversationId: string, commanderId: string, config: HeartbeatConfig): void {
    this.stop(conversationId)

    const normalized = normalizeHeartbeatConfig(config)
    const timer = setInterval(() => {
      void this.tick(conversationId)
    }, normalized.intervalMs)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }

    const loop: HeartbeatLoop = {
      commanderId,
      config: normalized,
      inFlight: false,
      timer,
    }

    this.loops.set(conversationId, loop)
  }

  updateConfig(conversationId: string, commanderId: string, config: HeartbeatConfig): void {
    if (!this.isRunning(conversationId)) {
      return
    }

    this.start(conversationId, commanderId, config)
  }

  stop(conversationId: string): void {
    const loop = this.loops.get(conversationId)
    if (!loop) {
      return
    }

    clearInterval(loop.timer)
    this.loops.delete(conversationId)
  }

  stopForCommander(commanderId: string): void {
    for (const [conversationId, loop] of [...this.loops.entries()]) {
      if (loop.commanderId === commanderId) {
        this.stop(conversationId)
      }
    }
  }

  stopAll(): void {
    for (const conversationId of [...this.loops.keys()]) {
      this.stop(conversationId)
    }
  }

  isRunning(conversationId: string): boolean {
    return this.loops.has(conversationId)
  }

  isInFlight(conversationId: string): boolean {
    return this.loops.get(conversationId)?.inFlight ?? false
  }

  fireManual(conversationId: string, timestamp: string = this.now().toISOString()): boolean {
    const loop = this.loops.get(conversationId)
    if (!loop || loop.inFlight) {
      return false
    }

    this.launchHeartbeat(conversationId, loop, timestamp)
    return true
  }

  private tick(conversationId: string): void {
    const loop = this.loops.get(conversationId)
    if (!loop || loop.inFlight) {
      return
    }

    const timestamp = this.now().toISOString()
    this.launchHeartbeat(conversationId, loop, timestamp)
  }

  private launchHeartbeat(conversationId: string, loop: HeartbeatLoop, timestamp: string): void {
    loop.inFlight = true
    void this.dispatchHeartbeat(conversationId, loop, timestamp).finally(() => {
      const current = this.loops.get(conversationId)
      if (current === loop) {
        current.inFlight = false
      }
    })
  }

  private async dispatchHeartbeat(
    conversationId: string,
    loop: HeartbeatLoop,
    timestamp: string,
  ): Promise<void> {
    const renderedMessage = renderHeartbeatMessage(loop.config.messageTemplate, timestamp)
    try {
      const sent = await this.options.sendHeartbeat({
        commanderId: loop.commanderId,
        conversationId,
        renderedMessage,
        timestamp,
        config: loop.config,
      })

      if (sent === false) {
        this.stop(conversationId)
        return
      }
      if (sent === 'retryable') {
        return
      }

      await this.options.onHeartbeatSent?.({
        commanderId: loop.commanderId,
        conversationId,
        timestamp,
        config: loop.config,
      })
    } catch (error) {
      this.options.onHeartbeatError?.({
        commanderId: loop.commanderId,
        conversationId,
        error,
      })
    }
  }
}

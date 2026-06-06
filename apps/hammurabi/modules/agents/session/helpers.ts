import type { ChildProcess } from 'node:child_process'
import { WebSocket, type RawData } from 'ws'
import { CODEX_SIDECAR_LOG_TAIL_LIMIT, CODEX_SIDECAR_LOG_TEXT_LIMIT, MAX_BUFFER_BYTES } from '../constants.js'
import { asObject } from './state.js'
import type {
  ExternalSession,
  PtySession,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'
import { extractTranscriptUsageUpdate, isLegacyStreamEvent } from '../transcript-records.js'

export function truncateLogText(value: string, maxChars = CODEX_SIDECAR_LOG_TEXT_LIMIT): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

export function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8')
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8')
  }
  return Buffer.from(data).toString('utf8')
}

export function appendToBuffer(session: PtySession, data: string): void {
  session.buffer += data
  if (session.buffer.length > MAX_BUFFER_BYTES) {
    session.buffer = session.buffer.slice(-MAX_BUFFER_BYTES)
  }
}

export function broadcastOutput(session: PtySession, data: string): void {
  const payload = Buffer.from(data)
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload, { binary: true })
    }
  }
}

export function attachWebSocketKeepAlive(
  ws: WebSocket,
  intervalMs: number,
  onStale: () => void,
): () => void {
  let waitingForPong = false
  let stopped = false

  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    clearInterval(interval)
    ws.off('pong', onPong)
    ws.off('close', onCloseOrError)
    ws.off('error', onCloseOrError)
  }

  const onPong = () => {
    waitingForPong = false
  }

  const onCloseOrError = () => {
    stop()
  }

  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return
    }
    if (waitingForPong) {
      onStale()
      ws.terminate()
      stop()
      return
    }

    waitingForPong = true
    ws.ping()
  }, intervalMs)

  ws.on('pong', onPong)
  ws.on('close', onCloseOrError)
  ws.on('error', onCloseOrError)

  return stop
}

export function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return value
}

export function readUsageNumber(usage: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readFiniteNumber(usage[key])
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

export function applyStreamUsageEvent(session: StreamSession, event: StreamJsonEvent): void {
  const usageUpdate = extractTranscriptUsageUpdate(event)
  if (!usageUpdate?.usage) {
    return
  }

  const usage = asObject(usageUpdate.usage)
  if (!usage) {
    return
  }
  const inputTokens = readUsageNumber(usage, ['input_tokens', 'inputTokens', 'input'])
  const outputTokens = readUsageNumber(usage, ['output_tokens', 'outputTokens', 'output'])
  if (usageUpdate.usageIsTotal) {
    if (inputTokens !== undefined) session.usage.inputTokens = inputTokens
    if (outputTokens !== undefined) session.usage.outputTokens = outputTokens
  } else {
    if (inputTokens !== undefined) session.usage.inputTokens += inputTokens
    if (outputTokens !== undefined) session.usage.outputTokens += outputTokens
  }

  if (usageUpdate.totalCostUsd !== undefined) {
    session.usage.costUsd = usageUpdate.totalCostUsd
    return
  }
  if (usageUpdate.costUsd !== undefined) {
    session.usage.costUsd = usageUpdate.costUsd
    return
  }

  if (isLegacyStreamEvent(event) && event.type === 'result') {
    const totalCost = readFiniteNumber(event.total_cost_usd)
    const cost = readFiniteNumber(event.cost_usd)
    if (totalCost !== undefined) {
      session.usage.costUsd = totalCost
    } else if (cost !== undefined) {
      session.usage.costUsd = cost
    }
  }
}

export function appendCodexSidecarTail(tail: string[], lines: string[]): void {
  for (const line of lines) {
    tail.push(line)
  }
  if (tail.length > CODEX_SIDECAR_LOG_TAIL_LIMIT) {
    tail.splice(0, tail.length - CODEX_SIDECAR_LOG_TAIL_LIMIT)
  }
}

export function childProcessHasExited(processToCheck: ChildProcess): boolean {
  if (processToCheck.exitCode === undefined && processToCheck.signalCode === undefined) {
    return true
  }
  return processToCheck.exitCode !== null && processToCheck.exitCode !== undefined
    || processToCheck.signalCode !== null && processToCheck.signalCode !== undefined
}

export function appendJsonReplayEvent(
  session: StreamSession | ExternalSession,
  event: StreamJsonEvent,
): void {
  session.lastEventAt = new Date().toISOString()
  session.events.push(event)
  if (session.events.length > MAX_BUFFER_BYTES) {
    session.events = session.events.slice(-MAX_BUFFER_BYTES)
  }
}

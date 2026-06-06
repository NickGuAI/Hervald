import type { Server } from 'node:http'

export const DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000
export const DEFAULT_HTTP_HEADERS_TIMEOUT_MS = 70_000

interface HttpServerTimeouts {
  keepAliveTimeoutMs: number
  headersTimeoutMs: number
}

type HttpTimeoutEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  'HAMMURABI_HTTP_KEEP_ALIVE_TIMEOUT_MS' | 'HAMMURABI_HTTP_HEADERS_TIMEOUT_MS'
>>

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveHttpServerTimeouts(
  env: HttpTimeoutEnv = process.env,
): HttpServerTimeouts {
  const keepAliveTimeoutMs = parsePositiveInteger(
    env.HAMMURABI_HTTP_KEEP_ALIVE_TIMEOUT_MS,
    DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  )
  const requestedHeadersTimeoutMs = parsePositiveInteger(
    env.HAMMURABI_HTTP_HEADERS_TIMEOUT_MS,
    DEFAULT_HTTP_HEADERS_TIMEOUT_MS,
  )

  return {
    keepAliveTimeoutMs,
    headersTimeoutMs: Math.max(requestedHeadersTimeoutMs, keepAliveTimeoutMs + 1_000),
  }
}

export function configureHttpServerTimeouts(
  server: Server,
  env?: HttpTimeoutEnv,
): HttpServerTimeouts {
  const timeouts = resolveHttpServerTimeouts(env)
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs
  server.headersTimeout = timeouts.headersTimeoutMs
  return timeouts
}

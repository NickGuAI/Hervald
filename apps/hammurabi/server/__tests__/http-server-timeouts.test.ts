import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  configureHttpServerTimeouts,
  DEFAULT_HTTP_HEADERS_TIMEOUT_MS,
  DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  resolveHttpServerTimeouts,
} from '../http-server-timeouts'

describe('HTTP server timeout configuration', () => {
  it('keeps Node target connections alive longer than the default ALB idle window', () => {
    const timeouts = resolveHttpServerTimeouts({})

    expect(timeouts.keepAliveTimeoutMs).toBe(DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT_MS)
    expect(timeouts.keepAliveTimeoutMs).toBeGreaterThan(60_000)
    expect(timeouts.headersTimeoutMs).toBe(DEFAULT_HTTP_HEADERS_TIMEOUT_MS)
    expect(timeouts.headersTimeoutMs).toBeGreaterThan(timeouts.keepAliveTimeoutMs)
  })

  it('keeps headersTimeout above keepAliveTimeout when env overrides are too low', () => {
    expect(resolveHttpServerTimeouts({
      HAMMURABI_HTTP_KEEP_ALIVE_TIMEOUT_MS: '120000',
      HAMMURABI_HTTP_HEADERS_TIMEOUT_MS: '1000',
    })).toEqual({
      keepAliveTimeoutMs: 120_000,
      headersTimeoutMs: 121_000,
    })
  })

  it('applies resolved timeouts to the Node server', () => {
    const server = createServer()

    const timeouts = configureHttpServerTimeouts(server, {
      HAMMURABI_HTTP_KEEP_ALIVE_TIMEOUT_MS: '61000',
      HAMMURABI_HTTP_HEADERS_TIMEOUT_MS: '62000',
    })

    expect(timeouts).toEqual({
      keepAliveTimeoutMs: 61_000,
      headersTimeoutMs: 62_000,
    })
    expect(server.keepAliveTimeout).toBe(61_000)
    expect(server.headersTimeout).toBe(62_000)
  })
})

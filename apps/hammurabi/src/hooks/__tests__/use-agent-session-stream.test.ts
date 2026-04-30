/**
 * Regression tests for apps/hammurabi/src/hooks/use-agent-session-stream.ts
 *
 * Issue #1106 — Hervald commander chat follow-up sends silently dropped when
 * the underlying WebSocket was reconnecting. Fix has three parts:
 *
 *   Bug A  resetMessages() no longer runs unconditionally on every WS-setup
 *          effect re-run — only when sessionName changes. Unit-covered by
 *          CommandRoom composer-gate smoke test.
 *   Bug B  sendInput falls back to POST /api/agents/sessions/:name/message
 *          when the WebSocket is not OPEN instead of silently returning
 *          false. Covered below via the pure postInputViaHttpFallback
 *          helper, which the hook delegates to.
 *   Bug C  Composer gate on streamStatus (in CommandRoom.tsx). Covered by a
 *          separate smoke test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { postInputViaHttpFallback } from '@/hooks/use-agent-session-stream'

describe('postInputViaHttpFallback', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to /api/agents/sessions/:name/message with the trimmed text body', async () => {
    const ok = await postInputViaHttpFallback(
      'commander-test',
      { text: 'hello world' },
      async () => 'test-token',
      fetchSpy as unknown as typeof fetch,
    )

    expect(ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('/api/agents/sessions/commander-test/message')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Authorization']).toBe('Bearer test-token')
    const payload = JSON.parse((init as RequestInit).body as string)
    expect(payload).toEqual({ text: 'hello world', images: undefined })
  })

  it('forwards the images array when present', async () => {
    const ok = await postInputViaHttpFallback(
      'commander-test',
      { text: '', images: [{ mediaType: 'image/png', data: 'base64-data' }] },
      async () => null,
      fetchSpy as unknown as typeof fetch,
    )

    expect(ok).toBe(true)
    const [, init] = fetchSpy.mock.calls[0] ?? []
    const payload = JSON.parse((init as RequestInit).body as string)
    expect(payload.images).toEqual([{ mediaType: 'image/png', data: 'base64-data' }])
  })

  it('omits the Authorization header when no token is available', async () => {
    await postInputViaHttpFallback(
      'commander-test',
      { text: 'hi' },
      async () => null,
      fetchSpy as unknown as typeof fetch,
    )

    const [, init] = fetchSpy.mock.calls[0] ?? []
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('URL-encodes the session name', async () => {
    await postInputViaHttpFallback(
      'weird name/slash',
      { text: 'hi' },
      async () => 'tok',
      fetchSpy as unknown as typeof fetch,
    )

    const [url] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('/api/agents/sessions/weird%20name%2Fslash/message')
  })

  it('returns false on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 502 }))

    const ok = await postInputViaHttpFallback(
      'commander-test',
      { text: 'hi' },
      async () => 'tok',
      fetchSpy as unknown as typeof fetch,
    )

    expect(ok).toBe(false)
  })

  it('returns false on thrown fetch error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'))

    const ok = await postInputViaHttpFallback(
      'commander-test',
      { text: 'hi' },
      async () => 'tok',
      fetchSpy as unknown as typeof fetch,
    )

    expect(ok).toBe(false)
  })

  it('returns false when the token resolver itself throws', async () => {
    const ok = await postInputViaHttpFallback(
      'commander-test',
      { text: 'hi' },
      async () => {
        throw new Error('auth failure')
      },
      fetchSpy as unknown as typeof fetch,
    )

    expect(ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

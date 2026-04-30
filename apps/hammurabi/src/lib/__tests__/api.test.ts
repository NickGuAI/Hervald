// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRequestHeaders,
  fetchJson,
  fetchVoid,
  getAccessToken,
  setAccessTokenResolver,
  setUnauthorizedHandler,
} from '../api'

const API_KEY_STORAGE = 'hammurabi_api_key'

describe('api auth helpers', () => {
  afterEach(() => {
    localStorage.removeItem(API_KEY_STORAGE)
    setAccessTokenResolver(null)
    setUnauthorizedHandler(null)
    vi.unstubAllGlobals()
  })

  it('falls back to the persisted API key when no resolver is registered yet', async () => {
    localStorage.setItem(API_KEY_STORAGE, 'HAMMURABI!')

    const headers = await buildRequestHeaders()

    expect(headers.get('authorization')).toBe('Bearer HAMMURABI!')
    await expect(getAccessToken()).resolves.toBe('HAMMURABI!')
  })

  it('does not override an explicit API key header', async () => {
    localStorage.setItem(API_KEY_STORAGE, 'HAMMURABI!')

    const headers = await buildRequestHeaders({
      'x-hammurabi-api-key': 'hmrb_explicit',
    })

    expect(headers.get('x-hammurabi-api-key')).toBe('hmrb_explicit')
    expect(headers.has('authorization')).toBe(false)
  })

  it('invokes the unauthorized handler on 401 from fetchJson', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"Unauthorized"}', { status: 401 }),
      ),
    )

    await expect(fetchJson('/api/agents/directories')).rejects.toThrow(/401/)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('invokes the unauthorized handler on 401 from fetchVoid', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )

    await expect(fetchVoid('/api/foo', { method: 'DELETE' })).rejects.toThrow(/401/)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the unauthorized handler on 200', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(fetchJson<{ ok: boolean }>('/api/ok')).resolves.toEqual({ ok: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not invoke the unauthorized handler on 403', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"Forbidden"}', { status: 403 }),
      ),
    )

    await expect(fetchJson('/api/forbidden')).rejects.toThrow(/403/)
    expect(handler).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthRecoveryRequiredError,
  buildRequestHeaders,
  fetchJson,
  fetchVoid,
  getAccessToken,
  setAuthMode,
  setAccessTokenResolver,
  setUnauthorizedHandler,
} from '../api'

const API_KEY_STORAGE = 'hammurabi_api_key'

describe('api auth helpers', () => {
  afterEach(() => {
    localStorage.removeItem(API_KEY_STORAGE)
    setAccessTokenResolver(null)
    setAuthMode('anonymous')
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
    setAuthMode('api-key')
    setUnauthorizedHandler(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"Unauthorized"}', { status: 401 }),
      ),
    )

    await expect(fetchJson('/api/agents/directories')).rejects.toThrow(/401/)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      authMode: 'api-key',
      path: '/api/agents/directories',
      phase: 'response',
      status: 401,
    }))
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

  it('does not send an unauthenticated request when Auth0 token recovery is required', async () => {
    const handler = vi.fn()
    const fetchMock = vi.fn()
    setAuthMode('auth0')
    setUnauthorizedHandler(handler)
    setAccessTokenResolver(async () => {
      throw new AuthRecoveryRequiredError('Auth0 session expired; sign in again.', {
        authMode: 'auth0',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJson('/api/modules')).rejects.toThrow(AuthRecoveryRequiredError)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      authMode: 'auth0',
      path: '/api/modules',
      phase: 'token',
    }))
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

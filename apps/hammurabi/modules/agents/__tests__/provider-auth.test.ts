import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HAMMURABI_CODEX_AUTH_JSON_B64,
  ProviderAuthRequiredError,
  ProviderAuthStore,
  buildCodexAuthJson,
  completeProviderOAuthFlow,
  isProviderAuthRequiredText,
  mergeProviderSpawnAuthIntoLaunch,
  prepareProviderSpawnAuth,
  startProviderOAuthFlow,
} from '../provider-auth'

const nowMs = Date.parse('2026-06-02T12:00:00.000Z')

async function createStore(): Promise<{ store: ProviderAuthStore; filePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-auth-'))
  const filePath = path.join(dir, 'provider-secrets.json')
  return { store: new ProviderAuthStore(filePath), filePath }
}

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('provider auth lifecycle', () => {
  it('stores provider tokens with mode 0600 and refreshes before expiry', async () => {
    const { store, filePath } = await createStore()
    await store.putToken('codex', 'commander-1', {
      access: 'old-access',
      refresh: 'refresh-token',
      expiresAt: nowMs + 30_000,
      accountId: 'acct-old',
      email: 'old@example.com',
    })

    const mode = (await stat(filePath)).mode & 0o777
    expect(mode).toBe(0o600)

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      id_token: 'id-token',
      expires_in: 3600,
      account_id: 'acct-new',
      email: 'new@example.com',
    }))

    const providerAuth = await prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-1',
      store,
      env: {},
      fetchImpl,
      nowMs,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(providerAuth.snapshot).toMatchObject({
      provider: 'codex',
      scopeId: 'commander-1',
      status: 'ready',
      authMethod: 'oauth',
      accountEmail: 'new@example.com',
    })
    const authPayload = JSON.parse(
      Buffer.from(providerAuth.env?.[HAMMURABI_CODEX_AUTH_JSON_B64] ?? '', 'base64').toString('utf8'),
    )
    expect(authPayload).toMatchObject({
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'id-token',
        account_id: 'acct-new',
      },
    })
  })

  it('marks managed OAuth providers auth_required when refresh fails', async () => {
    const { store } = await createStore()
    await store.putToken('codex', 'commander-2', {
      access: 'expired-access',
      refresh: 'revoked-refresh',
      expiresAt: nowMs + 10_000,
    })
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, false, 401))

    await expect(prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-2',
      store,
      env: {},
      fetchImpl,
      nowMs,
    })).rejects.toBeInstanceOf(ProviderAuthRequiredError)

    expect(await store.listSnapshots()).toEqual([
      expect.objectContaining({
        provider: 'codex',
        scopeId: 'commander-2',
        status: 'auth_required',
        reauthUrl: expect.stringContaining('/api/agents/provider-auth/codex/reauth'),
      }),
    ])
  })

  it('completes OAuth flows and returns provider scope metadata for unblocking', async () => {
    const { store } = await createStore()
    const flowNowMs = Date.now()
    const flow = await startProviderOAuthFlow({
      provider: 'codex',
      scopeId: 'commander-5',
      host: 'local',
      store,
      env: {
        HAMMURABI_CODEX_OAUTH_AUTHORIZE_URL: 'https://auth.example.test/authorize',
      },
      nowMs: flowNowMs,
    })
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'oauth-access',
      refresh_token: 'oauth-refresh',
      expires_in: 3600,
      account_id: 'acct-oauth',
      email: 'oauth@example.com',
    }))

    const result = await completeProviderOAuthFlow({
      state: flow.state,
      code: 'oauth-code',
      store,
      env: {
        HAMMURABI_CODEX_OAUTH_TOKEN_URL: 'https://auth.example.test/token',
      },
      fetchImpl,
      nowMs: flowNowMs,
    })

    expect(fetchImpl).toHaveBeenCalledWith('https://auth.example.test/token', expect.objectContaining({
      method: 'POST',
    }))
    expect(result).toMatchObject({
      provider: 'codex',
      scopeId: 'commander-5',
      host: 'local',
      token: {
        access: 'oauth-access',
        refresh: 'oauth-refresh',
        accountId: 'acct-oauth',
        email: 'oauth@example.com',
      },
      snapshot: {
        status: 'ready',
        authMethod: 'oauth',
      },
    })
  })

  it('uses a server-reachable OAuth callback URL when provided', async () => {
    const { store } = await createStore()
    const flow = await startProviderOAuthFlow({
      provider: 'codex',
      scopeId: 'commander-remote',
      host: 'ec2',
      store,
      callbackUrl: 'https://hammurabi.example.test/api/agents/provider-auth/oauth/callback',
      env: {
        HAMMURABI_CODEX_OAUTH_AUTHORIZE_URL: 'https://auth.example.test/authorize',
      },
      nowMs,
    })

    const authorizationUrl = new URL(flow.authorizationUrl)
    expect(flow.callbackUrl).toBe('https://hammurabi.example.test/api/agents/provider-auth/oauth/callback')
    expect(authorizationUrl.searchParams.get('redirect_uri'))
      .toBe('https://hammurabi.example.test/api/agents/provider-auth/oauth/callback')
  })

  it('throws auth_required before spawning OAuth providers without credentials', async () => {
    const { store } = await createStore()
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-missing-login-'))

    await expect(prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-missing',
      store,
      env: { CODEX_HOME: path.join(root, 'missing-codex-home') },
      nowMs,
    })).rejects.toBeInstanceOf(ProviderAuthRequiredError)

    expect(await store.listSnapshots()).toEqual([
      expect.objectContaining({
        provider: 'codex',
        scopeId: 'commander-missing',
        status: 'auth_required',
        authMethod: 'missing',
      }),
    ])
  })

  it('does not start Hammurabi OAuth for Claude Code native auth', async () => {
    const { store } = await createStore()

    await expect(startProviderOAuthFlow({
      provider: 'claude',
      scopeId: 'commander-claude',
      host: 'home-mac',
      store,
      nowMs,
    })).rejects.toThrow('claude auth login')
  })

  it('allows Claude Code native CLI auth without a Hammurabi-managed token', async () => {
    const { store } = await createStore()

    await expect(prepareProviderSpawnAuth({
      provider: 'claude',
      scopeId: 'commander-native-login',
      store,
      env: {},
      nowMs,
    })).resolves.toMatchObject({
      snapshot: {
        provider: 'claude',
        status: 'unknown',
        authMethod: 'login',
        detail: expect.stringContaining('claude auth login'),
      },
    })

    const snapshots = await store.listSnapshots()
    expect(snapshots).toEqual([
      expect.objectContaining({
        provider: 'claude',
        scopeId: 'commander-native-login',
        status: 'unknown',
        authMethod: 'login',
      }),
    ])
    expect(snapshots[0]).not.toHaveProperty('reauthUrl')
  })

  it('preserves existing Claude login tokens during migration', async () => {
    const { store } = await createStore()

    await expect(prepareProviderSpawnAuth({
      provider: 'claude',
      scopeId: 'commander-login',
      store,
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'existing-claude-login-token' },
      nowMs,
    })).resolves.toMatchObject({
      snapshot: {
        provider: 'claude',
        status: 'ready',
        authMethod: 'login',
      },
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: 'existing-claude-login-token',
      },
    })
  })

  it('preserves existing local Codex login auth during migration', async () => {
    const { store } = await createStore()
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-codex-login-'))
    const codexHome = path.join(root, '.codex')
    const authJson = {
      OPENAI_API_KEY: null,
      tokens: {
        access_token: 'existing-codex-access',
        refresh_token: 'existing-codex-refresh',
      },
      last_refresh: '2026-06-02T11:00:00.000Z',
    }
    await mkdir(codexHome, { recursive: true })
    await writeFile(path.join(codexHome, 'auth.json'), JSON.stringify(authJson))

    await expect(prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-login',
      store,
      env: { CODEX_HOME: codexHome },
      nowMs,
    })).resolves.toMatchObject({
      snapshot: {
        provider: 'codex',
        status: 'ready',
        authMethod: 'login',
      },
      env: {
        [HAMMURABI_CODEX_AUTH_JSON_B64]: expect.any(String),
      },
    })

    const providerAuth = await prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-login',
      store,
      env: { CODEX_HOME: codexHome },
      nowMs,
    })
    expect(JSON.parse(
      Buffer.from(providerAuth.env?.[HAMMURABI_CODEX_AUTH_JSON_B64] ?? '', 'base64').toString('utf8'),
    )).toEqual(authJson)
  })

  it('injects per-provider spawn credentials without leaking raw values over SSH argv', async () => {
    const providerAuth = {
      provider: 'codex' as const,
      snapshot: {
        provider: 'codex' as const,
        scopeId: 'commander-3',
        host: 'mac-mini',
        status: 'ready' as const,
        authMethod: 'oauth' as const,
        lastCheckedAt: new Date(nowMs).toISOString(),
      },
      env: {
        [HAMMURABI_CODEX_AUTH_JSON_B64]: 'managed-auth-json',
      },
    }

    const prepared = mergeProviderSpawnAuthIntoLaunch(
      { env: {}, sshSendEnvKeys: [] },
      providerAuth,
      { id: 'mac-mini', label: 'Mac Mini', host: 'mac-mini' },
    )

    expect(prepared.sshSendEnvKeys).toEqual(['HAMMURABI_MACHINE_ENV_0000'])
    expect(prepared.env.HAMMURABI_MACHINE_ENV_0000).toBe(`${HAMMURABI_CODEX_AUTH_JSON_B64}=managed-auth-json`)
  })

  it('records API-key-only parity snapshots for Gemini and OpenCode', async () => {
    const { store } = await createStore()

    await expect(prepareProviderSpawnAuth({
      provider: 'gemini',
      scopeId: 'commander-4',
      store,
      env: {},
      nowMs,
    })).resolves.toMatchObject({
      snapshot: {
        provider: 'gemini',
        status: 'unknown',
        authMethod: 'missing',
      },
    })

    await expect(prepareProviderSpawnAuth({
      provider: 'opencode',
      scopeId: 'commander-4',
      store,
      env: { OPENCODE_API_KEY: 'token' },
      nowMs,
    })).resolves.toMatchObject({
      snapshot: {
        provider: 'opencode',
        status: 'ready',
        authMethod: 'api-key',
      },
    })
  })

  it('builds Codex auth.json without touching the global Codex home schema', () => {
    expect(buildCodexAuthJson({
      access: 'access',
      refresh: 'refresh',
      expiresAt: nowMs + 100_000,
      accountId: 'acct',
      email: 'user@example.com',
    })).toMatchObject({
      OPENAI_API_KEY: null,
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        account_id: 'acct',
        email: 'user@example.com',
      },
    })
  })

  it('classifies provider auth failures from stderr and transport text', () => {
    expect(isProviderAuthRequiredText('Codex runtime exited with code 1; stderr: 401 unauthorized')).toBe(true)
    expect(isProviderAuthRequiredText('HTTP/1.1 401 Unauthorized')).toBe(true)
    expect(isProviderAuthRequiredText('invalid_grant while refreshing provider token')).toBe(true)
    expect(isProviderAuthRequiredText('Tool call returned 401 from upstream')).toBe(false)
    expect(isProviderAuthRequiredText('process exited with code 1')).toBe(false)
  })
})

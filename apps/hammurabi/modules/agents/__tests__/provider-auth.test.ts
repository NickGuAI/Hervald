import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HAMMURABI_CODEX_AUTH_JSON_B64,
  ProviderAuthRequiredError,
  ProviderAuthStore,
  buildCodexAuthJson,
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('provider auth lifecycle', () => {
  it('stores legacy provider tokens with mode 0600', async () => {
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
    await expect(store.getToken('codex', 'commander-1')).resolves.toMatchObject({
      access: 'old-access',
      refresh: 'refresh-token',
      accountId: 'acct-old',
      email: 'old@example.com',
    })
  })

  it('does not refresh stale managed Codex tokens after native CLI auth becomes canonical', async () => {
    const { store } = await createStore()
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-stale-token-'))
    await store.putToken('codex', 'commander-2', {
      access: 'expired-access',
      refresh: 'revoked-refresh',
      expiresAt: nowMs + 10_000,
    })
    const fetchImpl = vi.fn()

    await expect(prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-2',
      store,
      env: { CODEX_HOME: path.join(root, 'missing-codex-home') },
      fetchImpl,
      nowMs,
    })).rejects.toBeInstanceOf(ProviderAuthRequiredError)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await store.listSnapshots()).toEqual([
      expect.objectContaining({
        provider: 'codex',
        scopeId: 'commander-2',
        status: 'auth_required',
        authMethod: 'login',
        detail: expect.stringContaining('codex login'),
      }),
    ])
    const [snapshot] = await store.listSnapshots()
    expect(snapshot).not.toHaveProperty('reauthUrl')
  })

  it('migrates persisted Codex OAuth snapshots to native login snapshots', async () => {
    const { store, filePath } = await createStore()
    await writeFile(filePath, `${JSON.stringify({
      version: 1,
      providers: {},
      snapshots: {
        'codex:commander-old:local': {
          provider: 'codex',
          scopeId: 'commander-old',
          host: 'local',
          status: 'auth_required',
          authMethod: 'oauth',
          detail: 'No Hervald-managed provider token is stored.',
          reauthUrl: '/api/agents/provider-auth/codex/reauth?scopeId=commander-old&host=local',
          lastCheckedAt: '2026-06-02T12:00:00.000Z',
        },
      },
    }, null, 2)}\n`)

    const snapshots = await store.listSnapshots()

    expect(snapshots).toEqual([
      expect.objectContaining({
        provider: 'codex',
        scopeId: 'commander-old',
        status: 'auth_required',
        authMethod: 'login',
        detail: expect.stringContaining('codex login status'),
      }),
    ])
    expect(snapshots[0]).not.toHaveProperty('reauthUrl')
  })

  it('does not start Hervald OAuth for Codex native auth', async () => {
    const { store } = await createStore()

    await expect(startProviderOAuthFlow({
      provider: 'codex',
      scopeId: 'commander-5',
      host: 'local',
      store,
      nowMs,
    })).rejects.toThrow('codex login')
  })

  it('records local Codex native login as auth_required when no auth.json is available', async () => {
    const { store } = await createStore()
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-missing-login-'))

    await expect(prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-missing',
      store,
      env: { CODEX_HOME: path.join(root, 'missing-codex-home') },
      nowMs,
    })).rejects.toBeInstanceOf(ProviderAuthRequiredError)

    const snapshots = await store.listSnapshots()
    expect(snapshots).toEqual([
      expect.objectContaining({
        provider: 'codex',
        scopeId: 'commander-missing',
        status: 'auth_required',
        authMethod: 'login',
        detail: expect.stringContaining('codex login status'),
      }),
    ])
    expect(snapshots[0]).not.toHaveProperty('reauthUrl')
  })

  it('lets remote Codex native auth be owned by the target machine', async () => {
    const { store } = await createStore()

    await expect(prepareProviderSpawnAuth({
      provider: 'codex',
      scopeId: 'commander-remote',
      store,
      machine: { id: 'home-mac', label: 'Home Mac', host: 'home-mac' },
      env: {},
      nowMs,
    })).resolves.toMatchObject({
      snapshot: {
        provider: 'codex',
        scopeId: 'commander-remote',
        host: 'home-mac',
        status: 'unknown',
        authMethod: 'login',
        detail: expect.stringContaining('codex login'),
      },
    })

    const snapshots = await store.listSnapshots()
    expect(snapshots[0]).not.toHaveProperty('reauthUrl')
  })

  it('does not start Hervald OAuth for Claude Code native auth', async () => {
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

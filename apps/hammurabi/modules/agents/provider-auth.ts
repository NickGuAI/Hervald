import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveHammurabiDataDir } from '../data-dir.js'
import type { AgentType, MachineConfig } from './types.js'
import type { PreparedMachineLaunchEnvironment } from './machine-credentials.js'
import { HAMMURABI_MACHINE_ENV_PREFIX } from './machine-credentials.js'

const PROVIDER_AUTH_STORE_VERSION = 1
const REFRESH_BUFFER_MS = 60_000
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_REDIRECT_PORT = 1455
export const HAMMURABI_CODEX_AUTH_JSON_B64 = 'HAMMURABI_CODEX_AUTH_JSON_B64'

export type ProviderAuthStatus = 'ready' | 'auth_required' | 'unknown'
export type ProviderAuthMethod = 'oauth' | 'api-key' | 'login' | 'missing'
export type ProviderAuthScopeId = string

export interface ProviderTokenRecord {
  access: string
  refresh?: string
  idToken?: string
  expiresAt: number
  accountId?: string
  email?: string
  updatedAt?: string
}

export interface ProviderAuthSnapshot {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  status: ProviderAuthStatus
  lastCheckedAt: string
  accountId?: string
  accountEmail?: string
  detail?: string
  reauthUrl?: string
  authMethod?: ProviderAuthMethod
}

export interface ProviderSpawnAuth {
  provider: AgentType
  snapshot: ProviderAuthSnapshot
  env?: NodeJS.ProcessEnv
}

export interface PersistedProviderAuthStore {
  version: number
  providers: Record<string, Record<string, ProviderTokenRecord>>
  snapshots: Record<string, ProviderAuthSnapshot>
  oauthFlows?: Record<string, ProviderOAuthFlowRecord>
}

export interface ProviderOAuthFlowRecord {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  state: string
  codeVerifier: string
  codeChallenge: string
  redirectUri: string
  createdAt: string
  expiresAt: string
}

export interface ProviderOAuthStartResult {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  state: string
  authorizationUrl: string
  callbackUrl: string
  expiresAt: string
}

export interface ProviderOAuthCompleteResult {
  provider: AgentType
  scopeId: ProviderAuthScopeId
  host: string
  token: ProviderTokenRecord
  snapshot: ProviderAuthSnapshot
}

export class ProviderAuthRequiredError extends Error {
  readonly code = 'AUTH_REQUIRED'
  readonly provider: AgentType
  readonly snapshot: ProviderAuthSnapshot

  constructor(provider: AgentType, snapshot: ProviderAuthSnapshot, message = 'Provider authentication is required') {
    super(message)
    this.name = 'ProviderAuthRequiredError'
    this.provider = provider
    this.snapshot = snapshot
  }
}

export function defaultProviderAuthStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHammurabiDataDir(env), 'provider-secrets.json')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeTokenRecord(raw: unknown): ProviderTokenRecord | null {
  if (!isObject(raw)) {
    return null
  }
  const access = asTrimmedString(raw.access)
  const expiresAt = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)
    ? raw.expiresAt
    : undefined
  if (!access || expiresAt === undefined) {
    return null
  }
  return {
    access,
    expiresAt,
    ...(asTrimmedString(raw.refresh) ? { refresh: asTrimmedString(raw.refresh) } : {}),
    ...(asTrimmedString(raw.idToken) ? { idToken: asTrimmedString(raw.idToken) } : {}),
    ...(asTrimmedString(raw.accountId) ? { accountId: asTrimmedString(raw.accountId) } : {}),
    ...(asTrimmedString(raw.email) ? { email: asTrimmedString(raw.email) } : {}),
    ...(asTrimmedString(raw.updatedAt) ? { updatedAt: asTrimmedString(raw.updatedAt) } : {}),
  }
}

function normalizeSnapshot(raw: unknown): ProviderAuthSnapshot | null {
  if (!isObject(raw)) {
    return null
  }
  const provider = asTrimmedString(raw.provider) as AgentType | undefined
  const scopeId = asTrimmedString(raw.scopeId)
  const host = asTrimmedString(raw.host)
  const status = raw.status === 'ready' || raw.status === 'auth_required' || raw.status === 'unknown'
    ? raw.status
    : undefined
  const lastCheckedAt = asTrimmedString(raw.lastCheckedAt)
  if (!provider || !scopeId || !host || !status || !lastCheckedAt) {
    return null
  }
  return {
    provider,
    scopeId,
    host,
    status,
    lastCheckedAt,
    ...(asTrimmedString(raw.accountId) ? { accountId: asTrimmedString(raw.accountId) } : {}),
    ...(asTrimmedString(raw.accountEmail) ? { accountEmail: asTrimmedString(raw.accountEmail) } : {}),
    ...(asTrimmedString(raw.detail) ? { detail: asTrimmedString(raw.detail) } : {}),
    ...(asTrimmedString(raw.reauthUrl) ? { reauthUrl: asTrimmedString(raw.reauthUrl) } : {}),
    ...(asTrimmedString(raw.authMethod) ? { authMethod: asTrimmedString(raw.authMethod) as ProviderAuthMethod } : {}),
  }
}

function normalizeFlow(raw: unknown): ProviderOAuthFlowRecord | null {
  if (!isObject(raw)) {
    return null
  }
  const provider = asTrimmedString(raw.provider) as AgentType | undefined
  const scopeId = asTrimmedString(raw.scopeId)
  const host = asTrimmedString(raw.host)
  const state = asTrimmedString(raw.state)
  const codeVerifier = asTrimmedString(raw.codeVerifier)
  const codeChallenge = asTrimmedString(raw.codeChallenge)
  const redirectUri = asTrimmedString(raw.redirectUri)
  const createdAt = asTrimmedString(raw.createdAt)
  const expiresAt = asTrimmedString(raw.expiresAt)
  if (!provider || !scopeId || !host || !state || !codeVerifier || !codeChallenge || !redirectUri || !createdAt || !expiresAt) {
    return null
  }
  return { provider, scopeId, host, state, codeVerifier, codeChallenge, redirectUri, createdAt, expiresAt }
}

function emptyStore(): PersistedProviderAuthStore {
  return { version: PROVIDER_AUTH_STORE_VERSION, providers: {}, snapshots: {} }
}

function normalizeStore(raw: unknown): PersistedProviderAuthStore {
  if (!isObject(raw)) {
    return emptyStore()
  }
  const store = emptyStore()
  if (isObject(raw.providers)) {
    for (const [provider, scopes] of Object.entries(raw.providers)) {
      if (!isObject(scopes)) {
        continue
      }
      for (const [scopeId, token] of Object.entries(scopes)) {
        const normalized = normalizeTokenRecord(token)
        if (!normalized) {
          continue
        }
        store.providers[provider] ??= {}
        store.providers[provider][scopeId] = normalized
      }
    }
  }
  if (isObject(raw.snapshots)) {
    for (const [key, snapshot] of Object.entries(raw.snapshots)) {
      const normalized = normalizeSnapshot(snapshot)
      if (normalized) {
        store.snapshots[key] = normalized
      }
    }
  }
  if (isObject(raw.oauthFlows)) {
    for (const [key, flow] of Object.entries(raw.oauthFlows)) {
      const normalized = normalizeFlow(flow)
      if (normalized && Date.parse(normalized.expiresAt) > Date.now()) {
        store.oauthFlows ??= {}
        store.oauthFlows[key] = normalized
      }
    }
  }
  return store
}

function snapshotKey(provider: AgentType, scopeId: string, host: string): string {
  return `${provider}:${scopeId}:${host}`
}

function flowKey(state: string): string {
  return `state:${state}`
}

function cloneToken(token: ProviderTokenRecord): ProviderTokenRecord {
  return { ...token }
}

function cloneSnapshot(snapshot: ProviderAuthSnapshot): ProviderAuthSnapshot {
  return { ...snapshot }
}

export class ProviderAuthStore {
  private queue = Promise.resolve()

  constructor(private readonly filePath = defaultProviderAuthStorePath()) {}

  async read(): Promise<PersistedProviderAuthStore> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizeStore(JSON.parse(raw) as unknown)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return emptyStore()
      }
      throw error
    }
  }

  async write(store: PersistedProviderAuthStore): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await chmod(this.filePath, 0o600)
  }

  async getToken(provider: AgentType, scopeId: string): Promise<ProviderTokenRecord | null> {
    const store = await this.read()
    const token = store.providers[provider]?.[scopeId]
    return token ? cloneToken(token) : null
  }

  async putToken(provider: AgentType, scopeId: string, token: ProviderTokenRecord): Promise<void> {
    await this.mutate((store) => {
      store.providers[provider] ??= {}
      store.providers[provider][scopeId] = cloneToken(token)
    })
  }

  async listSnapshots(): Promise<ProviderAuthSnapshot[]> {
    const store = await this.read()
    return Object.values(store.snapshots).map(cloneSnapshot)
  }

  async upsertSnapshot(snapshot: ProviderAuthSnapshot): Promise<void> {
    await this.mutate((store) => {
      store.snapshots[snapshotKey(snapshot.provider, snapshot.scopeId, snapshot.host)] = cloneSnapshot(snapshot)
    })
  }

  async createOAuthFlow(flow: ProviderOAuthFlowRecord): Promise<void> {
    await this.mutate((store) => {
      store.oauthFlows ??= {}
      store.oauthFlows[flowKey(flow.state)] = { ...flow }
    })
  }

  async consumeOAuthFlow(state: string): Promise<ProviderOAuthFlowRecord | null> {
    let consumed: ProviderOAuthFlowRecord | null = null
    await this.mutate((store) => {
      const key = flowKey(state)
      const flow = store.oauthFlows?.[key]
      if (flow && Date.parse(flow.expiresAt) > Date.now()) {
        consumed = { ...flow }
      }
      if (store.oauthFlows) {
        delete store.oauthFlows[key]
      }
    })
    return consumed
  }

  private async mutate(mutator: (store: PersistedProviderAuthStore) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const store = await this.read()
      mutator(store)
      await this.write(store)
    })
    this.queue = next.catch(() => undefined)
    await next
  }
}

function providerHost(machine: MachineConfig | undefined): string {
  return machine?.id?.trim() || 'local'
}

export function resolveProviderAuthScopeId(creator: { id?: string; kind?: string } | undefined): string {
  const creatorId = creator?.id?.trim()
  if (creatorId) {
    return creatorId
  }
  return creator?.kind ? `${creator.kind}:default` : 'default'
}

export function buildProviderReauthUrl(provider: AgentType, scopeId: string, host: string): string {
  const params = new URLSearchParams({ scopeId, host })
  return `/api/agents/provider-auth/${encodeURIComponent(provider)}/reauth?${params.toString()}`
}

export function providerUsesManagedOAuth(provider: AgentType): boolean {
  return provider === 'codex'
}

export function buildProviderNativeAuthDetail(provider: AgentType, host: string): string | null {
  if (provider !== 'claude') {
    return null
  }
  const target = host === 'local' ? 'the Hervald host' : `machine "${host}"`
  return `Claude Code uses native CLI authentication. Run \`claude auth status\` on ${target}; if it is not authenticated, run \`claude auth login\` there.`
}

function buildSnapshot(
  provider: AgentType,
  scopeId: string,
  host: string,
  status: ProviderAuthStatus,
  authMethod: ProviderAuthMethod,
  detail?: string,
  token?: ProviderTokenRecord,
): ProviderAuthSnapshot {
  return {
    provider,
    scopeId,
    host,
    status,
    lastCheckedAt: new Date().toISOString(),
    authMethod,
    ...(token?.accountId ? { accountId: token.accountId } : {}),
    ...(token?.email ? { accountEmail: token.email } : {}),
    ...(detail ? { detail } : {}),
    ...(status === 'auth_required' && providerUsesManagedOAuth(provider)
      ? { reauthUrl: buildProviderReauthUrl(provider, scopeId, host) }
      : {}),
  }
}

function hasApiKeyAuth(provider: AgentType, env: NodeJS.ProcessEnv): boolean {
  if (provider === 'claude') {
    return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)
  }
  if (provider === 'codex') {
    return Boolean(env.OPENAI_API_KEY)
  }
  if (provider === 'gemini') {
    return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY)
  }
  if (provider === 'opencode') {
    return Boolean(env.OPENCODE_API_KEY)
  }
  return false
}

function resolveCodexHome(env: NodeJS.ProcessEnv): string {
  const configuredHome = env.CODEX_HOME?.trim()
  return path.resolve(configuredHome && configuredHome.length > 0
    ? configuredHome
    : path.join(env.HOME?.trim() || homedir(), '.codex'))
}

async function readCodexLoginAuthEnv(
  env: NodeJS.ProcessEnv,
  host: string,
): Promise<NodeJS.ProcessEnv | null> {
  if (host !== 'local') {
    return null
  }

  try {
    const authJson = (await readFile(path.join(resolveCodexHome(env), 'auth.json'), 'utf8')).trim()
    if (authJson.length === 0) {
      return null
    }
    const parsed = JSON.parse(authJson) as unknown
    if (!isObject(parsed)) {
      return null
    }
    const tokens = isObject(parsed.tokens) ? parsed.tokens : null
    const hasAuthMaterial = Boolean(
      asTrimmedString(parsed.OPENAI_API_KEY)
      || asTrimmedString(tokens?.access_token),
    )
    if (!hasAuthMaterial) {
      return null
    }
    return {
      [HAMMURABI_CODEX_AUTH_JSON_B64]: Buffer.from(authJson, 'utf8').toString('base64'),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

async function existingLoginAuthEnv(
  provider: AgentType,
  env: NodeJS.ProcessEnv,
  host: string,
): Promise<NodeJS.ProcessEnv | null> {
  if (provider === 'claude' && env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN }
  }
  if (provider === 'codex') {
    return readCodexLoginAuthEnv(env, host)
  }
  return null
}

function refreshTokenUrl(provider: AgentType, env: NodeJS.ProcessEnv): string {
  if (provider === 'codex') {
    return env.HAMMURABI_CODEX_OAUTH_TOKEN_URL?.trim() || CODEX_TOKEN_URL
  }
  throw new Error(`${provider} does not use Hervald-managed OAuth tokens`)
}

function providerClientId(provider: AgentType): string {
  if (provider === 'codex') {
    return CODEX_CLIENT_ID
  }
  throw new Error(`${provider} does not use Hervald-managed OAuth tokens`)
}

function tokenExpiresSoon(token: ProviderTokenRecord, nowMs: number): boolean {
  return token.expiresAt - nowMs < REFRESH_BUFFER_MS
}

interface RefreshResponse {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
  account_id?: unknown
  email?: unknown
}

async function refreshProviderToken(
  provider: AgentType,
  token: ProviderTokenRecord,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<ProviderTokenRecord> {
  if (!token.refresh) {
    throw new Error('Provider refresh token is missing')
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh,
    client_id: providerClientId(provider),
  })

  const response = await fetchImpl(refreshTokenUrl(provider, env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error(`Provider refresh failed with HTTP ${response.status}`)
  }
  const payload = await response.json() as RefreshResponse
  const access = asTrimmedString(payload.access_token)
  if (!access) {
    throw new Error('Provider refresh response did not include an access token')
  }
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : undefined
  const expiresAt = typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at)
    ? payload.expires_at
    : nowMs + ((expiresIn ?? 3600) * 1000)

  const refreshed: ProviderTokenRecord = {
    access,
    expiresAt,
    updatedAt: new Date(nowMs).toISOString(),
  }
  const refresh = asTrimmedString(payload.refresh_token) ?? token.refresh
  const idToken = asTrimmedString(payload.id_token) ?? token.idToken
  const accountId = asTrimmedString(payload.account_id) ?? token.accountId
  const email = asTrimmedString(payload.email) ?? token.email
  if (refresh) refreshed.refresh = refresh
  if (idToken) refreshed.idToken = idToken
  if (accountId) refreshed.accountId = accountId
  if (email) refreshed.email = email
  return refreshed
}

const refreshFlights = new Map<string, Promise<ProviderTokenRecord>>()

async function getValidToken(args: {
  provider: AgentType
  scopeId: string
  store: ProviderAuthStore
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  nowMs: number
}): Promise<ProviderTokenRecord | null> {
  const token = await args.store.getToken(args.provider, args.scopeId)
  if (!token) {
    return null
  }
  if (!tokenExpiresSoon(token, args.nowMs)) {
    return token
  }

  const key = `${args.provider}:${args.scopeId}`
  const existing = refreshFlights.get(key)
  if (existing) {
    return existing
  }
  const flight = refreshProviderToken(args.provider, token, args.env, args.fetchImpl, args.nowMs)
    .then(async (refreshed) => {
      await args.store.putToken(args.provider, args.scopeId, refreshed)
      return refreshed
    })
    .finally(() => {
      refreshFlights.delete(key)
    })
  refreshFlights.set(key, flight)
  return flight
}

export function buildCodexAuthJson(token: ProviderTokenRecord): Record<string, unknown> {
  return {
    OPENAI_API_KEY: null,
    tokens: {
      access_token: token.access,
      ...(token.refresh ? { refresh_token: token.refresh } : {}),
      ...(token.idToken ? { id_token: token.idToken } : {}),
      ...(token.accountId ? { account_id: token.accountId } : {}),
      ...(token.email ? { email: token.email } : {}),
      expires_at: token.expiresAt,
    },
    last_refresh: token.updatedAt ?? new Date().toISOString(),
  }
}

function envForProviderToken(provider: AgentType, token: ProviderTokenRecord): NodeJS.ProcessEnv {
  if (provider === 'codex') {
    return {
      [HAMMURABI_CODEX_AUTH_JSON_B64]: Buffer
        .from(JSON.stringify(buildCodexAuthJson(token)), 'utf8')
        .toString('base64'),
    }
  }
  return {}
}

export async function prepareProviderSpawnAuth(args: {
  provider: AgentType
  scopeId: string
  machine?: MachineConfig
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  nowMs?: number
}): Promise<ProviderSpawnAuth> {
  const env = args.env ?? process.env
  const fetchImpl = args.fetchImpl ?? fetch
  const nowMs = args.nowMs ?? Date.now()
  const host = providerHost(args.machine)

  if (!providerUsesManagedOAuth(args.provider)) {
    if (args.provider === 'claude') {
      if (hasApiKeyAuth(args.provider, env)) {
        const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'api-key')
        await args.store.upsertSnapshot(snapshot)
        return { provider: args.provider, snapshot }
      }
      const loginEnv = await existingLoginAuthEnv(args.provider, env, host)
      if (loginEnv) {
        const snapshot = buildSnapshot(
          args.provider,
          args.scopeId,
          host,
          'ready',
          'login',
          'Using Claude Code CLI credentials from the target environment.',
        )
        await args.store.upsertSnapshot(snapshot)
        return { provider: args.provider, snapshot, env: loginEnv }
      }
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'unknown',
        'login',
        buildProviderNativeAuthDetail(args.provider, host) ?? undefined,
      )
      await args.store.upsertSnapshot(snapshot)
      return { provider: args.provider, snapshot }
    }

    const status = hasApiKeyAuth(args.provider, env) ? 'ready' : 'unknown'
    const detail = status === 'unknown'
      ? `${args.provider} uses API-key auth in Hervald today; no OAuth refresh adapter is available.`
      : undefined
    const snapshot = buildSnapshot(args.provider, args.scopeId, host, status, status === 'ready' ? 'api-key' : 'missing', detail)
    await args.store.upsertSnapshot(snapshot)
    return { provider: args.provider, snapshot }
  }

  if (hasApiKeyAuth(args.provider, env)) {
    const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'api-key')
    await args.store.upsertSnapshot(snapshot)
    return { provider: args.provider, snapshot }
  }

  let token: ProviderTokenRecord | null = null
  try {
    token = await getValidToken({
      provider: args.provider,
      scopeId: args.scopeId,
      store: args.store,
      env,
      fetchImpl,
      nowMs,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'auth_required', 'oauth', detail)
    await args.store.upsertSnapshot(snapshot)
    throw new ProviderAuthRequiredError(args.provider, snapshot, detail)
  }

  if (!token) {
    const loginEnv = await existingLoginAuthEnv(args.provider, env, host)
    if (loginEnv) {
      const snapshot = buildSnapshot(
        args.provider,
        args.scopeId,
        host,
        'ready',
        'login',
        'Using existing host login credentials; re-auth in Hervald to enable managed refresh.',
      )
      await args.store.upsertSnapshot(snapshot)
      return { provider: args.provider, snapshot, env: loginEnv }
    }

    const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'auth_required', 'missing', 'No Hervald-managed provider token is stored.')
    await args.store.upsertSnapshot(snapshot)
    throw new ProviderAuthRequiredError(args.provider, snapshot, snapshot.detail)
  }

  const snapshot = buildSnapshot(args.provider, args.scopeId, host, 'ready', 'oauth', undefined, token)
  await args.store.upsertSnapshot(snapshot)
  return {
    provider: args.provider,
    snapshot,
    env: envForProviderToken(args.provider, token),
  }
}

export function mergeProviderSpawnAuthIntoLaunch(
  prepared: PreparedMachineLaunchEnvironment,
  providerAuth: ProviderSpawnAuth | undefined,
  machine?: MachineConfig,
): PreparedMachineLaunchEnvironment {
  const entries = providerAuth?.env
  if (!entries || Object.keys(entries).length === 0) {
    return prepared
  }
  if (machine?.host) {
    const env: NodeJS.ProcessEnv = { ...prepared.env }
    const sshSendEnvKeys = [...prepared.sshSendEnvKeys]
    let index = sshSendEnvKeys
      .map((key) => key.startsWith(HAMMURABI_MACHINE_ENV_PREFIX)
        ? Number.parseInt(key.slice(HAMMURABI_MACHINE_ENV_PREFIX.length), 10)
        : -1)
      .filter(Number.isFinite)
      .reduce((max, current) => Math.max(max, current), -1) + 1
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) {
        continue
      }
      const transportKey = `${HAMMURABI_MACHINE_ENV_PREFIX}${String(index).padStart(4, '0')}`
      env[transportKey] = `${key}=${value}`
      sshSendEnvKeys.push(transportKey)
      index += 1
    }
    return { ...prepared, env, sshSendEnvKeys }
  }
  return { ...prepared, env: { ...prepared.env, ...entries } }
}

export function isProviderAuthRequiredText(text: string): boolean {
  return [
    /\b(?:invalid_grant|expired_token|invalid_token)\b/iu,
    /\b(?:not logged in|login required)\b/iu,
    /\b(?:authentication|authorization)\s+(?:required|failed|expired)\b/iu,
    /\boauth\b[^\n.]{0,80}\bexpired\b/iu,
    /\btoken\b[^\n.]{0,80}\bexpired\b/iu,
    /\b(?:http\/\d(?:\.\d)?\s*)?401\b[^\n.]{0,80}\b(?:unauthorized|authentication|authorization|auth|token|oauth|login)\b/iu,
    /\b(?:unauthorized|authentication|authorization|auth|token|oauth|login)\b[^\n.]{0,80}\b(?:http\s*)?401\b/iu,
  ].some((pattern) => pattern.test(text))
}

function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function codeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function authorizeUrl(provider: AgentType, env: NodeJS.ProcessEnv): string {
  if (provider === 'codex') {
    return env.HAMMURABI_CODEX_OAUTH_AUTHORIZE_URL?.trim() || CODEX_AUTHORIZE_URL
  }
  throw new Error(`${provider} does not use Hervald-managed OAuth tokens`)
}

function redirectPort(provider: AgentType): number {
  if (provider === 'codex') {
    return CODEX_REDIRECT_PORT
  }
  throw new Error(`${provider} does not use Hervald-managed OAuth tokens`)
}

export async function startProviderOAuthFlow(args: {
  provider: AgentType
  scopeId: string
  host: string
  store: ProviderAuthStore
  callbackUrl?: string
  env?: NodeJS.ProcessEnv
  nowMs?: number
}): Promise<ProviderOAuthStartResult> {
  if (!providerUsesManagedOAuth(args.provider)) {
    const nativeDetail = buildProviderNativeAuthDetail(args.provider, args.host)
    throw new Error(nativeDetail ?? `${args.provider} does not expose a Hervald OAuth flow`)
  }
  const env = args.env ?? process.env
  const nowMs = args.nowMs ?? Date.now()
  const state = randomUrlSafe(24)
  const verifier = randomUrlSafe(48)
  const challenge = codeChallenge(verifier)
  const redirectUri = args.callbackUrl?.trim() || `http://127.0.0.1:${redirectPort(args.provider)}/callback`
  const parsedRedirectUri = new URL(redirectUri)
  if (parsedRedirectUri.protocol !== 'http:' && parsedRedirectUri.protocol !== 'https:') {
    throw new Error('Provider OAuth callback URL must use http or https')
  }
  const expiresAt = new Date(nowMs + (5 * 60_000)).toISOString()
  const authorizationUrl = new URL(authorizeUrl(args.provider, env))
  authorizationUrl.searchParams.set('client_id', providerClientId(args.provider))
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('code_challenge', challenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  authorizationUrl.searchParams.set('state', state)
  if (args.provider === 'codex') {
    authorizationUrl.searchParams.set('scope', 'openid profile email offline_access')
  }

  await args.store.createOAuthFlow({
    provider: args.provider,
    scopeId: args.scopeId,
    host: args.host,
    state,
    codeVerifier: verifier,
    codeChallenge: challenge,
    redirectUri,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt,
  })

  return {
    provider: args.provider,
    scopeId: args.scopeId,
    host: args.host,
    state,
    authorizationUrl: authorizationUrl.toString(),
    callbackUrl: redirectUri,
    expiresAt,
  }
}

export async function completeProviderOAuthFlow(args: {
  state: string
  code: string
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  nowMs?: number
}): Promise<ProviderOAuthCompleteResult> {
  const flow = await args.store.consumeOAuthFlow(args.state)
  if (!flow) {
    throw new Error('OAuth flow is missing or expired')
  }
  if (!providerUsesManagedOAuth(flow.provider)) {
    const nativeDetail = buildProviderNativeAuthDetail(flow.provider, flow.host)
    throw new Error(nativeDetail ?? `${flow.provider} does not expose a Hervald OAuth flow`)
  }
  const env = args.env ?? process.env
  const fetchImpl = args.fetchImpl ?? fetch
  const nowMs = args.nowMs ?? Date.now()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: providerClientId(flow.provider),
    redirect_uri: flow.redirectUri,
    code_verifier: flow.codeVerifier,
  })
  const response = await fetchImpl(refreshTokenUrl(flow.provider, env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${response.status}`)
  }
  const payload = await response.json() as RefreshResponse
  const access = asTrimmedString(payload.access_token)
  if (!access) {
    throw new Error('OAuth token exchange response did not include an access token')
  }
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : 3600
  const token: ProviderTokenRecord = {
    access,
    expiresAt: nowMs + (expiresIn * 1000),
    updatedAt: new Date(nowMs).toISOString(),
  }
  const refresh = asTrimmedString(payload.refresh_token)
  const idToken = asTrimmedString(payload.id_token)
  const accountId = asTrimmedString(payload.account_id)
  const email = asTrimmedString(payload.email)
  if (refresh) token.refresh = refresh
  if (idToken) token.idToken = idToken
  if (accountId) token.accountId = accountId
  if (email) token.email = email
  await args.store.putToken(flow.provider, flow.scopeId, token)
  const snapshot = buildSnapshot(flow.provider, flow.scopeId, flow.host, 'ready', 'oauth', undefined, token)
  await args.store.upsertSnapshot(snapshot)
  return {
    provider: flow.provider,
    scopeId: flow.scopeId,
    host: flow.host,
    token,
    snapshot,
  }
}

const oauthCallbackServers = new Map<number, Server>()
const oauthCallbackServerStarts = new Map<number, Promise<void>>()
const oauthCallbackCompleteHandlers = new Map<number, (result: ProviderOAuthCompleteResult) => Promise<void> | void>()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sendOAuthCallbackHtml(
  res: ServerResponse,
  statusCode: number,
  title: string,
  message: string,
): void {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`)
}

async function handleOAuthCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  args: {
    port: number
    store: ProviderAuthStore
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
  },
): Promise<void> {
  if (req.method !== 'GET' || !req.url) {
    sendOAuthCallbackHtml(res, 404, 'Not found', 'Provider OAuth callback not found.')
    return
  }

  const callbackUrl = new URL(req.url, 'http://127.0.0.1')
  if (callbackUrl.pathname !== '/callback') {
    sendOAuthCallbackHtml(res, 404, 'Not found', 'Provider OAuth callback not found.')
    return
  }

  const state = callbackUrl.searchParams.get('state')?.trim() ?? ''
  const code = callbackUrl.searchParams.get('code')?.trim() ?? ''
  if (!state || !code) {
    sendOAuthCallbackHtml(res, 400, 'Re-auth failed', 'OAuth callback is missing state or code.')
    return
  }

  try {
    const result = await completeProviderOAuthFlow({
      state,
      code,
      store: args.store,
      env: args.env,
      fetchImpl: args.fetchImpl,
    })
    await oauthCallbackCompleteHandlers.get(args.port)?.(result)
    sendOAuthCallbackHtml(
      res,
      200,
      'Re-auth complete',
      'Provider authentication is ready. You can close this tab and return to Hervald.',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth token exchange failed.'
    sendOAuthCallbackHtml(res, 400, 'Re-auth failed', message)
  }
}

export async function ensureProviderOAuthCallbackServer(args: {
  provider: AgentType
  store: ProviderAuthStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  onComplete?: (result: ProviderOAuthCompleteResult) => Promise<void> | void
}): Promise<void> {
  if (!providerUsesManagedOAuth(args.provider)) {
    return
  }

  const port = redirectPort(args.provider)
  if (args.onComplete) {
    oauthCallbackCompleteHandlers.set(port, args.onComplete)
  }
  if (oauthCallbackServers.has(port)) {
    return
  }
  const existingStart = oauthCallbackServerStarts.get(port)
  if (existingStart) {
    await existingStart
    return
  }

  const server = createServer((req, res) => {
    void handleOAuthCallbackRequest(req, res, { ...args, port })
  })
  const start = new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      server.unref?.()
      oauthCallbackServers.set(port, server)
      resolve()
    })
  }).finally(() => {
    oauthCallbackServerStarts.delete(port)
  })

  oauthCallbackServerStarts.set(port, start)
  server.once('close', () => {
    oauthCallbackServers.delete(port)
    oauthCallbackCompleteHandlers.delete(port)
  })
  await start
}

export async function closeProviderOAuthCallbackServers(): Promise<void> {
  const servers = [...oauthCallbackServers.values()]
  oauthCallbackServers.clear()
  oauthCallbackCompleteHandlers.clear()
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
}

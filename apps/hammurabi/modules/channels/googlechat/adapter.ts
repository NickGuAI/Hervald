import { randomUUID } from 'node:crypto'
import { checkAccountInboundPolicy } from '../policy.js'
import type { CommanderChannelBindingStore } from '../store.js'
import type {
  ChannelAdapter,
  ChannelAdapterStatus,
  ChannelInboundDecision,
  ChannelInboundEvent,
  ChannelOutboundPayload,
  ChannelPairingChallenge,
  ChannelRuntime,
  CommanderChannelBinding,
} from '../types.js'
import { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import type { Conversation } from '../../commanders/conversation-store.js'
import {
  GoogleChatApiClient,
  chunkGoogleChatText,
  type GoogleChatMessageClient,
} from './api.js'
import {
  GoogleChatServiceAccountTokenProvider,
  JoseGoogleChatBearerVerifier,
  parseGoogleChatServiceAccountCredential,
  type GoogleChatAccessTokenProvider,
  type GoogleChatBearerVerifier,
} from './auth.js'
import {
  googleChatEventType,
  normalizeGoogleChatMessageEvent,
} from './events.js'
import {
  parseGoogleChatChannelConfig,
  type GoogleChatChannelConfig,
} from './config.js'

interface GoogleChatRuntime extends ChannelRuntime<GoogleChatChannelConfig> {
  startedAt: string
  lastEventAt?: string
  lastError?: string
}

interface GoogleChatChannelMessagePayload {
  provider: 'googlechat'
  accountId: string
  chatType: string
  peerId: string
  displayName: string
  message: string
  mode: 'followup'
  commanderId: string
  groupId?: string
  threadId?: string
  space?: string
  rawTimestamp: string | number
  rawSourceId: string
  metadata?: Record<string, unknown>
}

export interface GoogleChatWebhookRequest {
  authorization?: string
  body: unknown
  accountId?: string
  commanderId?: string
}

export interface GoogleChatWebhookResult {
  status: number
  body: Record<string, unknown>
}

export interface GoogleChatChannelAdapterOptions {
  bindingStore: CommanderChannelBindingStore
  secretsStore?: CommanderSecretsStore
  apiBaseUrl?: string
  internalToken: string
  dataDir: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  bearerVerifier?: GoogleChatBearerVerifier
  tokenProvider?: GoogleChatAccessTokenProvider
  chatClient?: GoogleChatMessageClient
  logger?: Pick<Console, 'error' | 'warn' | 'log'>
  dedupeTtlMs?: number
}

type VerifiedBindingResolution =
  | { kind: 'found'; binding: CommanderChannelBinding; config: GoogleChatChannelConfig }
  | { kind: 'unauthorized' }
  | { kind: 'ambiguous' }

const RECENT_DEDUPE_TTL_MS = 10 * 60 * 1000

function resolveApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.HAMMURABI_API_BASE_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/u, '')
  }
  const port = env.PORT?.trim() || '20001'
  return `http://127.0.0.1:${port}`
}

function bearerFromAuthorization(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  const match = /^Bearer\s+(.+)$/iu.exec(normalized)
  return match?.[1]?.trim() || null
}

function isDirect(event: Pick<ChannelInboundEvent, 'chatType'>): boolean {
  return event.chatType === 'direct' || event.chatType === 'dm'
}

function googleChatMetadata(event: ChannelInboundEvent): Record<string, unknown> {
  const metadata = event.metadata?.googlechat
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const normalized = typeof metadata[key] === 'string' ? metadata[key].trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function metadataBoolean(metadata: Record<string, unknown>, key: string): boolean {
  return metadata[key] === true
}

function checkGoogleChatInboundPolicy(
  binding: CommanderChannelBinding,
  event: ChannelInboundEvent,
  config: GoogleChatChannelConfig = parseGoogleChatChannelConfig(binding.config, binding.accountId),
): ChannelInboundDecision {
  const metadata = googleChatMetadata(event)
  const base = checkAccountInboundPolicy(binding, event)
  const directEmail = isDirect(event) ? metadataString(metadata, 'senderEmail') : undefined
  const decision = !base.allowed && base.reason === 'allowlist-deny' && directEmail
    ? checkAccountInboundPolicy(binding, { ...event, peerId: directEmail })
    : base
  if (!decision.allowed) {
    return decision
  }
  if (!isDirect(event) && config.requireMention && !metadataBoolean(metadata, 'mentionedBot')) {
    return { allowed: false, reason: 'mention-required' }
  }
  return decision
}

function responseBodyError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function isGoogleChatChannelAdapter(adapter: ChannelAdapter | null): adapter is GoogleChatChannelAdapter {
  return Boolean(
    adapter
    && adapter.provider === 'googlechat'
    && typeof (adapter as Partial<GoogleChatChannelAdapter>).handleInteractionEvent === 'function',
  )
}

export class GoogleChatChannelAdapter implements ChannelAdapter<GoogleChatChannelConfig> {
  readonly provider = 'googlechat' as const
  readonly capabilities = {
    voiceNotes: false,
    media: false,
    threading: true,
    typingIndicators: false,
    presence: false,
    reactions: false,
    markdownDialect: 'plain' as const,
  }

  private readonly bindingStore: CommanderChannelBindingStore
  private readonly secretsStore: CommanderSecretsStore
  private readonly apiBaseUrl: string
  private readonly internalToken: string
  private readonly fetchImpl: typeof fetch
  private readonly bearerVerifier: GoogleChatBearerVerifier
  private readonly tokenProvider: GoogleChatAccessTokenProvider
  private readonly chatClient: GoogleChatMessageClient
  private readonly logger: Pick<Console, 'error' | 'warn' | 'log'>
  private readonly dedupeTtlMs: number
  private readonly runtimesByAccount = new Map<string, GoogleChatRuntime>()
  private readonly recentInboundSourceIds = new Map<string, number>()

  constructor(options: GoogleChatChannelAdapterOptions) {
    this.bindingStore = options.bindingStore
    this.secretsStore = options.secretsStore ?? new CommanderSecretsStore()
    const env = options.env ?? process.env
    this.apiBaseUrl = (options.apiBaseUrl ?? resolveApiBaseUrl(env)).replace(/\/+$/u, '')
    this.internalToken = options.internalToken
    this.fetchImpl = options.fetchImpl ?? fetch
    this.bearerVerifier = options.bearerVerifier ?? new JoseGoogleChatBearerVerifier({ fetchImpl: this.fetchImpl })
    this.tokenProvider = options.tokenProvider ?? new GoogleChatServiceAccountTokenProvider({ fetchImpl: this.fetchImpl })
    this.chatClient = options.chatClient ?? new GoogleChatApiClient({ fetchImpl: this.fetchImpl })
    this.logger = options.logger ?? console
    this.dedupeTtlMs = options.dedupeTtlMs ?? RECENT_DEDUPE_TTL_MS
  }

  normalizeInbound(payload: unknown): ChannelInboundEvent {
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (raw.provider === 'googlechat' && typeof raw.peerId === 'string') {
      return {
        provider: 'googlechat',
        accountId: typeof raw.accountId === 'string' ? raw.accountId : 'default',
        chatType: typeof raw.chatType === 'string' ? raw.chatType : 'direct',
        peerId: raw.peerId,
        ...(typeof raw.displayName === 'string' ? { peerDisplayName: raw.displayName } : {}),
        ...(typeof raw.groupId === 'string' ? { groupId: raw.groupId } : {}),
        ...(typeof raw.threadId === 'string' ? { threadId: raw.threadId } : {}),
        ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
        ...(raw.metadata && typeof raw.metadata === 'object' ? { metadata: { ...raw.metadata } as Record<string, unknown> } : {}),
        rawTimestamp: typeof raw.rawTimestamp === 'number' || typeof raw.rawTimestamp === 'string'
          ? raw.rawTimestamp
          : new Date().toISOString(),
        rawSourceId: typeof raw.rawSourceId === 'string' ? raw.rawSourceId : `${Date.now()}`,
      }
    }
    return normalizeGoogleChatMessageEvent(payload, {
      accountId: typeof raw.accountId === 'string' ? raw.accountId : 'default',
    }).event
  }

  async start(binding: CommanderChannelBinding): Promise<GoogleChatRuntime> {
    const config = parseGoogleChatChannelConfig(binding.config, binding.accountId)
    if (!config.credentialRef) {
      throw new Error(`Google Chat channel "${binding.displayName}" is missing a service-account credential`)
    }
    if (!config.webhookAudience) {
      throw new Error(`Google Chat channel "${binding.displayName}" is missing a webhook audience`)
    }
    const runtime: GoogleChatRuntime = {
      provider: 'googlechat',
      accountId: binding.accountId,
      commanderId: binding.commanderId,
      config,
      accountBinding: binding,
      startedAt: new Date().toISOString(),
    }
    this.runtimesByAccount.set(binding.accountId, runtime)
    return runtime
  }

  async stop(runtime: ChannelRuntime<GoogleChatChannelConfig>): Promise<void> {
    const active = this.runtimesByAccount.get(runtime.accountId)
    if (!active || active.commanderId === runtime.commanderId) {
      this.runtimesByAccount.delete(runtime.accountId)
    }
  }

  async beginPairing(input: { provider: 'googlechat'; commanderId: string }): Promise<ChannelPairingChallenge> {
    return {
      provider: 'googlechat',
      commanderId: input.commanderId,
      kind: 'service-account',
      instructions: 'Create the Google Chat binding by saving the service-account credential and webhook audience.',
    }
  }

  async completePairing(): Promise<CommanderChannelBinding> {
    throw new Error('Google Chat pairing is completed by saving the channel binding')
  }

  async send(
    runtime: ChannelRuntime<GoogleChatChannelConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ) {
    try {
      const binding = await this.resolveBinding(runtime, conversation)
      const config = parseGoogleChatChannelConfig(binding.config, binding.accountId)
      if (!config.credentialRef) {
        return { success: false as const, error: 'Google Chat service-account credential is not configured' }
      }
      const credentialJson = await this.secretsStore.getSecret(binding.commanderId, config.credentialRef)
      if (!credentialJson) {
        return { success: false as const, error: 'Google Chat service-account credential is missing from the encrypted vault' }
      }
      const credential = parseGoogleChatServiceAccountCredential(credentialJson)
      const accessToken = await this.tokenProvider.getAccessToken(credential)
      const spaceName = this.resolveOutboundSpace(runtime, conversation)
      if (!spaceName) {
        return { success: false as const, error: `No Google Chat space for conversation "${conversation.id}"` }
      }
      const chunks = chunkGoogleChatText(payload.text ?? '', config.maxMessageBytes)
      if (chunks.length === 0) {
        return { success: false as const, error: 'Google Chat outbound text is empty' }
      }
      const threadName = this.resolveOutboundThread(runtime, conversation)
      const responses: unknown[] = []
      const requestNonce = this.outboundRequestNonce()
      for (const [index, text] of chunks.entries()) {
        responses.push(await this.chatClient.createMessage({
          accessToken,
          spaceName,
          text,
          ...(threadName ? { threadName } : {}),
          requestId: this.outboundRequestId(conversation.id, requestNonce, index),
        }))
      }
      return {
        success: true as const,
        rawResponse: responses.length === 1 ? responses[0] : responses,
      }
    } catch (error) {
      return {
        success: false as const,
        error: responseBodyError(error, 'Failed to send Google Chat message'),
      }
    }
  }

  async checkInboundAllowed(
    runtime: ChannelRuntime<GoogleChatChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<ChannelInboundDecision> {
    const binding = await this.resolveBindingForEvent(runtime, event)
    return checkGoogleChatInboundPolicy(binding, event)
  }

  async getStatus(binding: CommanderChannelBinding): Promise<ChannelAdapterStatus> {
    const runtime = this.runtimesByAccount.get(binding.accountId)
    const config = parseGoogleChatChannelConfig(binding.config, binding.accountId)
    return {
      provider: 'googlechat',
      accountId: binding.accountId,
      transport: 'google-chat-http',
      state: binding.enabled ? (runtime ? 'ready' : 'configured') : 'stopped',
      connected: binding.enabled && config.credentialConfigured && Boolean(config.webhookAudience),
      ...(runtime?.lastError ? { lastError: runtime.lastError } : {}),
      ...(runtime?.lastEventAt ? { lastEventAt: runtime.lastEventAt } : {}),
      metadata: {
        credentialConfigured: config.credentialConfigured,
        webhookAudienceType: config.webhookAudienceType,
        ...(config.projectId ? { projectId: config.projectId } : {}),
        ...(config.projectNumber ? { projectNumber: config.projectNumber } : {}),
      },
    }
  }

  async handleInteractionEvent(input: GoogleChatWebhookRequest): Promise<GoogleChatWebhookResult> {
    const bearer = bearerFromAuthorization(input.authorization)
    if (!bearer) {
      return { status: 401, body: { error: 'Missing Google Chat bearer token' } }
    }

    const verified = await this.resolveVerifiedBinding({
      bearer,
      accountId: input.accountId,
      commanderId: input.commanderId,
    })
    if (verified.kind === 'unauthorized') {
      return { status: 401, body: { error: 'Invalid Google Chat bearer token' } }
    }
    if (verified.kind === 'ambiguous') {
      return {
        status: 409,
        body: { error: 'Google Chat event matches multiple enabled account bindings; specify accountId or commanderId on the webhook URL' },
      }
    }

    const eventType = googleChatEventType(input.body)
    if (eventType === 'ADDED_TO_SPACE') {
      return { status: 200, body: { text: 'Hammurabi is connected to this Google Chat space.' } }
    }
    if (eventType !== 'MESSAGE' && eventType !== 'APP_COMMAND') {
      return { status: 200, body: { accepted: true, ignored: true, eventType } }
    }

    let normalized: ChannelInboundEvent
    try {
      normalized = normalizeGoogleChatMessageEvent(input.body, {
        accountId: verified.binding.accountId,
        config: verified.config,
      }).event
    } catch (error) {
      return { status: 400, body: { error: responseBodyError(error, 'Invalid Google Chat event') } }
    }

    const decision = checkGoogleChatInboundPolicy(verified.binding, normalized, verified.config)
    if (!decision.allowed) {
      return {
        status: 200,
        body: {
          accepted: true,
          delivered: false,
          dropped: true,
          reason: decision.reason ?? 'policy-denied',
        },
      }
    }

    const dedupeKey = `${verified.binding.accountId}:${normalized.rawSourceId}`
    if (this.hasRecentInbound(dedupeKey)) {
      return { status: 200, body: { accepted: true, delivered: false, duplicate: true } }
    }

    const payload = this.toChannelMessagePayload(verified.binding, normalized)
    const response = await this.postInboundPayload(payload)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const runtime = this.runtimesByAccount.get(verified.binding.accountId)
      if (runtime) {
        runtime.lastError = `${response.status} ${text}`.trim()
      }
      this.logger.warn(`[channels/googlechat] Failed to ingest Google Chat message ${normalized.rawSourceId}: ${response.status} ${text}`)
      return {
        status: 502,
        body: {
          error: 'Failed to ingest Google Chat message',
          status: response.status,
        },
      }
    }

    this.markRecentInbound(dedupeKey)
    const runtime = this.runtimesByAccount.get(verified.binding.accountId)
    if (runtime) {
      runtime.lastEventAt = new Date().toISOString()
      runtime.lastError = undefined
    }
    return { status: 200, body: { accepted: true, delivered: true } }
  }

  private async resolveVerifiedBinding(input: {
    bearer: string
    accountId?: string
    commanderId?: string
  }): Promise<VerifiedBindingResolution> {
    const candidates = (await this.bindingStore.list()).filter((binding) => (
      binding.enabled
      && binding.provider === 'googlechat'
      && (!input.accountId || binding.accountId === input.accountId)
      && (!input.commanderId || binding.commanderId === input.commanderId)
    ))
    const verified: Array<{ binding: CommanderChannelBinding; config: GoogleChatChannelConfig }> = []
    for (const binding of candidates) {
      const config = parseGoogleChatChannelConfig(binding.config, binding.accountId)
      if (!config.webhookAudience) {
        continue
      }
      try {
        await this.bearerVerifier.verifyBearerToken(input.bearer, config)
        verified.push({ binding, config })
      } catch {
        // Try the next enabled binding; failure means this token was not for that account config.
      }
    }

    if (verified.length === 0) {
      return { kind: 'unauthorized' }
    }
    if (verified.length > 1) {
      return { kind: 'ambiguous' }
    }
    return { kind: 'found', binding: verified[0]!.binding, config: verified[0]!.config }
  }

  private async resolveBinding(
    runtime: ChannelRuntime<GoogleChatChannelConfig>,
    conversation: Conversation,
  ): Promise<CommanderChannelBinding> {
    const bindings = await this.bindingStore.listByCommander(conversation.commanderId)
    const binding = bindings.find((candidate) => (
      candidate.provider === 'googlechat'
      && candidate.accountId === runtime.accountId
      && candidate.enabled
    ))
    if (!binding) {
      throw new Error(`No Google Chat channel binding for commander "${conversation.commanderId}" and account "${runtime.accountId}"`)
    }
    return binding
  }

  private async resolveBindingForEvent(
    runtime: ChannelRuntime<GoogleChatChannelConfig>,
    event: ChannelInboundEvent,
  ): Promise<CommanderChannelBinding> {
    const bindings = (await this.bindingStore.list()).filter((candidate) => (
      candidate.provider === 'googlechat'
      && candidate.accountId === event.accountId
      && candidate.enabled
    ))
    const binding = bindings.length === 1
      ? bindings[0]
      : bindings.find((candidate) => candidate.commanderId === runtime.commanderId)
    if (!binding) {
      throw new Error(`No unambiguous Google Chat channel binding for account "${event.accountId}"`)
    }
    return binding
  }

  private toChannelMessagePayload(
    binding: CommanderChannelBinding,
    event: ChannelInboundEvent,
  ): GoogleChatChannelMessagePayload {
    const metadata = googleChatMetadata(event)
    return {
      provider: 'googlechat',
      accountId: event.accountId,
      chatType: event.chatType,
      peerId: event.peerId,
      displayName: event.peerDisplayName ?? event.peerId,
      message: event.text ?? '',
      mode: 'followup',
      commanderId: binding.commanderId,
      ...(event.groupId ? { groupId: event.groupId } : {}),
      ...(event.threadId ? { threadId: event.threadId } : {}),
      ...(metadataString(metadata, 'spaceName') ? { space: metadataString(metadata, 'spaceName') } : {}),
      rawTimestamp: event.rawTimestamp,
      rawSourceId: event.rawSourceId,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    }
  }

  private postInboundPayload(payload: GoogleChatChannelMessagePayload): Promise<Response> {
    return this.fetchImpl(`${this.apiBaseUrl}/api/commanders/channel-message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hammurabi-internal-token': this.internalToken,
      },
      body: JSON.stringify(payload),
    })
  }

  private resolveOutboundSpace(
    runtime: ChannelRuntime<GoogleChatChannelConfig>,
    conversation: Conversation,
  ): string | undefined {
    const channelMeta = conversation.channelMeta
    const configured = typeof channelMeta?.space === 'string' && channelMeta.space.trim()
      ? channelMeta.space.trim()
      : undefined
    if (configured) {
      return configured
    }
    const routeTarget = conversation.lastRoute?.to?.trim()
    if (routeTarget?.startsWith('spaces/')) {
      return routeTarget
    }
    const bindingMeta = runtime.surfaceBinding?.config?.channelMeta
    if (bindingMeta && typeof bindingMeta === 'object' && !Array.isArray(bindingMeta)) {
      return metadataString(bindingMeta as Record<string, unknown>, 'space')
    }
    return runtime.surfaceBinding?.peerId?.startsWith('spaces/')
      ? runtime.surfaceBinding.peerId
      : undefined
  }

  private resolveOutboundThread(
    runtime: ChannelRuntime<GoogleChatChannelConfig>,
    conversation: Conversation,
  ): string | undefined {
    return conversation.channelMeta?.threadId
      ?? conversation.lastRoute?.threadId
      ?? runtime.surfaceBinding?.threadId
  }

  private outboundRequestNonce(): string {
    return randomUUID().replace(/[^a-z0-9]+/gu, '').slice(0, 12) || `${Date.now()}`
  }

  private outboundRequestId(conversationId: string, requestNonce: string, index: number): string {
    const safeNonce = requestNonce
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 16) || 'send'
    const suffix = `${safeNonce}-${index}`
    const maxConversationIdLength = Math.max(1, 63 - 'client-'.length - suffix.length - 1)
    const safeConversationId = conversationId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, maxConversationIdLength) || 'conversation'
    return `client-${safeConversationId}-${suffix}`.slice(0, 63)
  }

  private hasRecentInbound(key: string): boolean {
    this.pruneRecentInbound()
    return this.recentInboundSourceIds.has(key)
  }

  private markRecentInbound(key: string): void {
    this.pruneRecentInbound()
    this.recentInboundSourceIds.set(key, Date.now())
  }

  private pruneRecentInbound(): void {
    const expiresBefore = Date.now() - this.dedupeTtlMs
    for (const [key, seenAt] of this.recentInboundSourceIds) {
      if (seenAt < expiresBefore) {
        this.recentInboundSourceIds.delete(key)
      }
    }
  }
}

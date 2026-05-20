import type { Conversation } from '../commanders/conversation-store.js'

export type SeededChannelProvider =
  | 'whatsapp'
  | 'googlechat'
  | 'slack'
  | 'discord'
  | 'email'
  | 'telegram'
  | 'imessage'
  | 'circle'
  | 'matrix'

export type ChannelProvider = SeededChannelProvider | (string & {})
export type CommanderChannelProvider = ChannelProvider

export type ChannelDescriptorFieldKind =
  | 'text'
  | 'password'
  | 'number'
  | 'checkbox'
  | 'textarea'
  | 'select'
  | 'static'

export interface ChannelDescriptorOption {
  value: string
  label: string
}

export interface ChannelDescriptorField {
  key: string
  label: string
  kind: ChannelDescriptorFieldKind
  required?: boolean
  secret?: boolean
  readonly?: boolean
  placeholder?: string
  helperText?: string
  defaultValue?: string | number | boolean | string[]
  section?: string
  configPath?: string
  formKey?: string
  options?: ChannelDescriptorOption[]
  min?: number
}

export interface ChannelProviderPairingDescriptor {
  mode: 'none' | 'qr'
  transport?: string
  statusPollIntervalMs?: number
}

export interface ChannelCommanderBindingDescriptor {
  mode: 'account-commander'
  fieldKey: string
  label: string
  source: 'bindingState.defaultCommanderId'
  emptyLabel?: string
}

export interface ChannelCommanderBindingState {
  defaultCommanderId?: string
  effectiveCommanderId: string
  source: 'binding-state' | 'binding-owner' | 'legacy-provider-config'
}

export interface ChannelProviderDescriptor {
  provider: CommanderChannelProvider
  label: string
  fields: ChannelDescriptorField[]
  configDefaults: Record<string, unknown>
  formDefaults: Record<string, string | boolean>
  credentialFields: string[]
  policyFields: string[]
  pairing: ChannelProviderPairingDescriptor
  commanderBinding: ChannelCommanderBindingDescriptor
  bindingState?: ChannelCommanderBindingState
}

export type ChannelPolicyMode = 'open' | 'allowlist' | 'disabled'

export type ChannelChatType =
  | 'direct'
  | 'group'
  | 'channel'
  | 'forum-topic'
  | 'space'
  | 'post'
  | (string & {})

export type ChannelMarkdownDialect =
  | 'whatsapp'
  | 'slack'
  | 'discord'
  | 'plain'
  | 'html'
  | 'telegram'
  | (string & {})

export interface ChannelCapabilities {
  voiceNotes: boolean
  media: boolean
  threading: boolean
  typingIndicators: boolean
  presence: boolean
  reactions: boolean
  markdownDialect: ChannelMarkdownDialect
}

export interface ChannelAudioInbound {
  buffer: Buffer
  mimeType: string
  durationMs?: number
}

export interface ChannelAudioOutbound {
  buffer: Buffer
  mimeType: string
}

export interface ChannelMediaPayload {
  id?: string
  url?: string
  buffer?: Buffer
  mimeType?: string
  filename?: string
  caption?: string
  metadata?: Record<string, unknown>
}

export interface ChannelInboundEvent {
  provider: ChannelProvider
  accountId: string
  chatType: ChannelChatType
  peerId: string
  peerDisplayName?: string
  groupId?: string
  threadId?: string
  text?: string
  audio?: ChannelAudioInbound
  media?: ChannelMediaPayload[]
  metadata?: Record<string, unknown>
  rawTimestamp: string | number
  rawSourceId: string
}

export interface ChannelOutboundPayload {
  text?: string
  audio?: ChannelAudioOutbound
  media?: ChannelMediaPayload[]
  asReplyTo?: string
}

export interface ChannelPairingChallenge {
  provider: ChannelProvider
  commanderId?: string
  kind?: string
  id?: string
  accountId?: string
  expiresAt?: string
  qrCode?: string
  url?: string
  instructions?: string
  metadata?: Record<string, unknown>
}

export interface ChannelPairingStatus extends ChannelPairingChallenge {
  state: string
  connected: boolean
}

export interface ChannelPairingInput {
  provider: ChannelProvider
  commanderId: string
  accountId?: string
  displayName?: string
  config?: CommanderChannelBindingConfig
  metadata?: Record<string, unknown>
}

export interface ChannelPairingResponse {
  provider?: ChannelProvider
  kind?: string
  challengeId?: string
  code?: string
  token?: string
  accountId?: string
  displayName?: string
  config?: CommanderChannelBindingConfig
  metadata?: Record<string, unknown>
}

export interface ChannelRuntime<TConfig = unknown> {
  provider: ChannelProvider
  accountId: string
  commanderId?: string
  config?: TConfig
  accountBinding?: CommanderChannelBinding
  surfaceBinding?: ChannelSurfaceBinding
  [key: string]: unknown
}

export type ChannelSendResult =
  | { success: true; rawResponse?: unknown }
  | { success: false; error: string; rawResponse?: unknown }

export type ChannelInboundDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason?: string }

export interface ChannelAdapterStatus {
  provider: ChannelProvider
  accountId: string
  state: string
  connected: boolean
  transport?: string
  lastQrAt?: string
  lastError?: string
  lastEventAt?: string
  qrCode?: string
  qrDataUrl?: string
  metadata?: Record<string, unknown>
}

export interface ChannelAdapter<TConfig = unknown> {
  provider: ChannelProvider
  capabilities: ChannelCapabilities
  normalizeInbound?(payload: unknown): ChannelInboundEvent
  start(binding: CommanderChannelBinding): Promise<ChannelRuntime<TConfig>>
  stop(runtime: ChannelRuntime<TConfig>): Promise<void>
  beginPairing(input: ChannelPairingInput): Promise<ChannelPairingChallenge>
  completePairing(
    challenge: ChannelPairingChallenge,
    response: ChannelPairingResponse,
  ): Promise<CommanderChannelBinding>
  getPairingStatus?(challenge: ChannelPairingChallenge): Promise<ChannelPairingStatus>
  send(
    runtime: ChannelRuntime<TConfig>,
    conversation: Conversation,
    payload: ChannelOutboundPayload,
  ): Promise<ChannelSendResult>
  checkInboundAllowed(
    runtime: ChannelRuntime<TConfig>,
    event: ChannelInboundEvent,
  ): Promise<ChannelInboundDecision>
  getStatus?(binding: CommanderChannelBinding): Promise<ChannelAdapterStatus>
}

export interface ChannelBindingPolicyConfig {
  dmPolicy?: ChannelPolicyMode
  groupPolicy?: ChannelPolicyMode
  dmAllowlist?: string[]
  groupAllowlist?: string[]
  allowlist?: string[]
  globalAllowlist?: string[]
  requireMention?: boolean
  [key: string]: unknown
}

export interface CommanderChannelBindingConfig extends ChannelBindingPolicyConfig {
  readonly provider?: ChannelProvider
  // Future provider-specific fields must be adapter-only optional members.
  // Core routing code must not read them to choose provider-specific paths.
}

export interface CommanderChannelBinding {
  id: string
  commanderId: string
  provider: CommanderChannelProvider
  accountId: string
  displayName: string
  enabled: boolean
  config: CommanderChannelBindingConfig
  createdAt: string
  updatedAt: string
}

export interface ChannelSurfaceBinding {
  id: string
  provider: ChannelProvider
  accountId: string
  peerId: string
  threadId?: string
  surfaceKey: string
  commanderId: string
  conversationId: string
  enabled: boolean
  config: Record<string, unknown>
  createdAt: string
}

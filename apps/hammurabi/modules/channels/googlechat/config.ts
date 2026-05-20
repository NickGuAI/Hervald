import { createHash } from 'node:crypto'
import type { CommanderSecretsStore } from '../../commanders/secrets-store.js'
import { GOOGLECHAT_CHANNEL_CONFIG_DEFAULTS } from '../descriptors.js'
import { CommanderChannelValidationError } from '../store.js'
import type {
  ChannelPolicyMode,
  CommanderChannelBindingConfig,
} from '../types.js'

export type GoogleChatWebhookAudienceType = 'url' | 'project-number'

export interface GoogleChatChannelConfig extends CommanderChannelBindingConfig {
  provider: 'googlechat'
  appName?: string
  projectId?: string
  projectNumber?: string
  botUserName?: string
  defaultCommanderId?: string
  webhookAudience: string
  webhookAudienceType: GoogleChatWebhookAudienceType
  credentialRef?: string
  credentialConfigured: boolean
  dmPolicy: ChannelPolicyMode
  groupPolicy: ChannelPolicyMode
  dmAllowlist: string[]
  groupAllowlist: string[]
  allowlist: string[]
  globalAllowlist: string[]
  requireMention: boolean
  maxMessageBytes: number
}

export interface PreparedGoogleChatChannelConfig {
  config: CommanderChannelBindingConfig
  credentialUpdated: boolean
  commitCredential?: () => Promise<void>
}

const POLICY_VALUES = new Set<ChannelPolicyMode>(['open', 'allowlist', 'disabled'])
const AUDIENCE_TYPES = new Set<GoogleChatWebhookAudienceType>(['url', 'project-number'])
const DEFAULT_MAX_MESSAGE_BYTES = GOOGLECHAT_CHANNEL_CONFIG_DEFAULTS.maxMessageBytes
const MAX_MESSAGE_BYTES = 32_000

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  for (const entry of value) {
    const normalized = trimString(entry)
    if (normalized) {
      seen.add(normalized)
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right))
}

function parsePolicy(value: unknown, fallback: ChannelPolicyMode): ChannelPolicyMode {
  return typeof value === 'string' && POLICY_VALUES.has(value as ChannelPolicyMode)
    ? value as ChannelPolicyMode
    : fallback
}

function parseAudienceType(value: unknown): GoogleChatWebhookAudienceType {
  return typeof value === 'string' && AUDIENCE_TYPES.has(value as GoogleChatWebhookAudienceType)
    ? value as GoogleChatWebhookAudienceType
    : GOOGLECHAT_CHANNEL_CONFIG_DEFAULTS.webhookAudienceType
}

function parseMaxMessageBytes(value: unknown): number {
  const raw = typeof value === 'string' && value.trim()
    ? Number(value.trim())
    : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_MAX_MESSAGE_BYTES
  }
  const normalized = Math.trunc(raw)
  if (normalized < 1_024) {
    return DEFAULT_MAX_MESSAGE_BYTES
  }
  return Math.min(normalized, MAX_MESSAGE_BYTES)
}

function normalizeAccountToken(accountId: string): string {
  return accountId.trim().toLowerCase()
}

function normalizeServiceAccountCredentialInput(value: unknown): string | undefined {
  const raw = isObject(value)
    ? JSON.stringify(value)
    : trimString(value)
  if (!raw) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new CommanderChannelValidationError('Service Account JSON must be valid JSON')
  }

  if (
    !isObject(parsed)
    || !trimString(parsed.client_email)
    || !trimString(parsed.private_key)
  ) {
    throw new CommanderChannelValidationError('Service Account JSON must include client_email and private_key')
  }

  return JSON.stringify(parsed)
}

export function googleChatCredentialRef(accountId: string): string {
  const digest = createHash('sha256')
    .update(normalizeAccountToken(accountId))
    .digest('hex')
    .slice(0, 20)
  return `googlechat:${digest}:service-account`
}

export function parseGoogleChatChannelConfig(
  raw: unknown,
  accountId: string,
): GoogleChatChannelConfig {
  const source = isObject(raw) ? raw : {}
  const webhookAudience = trimString(source.webhookAudience)
    ?? trimString(source.audience)
    ?? ''
  const credentialRef = trimString(source.credentialRef)

  return {
    provider: 'googlechat',
    ...(trimString(source.appName) ? { appName: trimString(source.appName) } : {}),
    ...(trimString(source.projectId) ? { projectId: trimString(source.projectId) } : {}),
    ...(trimString(source.projectNumber) ? { projectNumber: trimString(source.projectNumber) } : {}),
    ...(trimString(source.botUserName) ? { botUserName: trimString(source.botUserName) } : {}),
    ...(trimString(source.defaultCommanderId) ? { defaultCommanderId: trimString(source.defaultCommanderId) } : {}),
    webhookAudience,
    webhookAudienceType: parseAudienceType(source.webhookAudienceType),
    ...(credentialRef ? { credentialRef } : {}),
    credentialConfigured: source.credentialConfigured === true || Boolean(credentialRef),
    dmPolicy: parsePolicy(source.dmPolicy, GOOGLECHAT_CHANNEL_CONFIG_DEFAULTS.dmPolicy),
    groupPolicy: parsePolicy(source.groupPolicy, GOOGLECHAT_CHANNEL_CONFIG_DEFAULTS.groupPolicy),
    dmAllowlist: parseStringList(source.dmAllowlist),
    groupAllowlist: parseStringList(source.groupAllowlist),
    allowlist: parseStringList(source.allowlist),
    globalAllowlist: parseStringList(source.globalAllowlist),
    requireMention: parseBoolean(source.requireMention, GOOGLECHAT_CHANNEL_CONFIG_DEFAULTS.requireMention),
    maxMessageBytes: parseMaxMessageBytes(source.maxMessageBytes),
    accountId,
  }
}

export async function prepareGoogleChatChannelConfigForStorage(input: {
  commanderId: string
  accountId: string
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
  secretsStore: CommanderSecretsStore
  deferCredentialWrite?: boolean
}): Promise<PreparedGoogleChatChannelConfig> {
  const incoming = isObject(input.incomingConfig) ? input.incomingConfig : {}
  const existingConfig = stripGoogleChatCredentialInputs(input.existingConfig ?? {})
  const incomingConfig = stripGoogleChatCredentialInputs({ ...incoming } as CommanderChannelBindingConfig)
  delete incomingConfig.credentialRef
  delete incomingConfig.credentialConfigured

  const existing = parseGoogleChatChannelConfig(existingConfig, input.accountId)
  const incomingCredential =
    normalizeServiceAccountCredentialInput(incoming.serviceAccountJson)
    ?? normalizeServiceAccountCredentialInput(incoming.serviceAccountKey)
    ?? normalizeServiceAccountCredentialInput(incoming.credential)
  const credentialRef = incomingCredential
    ? googleChatCredentialRef(input.accountId)
    : existing.credentialRef
  const commitCredential = incomingCredential && credentialRef
    ? () => input.secretsStore.setSecret(input.commanderId, credentialRef, incomingCredential)
    : undefined
  if (commitCredential && !input.deferCredentialWrite) {
    await commitCredential()
  }

  const merged = stripGoogleChatCredentialInputs({
    ...existingConfig,
    ...incomingConfig,
    provider: 'googlechat',
    ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
  } as CommanderChannelBindingConfig)
  const parsed = parseGoogleChatChannelConfig(merged, input.accountId)

  return {
    credentialUpdated: Boolean(incomingCredential),
    ...(commitCredential ? { commitCredential } : {}),
    config: {
      provider: 'googlechat',
      ...(parsed.appName ? { appName: parsed.appName } : {}),
      ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
      ...(parsed.projectNumber ? { projectNumber: parsed.projectNumber } : {}),
      ...(parsed.botUserName ? { botUserName: parsed.botUserName } : {}),
      ...(parsed.defaultCommanderId ? { defaultCommanderId: parsed.defaultCommanderId } : {}),
      webhookAudience: parsed.webhookAudience,
      webhookAudienceType: parsed.webhookAudienceType,
      dmPolicy: parsed.dmPolicy,
      groupPolicy: parsed.groupPolicy,
      dmAllowlist: parsed.dmAllowlist,
      groupAllowlist: parsed.groupAllowlist,
      allowlist: parsed.allowlist,
      globalAllowlist: parsed.globalAllowlist,
      requireMention: parsed.requireMention,
      maxMessageBytes: parsed.maxMessageBytes,
      ...(credentialRef ? { credentialRef, credentialConfigured: true } : { credentialConfigured: false }),
    },
  }
}

export function stripGoogleChatCredentialInputs(config: CommanderChannelBindingConfig): CommanderChannelBindingConfig {
  const next = { ...config }
  delete next.serviceAccountJson
  delete next.serviceAccountKey
  delete next.credential
  delete next.accessToken
  return next
}

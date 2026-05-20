import { getChannelProviderDescriptor } from './descriptors.js'
import { CommanderChannelValidationError } from './store.js'
import type { ChannelDescriptorField, ChannelProvider, CommanderChannelBindingConfig } from './types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function parseStringList(value: unknown, field: string): string[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new CommanderChannelValidationError(`${field} must be an array`)
  }
  const seen = new Set<string>()
  for (const entry of value) {
    const normalized = trimString(entry)
    if (normalized) {
      seen.add(normalized)
    }
  }
  return [...seen]
}

function fieldByKey(descriptor: ReturnType<typeof getChannelProviderDescriptor>, key: string): ChannelDescriptorField {
  const field = descriptor?.fields.find((candidate) => candidate.key === key)
  if (!field) {
    throw new CommanderChannelValidationError(`Channel provider descriptor is missing field "${key}"`)
  }
  return field
}

function validateSelectField(descriptor: ReturnType<typeof getChannelProviderDescriptor>, config: Record<string, unknown>, key: string): void {
  const field = fieldByKey(descriptor, key)
  const value = config[key]
  if (value === undefined) {
    return
  }
  const allowed = new Set((field.options ?? []).map((option) => option.value))
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new CommanderChannelValidationError(`${field.label} must be one of ${[...allowed].join(', ')}`)
  }
}

function hasExistingBindingConfig(existingConfig: CommanderChannelBindingConfig | undefined): boolean {
  return existingConfig !== undefined
}

function validateEmailConfig(input: {
  incomingConfig: Record<string, unknown>
  existingConfig?: CommanderChannelBindingConfig
}): void {
  const descriptor = getChannelProviderDescriptor('email')
  const mergedConfig = {
    ...(isObject(input.existingConfig) ? input.existingConfig : {}),
    ...input.incomingConfig,
  }
  const passwordField = fieldByKey(descriptor, 'appPassword')
  const incomingPassword =
    trimString(input.incomingConfig.appPassword)
    ?? trimString(input.incomingConfig.password)
    ?? trimString(input.incomingConfig.credential)
  if (!incomingPassword && !hasExistingBindingConfig(input.existingConfig)) {
    throw new CommanderChannelValidationError(`${passwordField.label} is required for an enabled email channel.`)
  }

  parseStringList(mergedConfig.allowlist, fieldByKey(descriptor, 'allowlist').label)
  parseStringList(mergedConfig.globalAllowlist, fieldByKey(descriptor, 'globalAllowlist').label)
}

function validateWhatsAppConfig(config: Record<string, unknown>): void {
  const descriptor = getChannelProviderDescriptor('whatsapp')
  if (config.transport !== undefined && config.transport !== 'baileys' && config.transport !== 'cloud') {
    throw new CommanderChannelValidationError('Transport must be one of baileys, cloud')
  }
  validateSelectField(descriptor, config, 'dmPolicy')
  validateSelectField(descriptor, config, 'groupPolicy')
}

function hasGoogleChatCredential(config: Record<string, unknown> | undefined): boolean {
  if (!config) {
    return false
  }
  return Boolean(
    trimString(config.serviceAccountJson)
    ?? (isObject(config.serviceAccountJson) ? 'json-object' : undefined)
    ?? trimString(config.serviceAccountKey)
    ?? (isObject(config.serviceAccountKey) ? 'json-object' : undefined)
    ?? trimString(config.credential)
    ?? (isObject(config.credential) ? 'json-object' : undefined)
    ?? trimString(config.credentialRef)
    ?? (config.credentialConfigured === true ? 'configured' : undefined),
  )
}

function validateGoogleChatConfig(input: {
  incomingConfig: Record<string, unknown>
  existingConfig?: CommanderChannelBindingConfig
}): void {
  const descriptor = getChannelProviderDescriptor('googlechat')
  const mergedConfig = {
    ...(isObject(input.existingConfig) ? input.existingConfig : {}),
    ...input.incomingConfig,
  }
  const credentialField = fieldByKey(descriptor, 'serviceAccountJson')
  if (!hasGoogleChatCredential(input.incomingConfig) && !hasGoogleChatCredential(input.existingConfig)) {
    throw new CommanderChannelValidationError(`${credentialField.label} is required for an enabled Google Chat channel.`)
  }
  if (!trimString(mergedConfig.webhookAudience)) {
    throw new CommanderChannelValidationError('Webhook Audience is required for an enabled Google Chat channel.')
  }
  validateSelectField(descriptor, mergedConfig, 'webhookAudienceType')
  validateSelectField(descriptor, mergedConfig, 'dmPolicy')
  validateSelectField(descriptor, mergedConfig, 'groupPolicy')
  parseStringList(mergedConfig.dmAllowlist, fieldByKey(descriptor, 'dmAllowlist').label)
  parseStringList(mergedConfig.groupAllowlist, fieldByKey(descriptor, 'groupAllowlist').label)
  parseStringList(mergedConfig.globalAllowlist, fieldByKey(descriptor, 'globalAllowlist').label)
  parseStringList(mergedConfig.allowlist, 'Allowlist')
}

export function validateChannelConfigForDescriptor(input: {
  provider: ChannelProvider
  incomingConfig: unknown
  existingConfig?: CommanderChannelBindingConfig
}): void {
  const descriptor = getChannelProviderDescriptor(input.provider)
  if (!descriptor) {
    return
  }
  if (!isObject(input.incomingConfig)) {
    throw new CommanderChannelValidationError('config must be an object')
  }
  if (input.provider === 'email') {
    validateEmailConfig({
      incomingConfig: input.incomingConfig,
      existingConfig: input.existingConfig,
    })
    return
  }
  if (input.provider === 'whatsapp') {
    validateWhatsAppConfig(input.incomingConfig)
    return
  }
  if (input.provider === 'googlechat') {
    validateGoogleChatConfig({
      incomingConfig: input.incomingConfig,
      existingConfig: input.existingConfig,
    })
  }
}

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Conversation } from './conversation-store.js'
import { resolveCommanderDataDir, resolveCommanderPaths } from './paths.js'

export interface VoiceConfig {
  tts: {
    enabled: boolean
    provider: string
    voice: string
  }
  stt: {
    enabled: boolean
    provider: string
    model: string
    prompt?: string
    terms: string[]
  }
}

export type VoiceConfigOverride = Partial<{
  tts: Partial<VoiceConfig['tts']>
  stt: Partial<VoiceConfig['stt']>
}>

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  tts: {
    enabled: false,
    provider: 'openai',
    voice: 'alloy',
  },
  stt: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-transcribe',
    terms: [],
  },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const values = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return values.length > 0 ? values : undefined
}

function mergeTerms(...termLists: Array<readonly string[] | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const terms of termLists) {
    for (const term of terms ?? []) {
      const normalized = term.trim()
      if (!normalized) {
        continue
      }
      const key = normalized.toLocaleLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      output.push(normalized)
    }
  }
  return output
}

export function normalizeVoiceConfig(raw: unknown): VoiceConfigOverride | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const tts = isObject(raw.tts)
    ? {
      enabled: asBoolean(raw.tts.enabled),
      provider: asString(raw.tts.provider),
      voice: asString(raw.tts.voice),
    }
    : undefined
  const stt = isObject(raw.stt)
    ? {
      enabled: asBoolean(raw.stt.enabled),
      provider: asString(raw.stt.provider),
      model: asString(raw.stt.model),
      prompt: asString(raw.stt.prompt),
      terms: asStringArray(raw.stt.terms),
    }
    : undefined

  const cleanedTts = tts
    ? Object.fromEntries(Object.entries(tts).filter(([, value]) => value !== undefined))
    : undefined
  const cleanedStt = stt
    ? Object.fromEntries(Object.entries(stt).filter(([, value]) => value !== undefined))
    : undefined

  const output: VoiceConfigOverride = {}
  if (cleanedTts && Object.keys(cleanedTts).length > 0) {
    output.tts = cleanedTts
  }
  if (cleanedStt && Object.keys(cleanedStt).length > 0) {
    output.stt = cleanedStt
  }
  return output.tts || output.stt ? output : undefined
}

export function mergeVoiceConfig(
  commanderConfig?: VoiceConfigOverride,
  conversationConfig?: VoiceConfigOverride,
): VoiceConfig {
  return {
    tts: {
      enabled: conversationConfig?.tts?.enabled
        ?? commanderConfig?.tts?.enabled
        ?? DEFAULT_VOICE_CONFIG.tts.enabled,
      provider: conversationConfig?.tts?.provider
        ?? commanderConfig?.tts?.provider
        ?? DEFAULT_VOICE_CONFIG.tts.provider,
      voice: conversationConfig?.tts?.voice
        ?? commanderConfig?.tts?.voice
        ?? DEFAULT_VOICE_CONFIG.tts.voice,
    },
    stt: {
      enabled: conversationConfig?.stt?.enabled
        ?? commanderConfig?.stt?.enabled
        ?? DEFAULT_VOICE_CONFIG.stt.enabled,
      provider: conversationConfig?.stt?.provider
        ?? commanderConfig?.stt?.provider
        ?? DEFAULT_VOICE_CONFIG.stt.provider,
      model: conversationConfig?.stt?.model
        ?? commanderConfig?.stt?.model
        ?? DEFAULT_VOICE_CONFIG.stt.model,
      prompt: conversationConfig?.stt?.prompt
        ?? commanderConfig?.stt?.prompt
        ?? DEFAULT_VOICE_CONFIG.stt.prompt,
      terms: mergeTerms(
        DEFAULT_VOICE_CONFIG.stt.terms,
        commanderConfig?.stt?.terms,
        conversationConfig?.stt?.terms,
      ),
    },
  }
}

export function resolveCommanderVoiceConfigPath(
  commanderId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const commanderRoot = resolveCommanderPaths(
    commanderId,
    resolveCommanderDataDir(env),
    env,
  ).commanderRoot
  return path.join(commanderRoot, 'voice.json')
}

export async function loadCommanderVoiceConfig(
  commanderId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceConfigOverride | undefined> {
  try {
    const raw = await readFile(resolveCommanderVoiceConfigPath(commanderId, env), 'utf8')
    return normalizeVoiceConfig(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

export async function resolveConversationVoiceConfig(
  conversation: Pick<Conversation, 'commanderId' | 'voiceConfig'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceConfig> {
  const commanderConfig = await loadCommanderVoiceConfig(conversation.commanderId, env)
  return mergeVoiceConfig(commanderConfig, conversation.voiceConfig)
}

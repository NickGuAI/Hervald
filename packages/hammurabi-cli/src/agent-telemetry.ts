import {
  buildClaudeCodeOtelEnv,
  mergeClaudeCodeEnv,
} from './claude-settings.js'
import {
  buildCodexOtelConfig,
  mergeCodexOtelConfig,
} from './codex-settings.js'
import {
  buildCursorOtelEnv,
  mergeCursorEnv,
} from './cursor-settings.js'
import {
  readHammurabiConfig,
  type HammurabiConfig,
} from './config.js'

type ManagedHammurabiAgent = 'claude-code' | 'codex' | 'cursor'

export interface ApplyManagedAgentTelemetryOptions {
  claudeSettingsPath?: string
  codexConfigPath?: string
  cursorSettingsPath?: string
}

export interface SyncManagedAgentTelemetryOptions extends ApplyManagedAgentTelemetryOptions {
  configPath?: string
}

export interface ManagedAgentTelemetryFailure {
  agent: ManagedHammurabiAgent
  error: Error
}

export interface ManagedAgentTelemetryResult {
  configured: ManagedHammurabiAgent[]
  failed: ManagedAgentTelemetryFailure[]
}

export interface SyncManagedAgentTelemetryResult extends ManagedAgentTelemetryResult {
  config: HammurabiConfig | null
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

export async function applyManagedAgentTelemetryConfig(
  config: HammurabiConfig,
  options: ApplyManagedAgentTelemetryOptions = {},
): Promise<ManagedAgentTelemetryResult> {
  const configured: ManagedHammurabiAgent[] = []
  const failed: ManagedAgentTelemetryFailure[] = []

  if (config.agents.includes('claude-code')) {
    try {
      await mergeClaudeCodeEnv(
        buildClaudeCodeOtelEnv(config.endpoint, config.apiKey),
        options.claudeSettingsPath,
      )
      configured.push('claude-code')
    } catch (error) {
      failed.push({ agent: 'claude-code', error: toError(error) })
    }
  }

  if (config.agents.includes('codex')) {
    try {
      await mergeCodexOtelConfig(
        buildCodexOtelConfig(config.endpoint, config.apiKey),
        options.codexConfigPath,
      )
      configured.push('codex')
    } catch (error) {
      failed.push({ agent: 'codex', error: toError(error) })
    }
  }

  if (config.agents.includes('cursor')) {
    try {
      await mergeCursorEnv(
        buildCursorOtelEnv(config.endpoint, config.apiKey),
        options.cursorSettingsPath,
      )
      configured.push('cursor')
    } catch (error) {
      failed.push({ agent: 'cursor', error: toError(error) })
    }
  }

  return { configured, failed }
}

export async function syncManagedAgentTelemetryFromSavedConfig(
  options: SyncManagedAgentTelemetryOptions = {},
): Promise<SyncManagedAgentTelemetryResult> {
  const config = await readHammurabiConfig(options.configPath)
  if (!config) {
    return {
      config: null,
      configured: [],
      failed: [],
    }
  }

  const result = await applyManagedAgentTelemetryConfig(config, options)
  return {
    config,
    ...result,
  }
}

import {
  createDefaultCommanderRuntimeConfig as createSharedCommanderRuntimeConfig,
  DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS as SHARED_DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS,
  DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS as SHARED_DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS,
  type CommanderRuntimeConfig as SharedCommanderRuntimeConfig,
} from '@gehirn/hammurabi-cli/commander-runtime-config'

export interface CommanderRuntimeConfigSource {
  path: string
  exists: boolean
}

export interface CommanderRuntimeConfig extends SharedCommanderRuntimeConfig {
  source?: CommanderRuntimeConfigSource
}

export const DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS =
  SHARED_DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS
export const DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS =
  SHARED_DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS

export function createDefaultCommanderRuntimeConfig(): CommanderRuntimeConfig {
  return createSharedCommanderRuntimeConfig()
}

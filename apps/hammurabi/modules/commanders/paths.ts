import path from 'node:path'
import { resolveModuleDataDir } from '../data-dir.js'

export const COMMANDER_DATA_DIR_ENV = 'COMMANDER_DATA_DIR'
export const LEGACY_COMMANDER_DATA_DIR_ENV = 'HAMMURABI_COMMANDER_MEMORY_DIR'

export interface CommanderPaths {
  dataDir: string
  commanderRoot: string
  memoryRoot: string
  skillsRoot: string
}

function parseEnvPath(raw: string | undefined): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? path.resolve(trimmed) : null
}

export function resolveCommanderDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = parseEnvPath(env[COMMANDER_DATA_DIR_ENV])
  if (configured) {
    return configured
  }

  const legacy = parseEnvPath(env[LEGACY_COMMANDER_DATA_DIR_ENV])
  if (legacy) {
    return legacy
  }

  return resolveModuleDataDir('commander')
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveCommanderPaths(
  commanderId: string,
  basePath?: string,
  env: NodeJS.ProcessEnv = process.env,
): CommanderPaths {
  if (!UUID_REGEX.test(commanderId)) {
    throw new Error(`Invalid commander ID format: "${commanderId}" — must be a UUID`)
  }
  const dataDir = basePath ? path.resolve(basePath) : resolveCommanderDataDir(env)
  const commanderRoot = path.join(dataDir, commanderId)
  const memoryRoot = path.join(commanderRoot, '.memory')
  const skillsRoot = path.join(commanderRoot, 'skills')
  return {
    dataDir,
    commanderRoot,
    memoryRoot,
    skillsRoot,
  }
}

export function resolveCommanderSessionStorePath(
  dataDir: string = resolveCommanderDataDir(),
): string {
  return path.join(path.resolve(dataDir), 'sessions.json')
}

export function resolveCommanderEmailConfigPath(
  commanderId: string,
  dataDir: string = resolveCommanderDataDir(),
): string {
  return path.join(resolveCommanderPaths(commanderId, dataDir).commanderRoot, 'email-config.json')
}

export function resolveCommanderEmailSeenPath(
  commanderId: string,
  dataDir: string = resolveCommanderDataDir(),
): string {
  return path.join(resolveCommanderPaths(commanderId, dataDir).commanderRoot, 'email-seen.json')
}

export function resolveCommanderNamesPath(
  dataDir: string = resolveCommanderDataDir(),
): string {
  return path.join(path.resolve(dataDir), 'names.json')
}

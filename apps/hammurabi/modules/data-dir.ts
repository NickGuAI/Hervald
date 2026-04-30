import path from 'node:path'
import { homedir } from 'node:os'

/**
 * Resolve the root Hammurabi data directory.
 *
 * Priority: HAMMURABI_DATA_DIR env var > ~/.hammurabi/
 */
export function resolveHammurabiDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HAMMURABI_DATA_DIR?.trim()
  if (configured && configured.length > 0) {
    return path.resolve(configured)
  }
  return path.join(homedir(), '.hammurabi')
}

/**
 * Resolve a module-scoped data directory under the Hammurabi data root.
 *
 * Example: resolveModuleDataDir('telemetry') => ~/.hammurabi/telemetry
 */
export function resolveModuleDataDir(module: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHammurabiDataDir(env), module)
}

export function resolveAutomationDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveModuleDataDir('automation', env)
}

export function resolveLegacyCommandRoomDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveModuleDataDir('command-room', env)
}

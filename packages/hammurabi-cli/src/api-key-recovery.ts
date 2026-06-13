import { homedir } from 'node:os'
import path from 'node:path'
import { defaultConfigPath, normalizeEndpoint } from './config.js'

export const DEFAULT_MASTER_KEY_OPT_IN_ENV = 'HAMMURABI_ALLOW_DEFAULT_MASTER_KEY'

export function defaultKeystorePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HAMMURABI_DATA_DIR?.trim()
  const dataDir = configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(homedir(), '.hammurabi')

  return path.join(dataDir, 'api-keys', 'keys.json')
}

export function formatStoredApiKeyUnauthorizedMessage(input: {
  endpoint: string
  configPath?: string
  keystorePath?: string
}): string {
  const configPath = input.configPath ?? defaultConfigPath()
  const keystorePath = input.keystorePath ?? defaultKeystorePath()
  const endpoint = normalizeEndpoint(input.endpoint)

  return [
    `Stored API key in ${configPath} was rejected by ${endpoint} (401 Unauthorized).`,
    `The Hervald keystore is likely empty or rotated: ${keystorePath}.`,
    `On the server host, restore that file or restart the Hervald installer once with ${DEFAULT_MASTER_KEY_OPT_IN_ENV}=1 so it can print a new bootstrap key and refresh the local CLI config.`,
  ].join(' ')
}

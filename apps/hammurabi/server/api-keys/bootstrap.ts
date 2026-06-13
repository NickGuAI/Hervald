import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { defaultApiKeyStorePath } from './store.js'

export const DEFAULT_MASTER_KEY_OPT_IN_ENV = 'HAMMURABI_ALLOW_DEFAULT_MASTER_KEY'
export const DEFAULT_BOOTSTRAP_KEY_FILENAME = 'bootstrap-key.txt'
export const BOOTSTRAP_MASTER_KEY_EXPIRES_IN_HOURS = 24

const BOOTSTRAP_MASTER_KEY_BYTES = 32

interface BootstrapApiKeyStoreLike {
  hasAnyKeys(): Promise<boolean>
  canSeedDefaultKey(now?: Date): Promise<boolean>
  seedDefaultKey(rawKey: string, label?: string, now?: Date): Promise<string | null>
}

interface BootstrapDefaultMasterKeyOptions {
  env?: NodeJS.ProcessEnv
  keystorePath?: string
  bootstrapKeyPath?: string
  logWarn?: (message: string) => void
  randomBytesImpl?: typeof randomBytes
}

export function defaultBootstrapKeyPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME?.trim() || homedir()
  return path.join(home, '.hammurabi', DEFAULT_BOOTSTRAP_KEY_FILENAME)
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function readBootstrapKeyFile(bootstrapKeyPath: string): Promise<string | null> {
  try {
    const persisted = (await readFile(bootstrapKeyPath, 'utf8')).trim()
    return persisted.length > 0 ? persisted : null
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
}

/**
 * Only enable bootstrap master-key recovery if the operator opted in via
 * HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1. Empty keystores can reuse a prior
 * bootstrap-key file across restarts; expired bootstrap-only keystores mint a
 * replacement so the expired plaintext secret stays expired.
 */
export async function bootstrapDefaultMasterKey(
  store: BootstrapApiKeyStoreLike,
  options: BootstrapDefaultMasterKeyOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env
  const keystorePath = options.keystorePath ?? defaultApiKeyStorePath()
  const bootstrapKeyPath = options.bootstrapKeyPath ?? defaultBootstrapKeyPath(env)
  const logWarn = options.logWarn ?? (() => {})
  const now = new Date()
  const hasKeys = await store.hasAnyKeys()

  if (env[DEFAULT_MASTER_KEY_OPT_IN_ENV]?.trim() !== '1') {
    if (!hasKeys) {
      logWarn(`[api-keys] Keystore is empty: ${keystorePath}`)
      logWarn(
        `[api-keys] No bootstrap master key was seeded. Restart once with ${DEFAULT_MASTER_KEY_OPT_IN_ENV}=1 to generate a random recovery key.`,
      )
      logWarn(
        '[api-keys] The recovery key will be logged once. After retrieval, complete browser onboarding and rotate or revoke that bootstrap key immediately.',
      )
    }
    return null
  }

  if (!(await store.canSeedDefaultKey(now))) {
    return null
  }

  const restoredFromFile = hasKeys ? null : await readBootstrapKeyFile(bootstrapKeyPath)
  const rawKey = restoredFromFile
    ?? (options.randomBytesImpl ?? randomBytes)(BOOTSTRAP_MASTER_KEY_BYTES).toString('hex')
  const seeded = await store.seedDefaultKey(rawKey, 'Bootstrap Master Key', now)
  if (!seeded) {
    return null
  }

  logWarn(
    hasKeys
      ? `[api-keys] Expired bootstrap-only keystore detected: ${keystorePath}`
      : `[api-keys] Empty keystore detected: ${keystorePath}`,
  )
  if (restoredFromFile) {
    try {
      await chmod(bootstrapKeyPath, 0o600)
    } catch {
      // Best-effort only: the key is already on disk and still usable.
    }
    logWarn(
      `[api-keys] Restored the bootstrap master key from ${bootstrapKeyPath} because ${DEFAULT_MASTER_KEY_OPT_IN_ENV}=1.`,
    )
  } else {
    logWarn(
      `[api-keys] Seeded a one-time bootstrap master key because ${DEFAULT_MASTER_KEY_OPT_IN_ENV}=1.`,
    )
    try {
      await mkdir(path.dirname(bootstrapKeyPath), { recursive: true })
      await writeFile(bootstrapKeyPath, `${seeded}\n`, { encoding: 'utf8', mode: 0o600 })
      await chmod(bootstrapKeyPath, 0o600)
      logWarn(`[api-keys] Bootstrap master key saved to ${bootstrapKeyPath}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      logWarn(`[api-keys] Failed to persist bootstrap master key to ${bootstrapKeyPath}: ${detail}`)
      logWarn(`[api-keys] Bootstrap master key (fallback, logged once): ${seeded}`)
    }
  }
  logWarn(
    `[api-keys] Sign in once, complete browser onboarding, then create a permanent API key and rotate or revoke the bootstrap key. It expires after ${BOOTSTRAP_MASTER_KEY_EXPIRES_IN_HOURS} hours.`,
  )

  return seeded
}

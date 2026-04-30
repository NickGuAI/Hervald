import { randomBytes } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { defaultApiKeyStorePath } from './store.js'

export const DEFAULT_MASTER_KEY_OPT_IN_ENV = 'HAMMURABI_ALLOW_DEFAULT_MASTER_KEY'
export const DEFAULT_BOOTSTRAP_KEY_FILENAME = 'bootstrap-key.txt'

const BOOTSTRAP_MASTER_KEY_BYTES = 32

interface BootstrapApiKeyStoreLike {
  hasAnyKeys(): Promise<boolean>
  seedDefaultKey(rawKey: string, label?: string): Promise<string | null>
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

/**
 * On first boot, do not auto-seed a master key unless the operator explicitly
 * opts in for one startup. When they do, emit a one-time random recovery key.
 */
export async function bootstrapDefaultMasterKey(
  store: BootstrapApiKeyStoreLike,
  options: BootstrapDefaultMasterKeyOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env
  const keystorePath = options.keystorePath ?? defaultApiKeyStorePath()
  const bootstrapKeyPath = options.bootstrapKeyPath ?? defaultBootstrapKeyPath(env)
  const logWarn = options.logWarn ?? (() => {})

  if (await store.hasAnyKeys()) {
    return null
  }

  if (env[DEFAULT_MASTER_KEY_OPT_IN_ENV]?.trim() !== '1') {
    logWarn(`[api-keys] Keystore is empty: ${keystorePath}`)
    logWarn(
      `[api-keys] No bootstrap master key was seeded. Restart once with ${DEFAULT_MASTER_KEY_OPT_IN_ENV}=1 to generate a random recovery key.`,
    )
    logWarn(
      '[api-keys] The recovery key will be logged once. After retrieval, run `hammurabi onboard` and rotate or revoke that bootstrap key immediately.',
    )
    return null
  }

  const rawKey = (options.randomBytesImpl ?? randomBytes)(BOOTSTRAP_MASTER_KEY_BYTES).toString('hex')
  const seeded = await store.seedDefaultKey(rawKey, 'Bootstrap Master Key')
  if (!seeded) {
    return null
  }

  logWarn(`[api-keys] Empty keystore detected: ${keystorePath}`)
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
  logWarn(
    '[api-keys] Sign in once, run `hammurabi onboard` if you want managed telemetry, then rotate or revoke the bootstrap key after recovery.',
  )

  return seeded
}

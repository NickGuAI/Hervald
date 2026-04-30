import { access, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  type CommanderRuntimeConfig,
  createDefaultCommanderRuntimeConfig,
  renderCommanderRuntimeConfig,
} from './commander-runtime-config.js'

export interface EnsureCommanderRuntimeConfigOptions {
  filePath?: string
  env?: NodeJS.ProcessEnv
  config?: CommanderRuntimeConfig
}

export interface EnsureCommanderRuntimeConfigResult {
  filePath: string
  created: boolean
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

export function resolveHammurabiDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HAMMURABI_DATA_DIR?.trim()
  if (configured && configured.length > 0) {
    return path.resolve(configured)
  }
  return path.join(homedir(), '.hammurabi')
}

export function defaultCommanderRuntimeConfigPath(
  options: {
    env?: NodeJS.ProcessEnv
  } = {},
): string {
  return path.join(resolveHammurabiDataDir(options.env), 'config.yaml')
}

export async function ensureCommanderRuntimeConfig(
  options: EnsureCommanderRuntimeConfigOptions = {},
): Promise<EnsureCommanderRuntimeConfigResult> {
  const filePath = path.resolve(
    options.filePath ?? defaultCommanderRuntimeConfigPath({ env: options.env }),
  )

  await mkdir(path.dirname(filePath), { recursive: true })

  try {
    await access(filePath)
    return {
      filePath,
      created: false,
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  const config = options.config ?? createDefaultCommanderRuntimeConfig()
  await writeFile(filePath, renderCommanderRuntimeConfig(config), 'utf8')
  return {
    filePath,
    created: true,
  }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveModuleDataDir } from '../data-dir.js'
import type { AppSettings, AppTheme } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings }
}

export function normalizeAppTheme(value: unknown): AppTheme | null {
  return value === 'light' || value === 'dark' ? value : null
}

function defaultSettings(now: () => Date): AppSettings {
  return {
    theme: 'light',
    updatedAt: now().toISOString(),
  }
}

function parsePersistedSettings(raw: unknown, now: () => Date): AppSettings {
  const fallback = defaultSettings(now)
  if (!isRecord(raw)) {
    return fallback
  }

  return {
    theme: normalizeAppTheme(raw.theme) ?? fallback.theme,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0
      ? raw.updatedAt.trim()
      : fallback.updatedAt,
  }
}

export function defaultAppSettingsStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveModuleDataDir('settings', env), 'app-settings.json')
}

export class AppSettingsStore {
  private readonly filePath: string
  private readonly now: () => Date
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(options: { filePath?: string; now?: () => Date } = {}) {
    this.filePath = path.resolve(options.filePath ?? defaultAppSettingsStorePath())
    this.now = options.now ?? (() => new Date())
  }

  async get(): Promise<AppSettings> {
    const persisted = await this.readFromDisk()
    if (persisted) {
      return cloneSettings(persisted)
    }

    const created = defaultSettings(this.now)
    await this.writeToDisk(created)
    return cloneSettings(created)
  }

  async update(input: Partial<Pick<AppSettings, 'theme'>>): Promise<AppSettings> {
    return this.withMutationLock(async () => {
      const current = await this.readFromDisk() ?? defaultSettings(this.now)
      const theme = input.theme === undefined
        ? current.theme
        : normalizeAppTheme(input.theme) ?? current.theme
      const next: AppSettings = {
        ...current,
        theme,
        updatedAt: this.now().toISOString(),
      }

      await this.writeToDisk(next)
      return cloneSettings(next)
    })
  }

  private async readFromDisk(): Promise<AppSettings | null> {
    let rawFile: string
    try {
      rawFile = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawFile) as unknown
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid app settings JSON at "${this.filePath}": ${detail}`)
    }

    return parsePersistedSettings(parsed, this.now)
  }

  private async writeToDisk(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(
      this.filePath,
      `${JSON.stringify(cloneSettings(settings), null, 2)}\n`,
      'utf8',
    )
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

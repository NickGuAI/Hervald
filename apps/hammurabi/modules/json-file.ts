import { readFile, rename } from 'node:fs/promises'
import {
  DEFAULT_BACKUP_RETENTION,
  type AtomicFileWriteOptions,
  writeFileAtomically,
} from './durable-file.js'

export const DEFAULT_JSON_BACKUP_RETENTION = DEFAULT_BACKUP_RETENTION

export interface AtomicJsonWriteOptions extends AtomicFileWriteOptions {
  trailingNewline?: boolean
}

export class CorruptJsonFileError extends Error {
  readonly filePath: string
  readonly quarantinePath: string | null
  readonly parseError: unknown
  readonly quarantineError: unknown

  constructor({
    filePath,
    quarantinePath,
    parseError,
    quarantineError,
  }: {
    filePath: string
    quarantinePath: string | null
    parseError: unknown
    quarantineError?: unknown
  }) {
    super(
      quarantinePath
        ? `Corrupt JSON file at ${filePath}; quarantined to ${quarantinePath}`
        : `Corrupt JSON file at ${filePath}; quarantine failed`,
    )
    this.name = 'CorruptJsonFileError'
    this.filePath = filePath
    this.quarantinePath = quarantinePath
    this.parseError = parseError
    this.quarantineError = quarantineError
  }
}

function buildTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('.', '')
}

function buildCorruptPath(filePath: string): string {
  const stamp = buildTimestamp()
  return `${filePath}.corrupt.${stamp}`
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

async function quarantineCorruptJsonFile(filePath: string): Promise<string> {
  const quarantinePath = buildCorruptPath(filePath)
  await rename(filePath, quarantinePath)
  return quarantinePath
}

export async function readJsonFileFailClosed(filePath: string): Promise<unknown | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }

  try {
    return JSON.parse(raw) as unknown
  } catch (parseError) {
    let quarantinePath: string | null = null
    try {
      quarantinePath = await quarantineCorruptJsonFile(filePath)
    } catch (quarantineError) {
      throw new CorruptJsonFileError({
        filePath,
        quarantinePath,
        parseError,
        quarantineError,
      })
    }
    throw new CorruptJsonFileError({
      filePath,
      quarantinePath,
      parseError,
    })
  }
}

export async function writeTextFileAtomically(
  filePath: string,
  contents: string,
  options: AtomicFileWriteOptions = {},
): Promise<string | null> {
  return writeFileAtomically(filePath, contents, options)
}

export async function writeJsonFileAtomically(
  filePath: string,
  payload: unknown,
  options: AtomicJsonWriteOptions = {},
): Promise<string | null> {
  const suffix = options.trailingNewline ? '\n' : ''
  return writeTextFileAtomically(
    filePath,
    `${JSON.stringify(payload, null, 2)}${suffix}`,
    options,
  )
}

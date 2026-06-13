import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { access, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { resolveModuleDataDir } from '../../modules/data-dir.js'
import {
  readJsonFileFailClosed,
  writeJsonFileAtomically,
  writeTextFileAtomically,
} from '../../modules/json-file.js'

export const OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID = 'openai-realtime-transcription'
export const GEMINI_IMAGE_GENERATION_PROVIDER_ID = 'gemini-image-generation'

const DEFAULT_ENV_KEY_NAME = 'HAMMURABI_SETTINGS_ENCRYPTION_KEY'

interface EncryptedSecretRecord {
  iv: string
  authTag: string
  ciphertext: string
  updatedAt: string
}

interface PersistedSecretCollection {
  secrets: Record<string, EncryptedSecretRecord>
}

export interface ProviderSecretStatus {
  configured: boolean
  updatedAt: string | null
}

export interface ProviderSecretSummary {
  providerId: string
  status: 'configured' | 'absent'
  updatedAt: string | null
}

export interface ProviderSecretsStoreLike {
  getSecretStatus(providerId: string): Promise<ProviderSecretStatus>
  getSecret(providerId: string): Promise<string | null>
  setSecret(providerId: string, value: string, options?: { now?: Date }): Promise<void>
  deleteSecret(providerId: string): Promise<void>
  listSecrets(): Promise<ProviderSecretSummary[]>
}

export interface OpenAITranscriptionKeyStatus extends ProviderSecretStatus {}

export interface OpenAITranscriptionKeyStoreLike {
  getStatus(): Promise<OpenAITranscriptionKeyStatus>
  getOpenAIApiKey(): Promise<string | null>
  setOpenAIApiKey(rawKey: string, options?: { now?: Date }): Promise<void>
  clearOpenAIApiKey(): Promise<boolean>
}

export interface ProviderSecretsStoreOptions {
  filePath?: string
  keyFilePath?: string
  legacyFilePath?: string
  legacyKeyFilePath?: string
  encryptionKey?: string | Buffer
  envKeyName?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isEncryptedSecretRecord(value: unknown): value is EncryptedSecretRecord {
  if (!isObject(value)) {
    return false
  }

  return (
    typeof value.iv === 'string'
    && value.iv.length > 0
    && typeof value.authTag === 'string'
    && value.authTag.length > 0
    && typeof value.ciphertext === 'string'
    && value.ciphertext.length > 0
    && typeof value.updatedAt === 'string'
    && value.updatedAt.length > 0
  )
}

function toPersistedSecretCollection(value: unknown): PersistedSecretCollection {
  if (!isObject(value) || !isObject(value.secrets)) {
    return { secrets: {} }
  }

  const secrets: Record<string, EncryptedSecretRecord> = {}
  for (const [providerId, secret] of Object.entries(value.secrets)) {
    if (isEncryptedSecretRecord(secret)) {
      secrets[providerId] = secret
    }
  }

  return { secrets }
}

function normalizeEncryptionKey(value: string | Buffer): Buffer {
  if (Buffer.isBuffer(value)) {
    if (value.length === 32) {
      return Buffer.from(value)
    }

    return createHash('sha256').update(value).digest()
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error('Encryption key must not be empty')
  }

  if (/^[a-fA-F0-9]{64}$/.test(normalized)) {
    return Buffer.from(normalized, 'hex')
  }

  const base64Candidate = normalized.replace(/\s+/g, '')
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(base64Candidate)) {
    const decoded = Buffer.from(base64Candidate, 'base64')
    if (decoded.length === 32) {
      return decoded
    }
  }

  return createHash('sha256').update(normalized).digest()
}

function encryptSecret(plainText: string, key: Buffer, updatedAt: string): EncryptedSecretRecord {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    updatedAt,
  }
}

function decryptSecret(record: EncryptedSecretRecord, key: Buffer): string | null {
  try {
    const iv = Buffer.from(record.iv, 'base64')
    const authTag = Buffer.from(record.authTag, 'base64')
    const ciphertext = Buffer.from(record.ciphertext, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
  } catch {
    return null
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function inferLegacyPath(filePath: string, basename: string): string {
  return path.join(path.dirname(filePath), basename)
}

export function defaultProviderSecretStorePath(): string {
  return path.join(resolveModuleDataDir('api-keys'), 'provider-secrets.json')
}

export function defaultProviderSecretKeyPath(): string {
  return path.join(resolveModuleDataDir('api-keys'), 'provider-secrets.key')
}

export function defaultTranscriptionSecretStorePath(): string {
  return path.join(resolveModuleDataDir('api-keys'), 'transcription-secrets.json')
}

export function defaultTranscriptionSecretKeyPath(): string {
  return path.join(resolveModuleDataDir('api-keys'), 'transcription-secrets.key')
}

export class ProviderSecretsStore
  implements ProviderSecretsStoreLike, OpenAITranscriptionKeyStoreLike
{
  private mutationQueue: Promise<void> = Promise.resolve()
  private encryptionKeyPromise: Promise<Buffer> | null = null
  private migrationPromise: Promise<void> | null = null
  private readonly filePath: string
  private readonly keyFilePath: string
  private readonly legacyFilePath: string
  private readonly legacyKeyFilePath: string
  private readonly encryptionKeyInput?: string | Buffer
  private readonly envKeyName: string

  constructor(options: ProviderSecretsStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultProviderSecretStorePath()
    this.keyFilePath = options.keyFilePath ?? defaultProviderSecretKeyPath()
    this.legacyFilePath = options.legacyFilePath
      ?? inferLegacyPath(this.filePath, 'transcription-secrets.json')
    this.legacyKeyFilePath = options.legacyKeyFilePath
      ?? inferLegacyPath(this.keyFilePath, 'transcription-secrets.key')
    this.encryptionKeyInput = options.encryptionKey
    this.envKeyName = options.envKeyName ?? DEFAULT_ENV_KEY_NAME
  }

  async getSecretStatus(providerId: string): Promise<ProviderSecretStatus> {
    const normalizedProviderId = this.requireProviderId(providerId)
    const state = await this.readCollectionConsistent()
    const secret = state.secrets[normalizedProviderId]
    return {
      configured: Boolean(secret),
      updatedAt: secret?.updatedAt ?? null,
    }
  }

  async getStatus(): Promise<OpenAITranscriptionKeyStatus> {
    return this.getSecretStatus(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)
  }

  async getSecret(providerId: string): Promise<string | null> {
    const normalizedProviderId = this.requireProviderId(providerId)
    const state = await this.readCollectionConsistent()
    const secret = state.secrets[normalizedProviderId]
    if (!secret) {
      return null
    }

    const encryptionKey = await this.getEncryptionKey()
    return decryptSecret(secret, encryptionKey)
  }

  async getOpenAIApiKey(): Promise<string | null> {
    return this.getSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)
  }

  async setSecret(
    providerId: string,
    value: string,
    options: { now?: Date } = {},
  ): Promise<void> {
    const normalizedProviderId = this.requireProviderId(providerId)
    const normalizedValue = asNonEmptyString(value)
    if (!normalizedValue) {
      throw new Error('Provider secret must not be empty')
    }

    const nowIso = (options.now ?? new Date()).toISOString()
    const encryptionKey = await this.getEncryptionKey()
    const encrypted = encryptSecret(normalizedValue, encryptionKey, nowIso)

    await this.withMutationLock(async () => {
      const state = await this.readCollection()
      state.secrets[normalizedProviderId] = encrypted
      await this.writeCollection(state)
    })
  }

  async setOpenAIApiKey(
    rawKey: string,
    options: { now?: Date } = {},
  ): Promise<void> {
    const normalizedKey = asNonEmptyString(rawKey)
    if (!normalizedKey) {
      throw new Error('OpenAI API key must not be empty')
    }

    await this.setSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID, normalizedKey, options)
  }

  async deleteSecret(providerId: string): Promise<void> {
    await this.deleteSecretInternal(providerId)
  }

  async clearOpenAIApiKey(): Promise<boolean> {
    return this.deleteSecretInternal(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)
  }

  async listSecrets(): Promise<ProviderSecretSummary[]> {
    const state = await this.readCollectionConsistent()
    return Object.entries(state.secrets)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([providerId, secret]) => ({
        providerId,
        status: 'configured',
        updatedAt: secret.updatedAt,
      }))
  }

  private requireProviderId(providerId: string): string {
    const normalized = asNonEmptyString(providerId)
    if (!normalized) {
      throw new Error('providerId is required')
    }
    return normalized
  }

  private async deleteSecretInternal(providerId: string): Promise<boolean> {
    const normalizedProviderId = this.requireProviderId(providerId)
    return this.withMutationLock(async () => {
      const state = await this.readCollection()
      if (!state.secrets[normalizedProviderId]) {
        return false
      }

      delete state.secrets[normalizedProviderId]
      await this.writeCollection(state)
      return true
    })
  }

  private getEncryptionKey(): Promise<Buffer> {
    if (!this.encryptionKeyPromise) {
      this.encryptionKeyPromise = this.resolveEncryptionKey()
    }

    return this.encryptionKeyPromise
  }

  private async resolveEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKeyInput) {
      return normalizeEncryptionKey(this.encryptionKeyInput)
    }

    const envValue = process.env[this.envKeyName]
    if (envValue && envValue.trim().length > 0) {
      return normalizeEncryptionKey(envValue)
    }

    return this.readOrCreateKeyFile()
  }

  private async ensureLegacyMigration(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = this.runLegacyMigration()
    }

    await this.migrationPromise
  }

  private async runLegacyMigration(): Promise<void> {
    await this.migrateLegacyPath(this.legacyFilePath, this.filePath)
    await this.migrateLegacyPath(this.legacyKeyFilePath, this.keyFilePath)
  }

  private async migrateLegacyPath(legacyPath: string, nextPath: string): Promise<void> {
    if (legacyPath === nextPath) {
      return
    }

    const nextExists = await pathExists(nextPath)
    if (nextExists) {
      return
    }

    const legacyExists = await pathExists(legacyPath)
    if (!legacyExists) {
      return
    }

    await mkdir(path.dirname(nextPath), { recursive: true })
    await rename(legacyPath, nextPath)
  }

  private async readOrCreateKeyFile(): Promise<Buffer> {
    await this.ensureLegacyMigration()

    try {
      const existing = await readFile(this.keyFilePath, 'utf8')
      const normalized = existing.trim()
      if (normalized.length === 0) {
        throw new Error('Stored encryption key is empty')
      }
      const parsed = Buffer.from(normalized, 'base64')
      if (parsed.length !== 32) {
        throw new Error('Stored encryption key must decode to 32 bytes')
      }
      return parsed
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    const generated = randomBytes(32)
    await writeTextFileAtomically(this.keyFilePath, `${generated.toString('base64')}\n`, {
      mode: 0o600,
    })
    return generated
  }

  private async readCollectionConsistent(): Promise<PersistedSecretCollection> {
    await this.mutationQueue
    return this.readCollection()
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async readCollection(): Promise<PersistedSecretCollection> {
    await this.ensureLegacyMigration()

    const parsed = await readJsonFileFailClosed(this.filePath)
    if (parsed === null) {
      return { secrets: {} }
    }
    return toPersistedSecretCollection(parsed)
  }

  private async writeCollection(collection: PersistedSecretCollection): Promise<void> {
    await writeJsonFileAtomically(this.filePath, collection, { trailingNewline: true })
  }
}

export class OpenAITranscriptionKeyStore extends ProviderSecretsStore {}

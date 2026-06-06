import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type ConnectionState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode'
import type { ChannelInboundEvent, ChannelOutboundPayload } from '../types.js'
import type { WhatsAppChannelConfig } from './config.js'
import type {
  WhatsAppPairingSession,
  WhatsAppRuntimeStatus,
  WhatsAppTransport,
  WhatsAppTransportHandlers,
  WhatsAppTransportRuntime,
} from './transport.js'

interface BaileysRuntimeOptions {
  accountId: string
  config: WhatsAppChannelConfig
  handlers: WhatsAppTransportHandlers
  challengeId?: string
}

type PairingOutcome =
  | { kind: 'qr'; qrCode: string; qrDataUrl: string }
  | { kind: 'connected' }

const GROUP_JID_SUFFIX = '@g.us'
const DIRECT_JID_SUFFIX = '@s.whatsapp.net'
const LID_JID_SUFFIX = '@lid'
const RECENT_SENT_MESSAGE_LIMIT = 100

function createNoopLogger(): {
  level: string
  child: () => ReturnType<typeof createNoopLogger>
  trace: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  fatal: (...args: unknown[]) => void
} {
  const logger = {
    level: 'silent',
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
  }
  return logger
}

function nowIso(): string {
  return new Date().toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusCode(error: unknown, seen = new Set<unknown>()): number | undefined {
  if (!error || seen.has(error)) {
    return undefined
  }
  seen.add(error)
  const output = (error as { output?: { statusCode?: unknown } } | undefined)?.output
  if (typeof output?.statusCode === 'number') {
    return output.statusCode
  }
  const nestedError = (error as { error?: unknown } | undefined)?.error
  const nestedCause = (error as { cause?: unknown } | undefined)?.cause
  return statusCode(nestedError, seen) ?? statusCode(nestedCause, seen)
}

const credsSaveQueues = new Map<string, Promise<void>>()

async function waitForCredsSaveQueue(authStateDir: string): Promise<void> {
  await credsSaveQueues.get(authStateDir)?.catch(() => undefined)
}

function enqueueCredsSave(authStateDir: string, saveCreds: () => Promise<void> | void): void {
  const previous = credsSaveQueues.get(authStateDir) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => Promise.resolve(saveCreds()))
    .catch(() => undefined)
  credsSaveQueues.set(authStateDir, next)
  void next.finally(() => {
    if (credsSaveQueues.get(authStateDir) === next) {
      credsSaveQueues.delete(authStateDir)
    }
  })
}

function closeWaSocket(sock: WASocket): void {
  try {
    const end = (sock as { end?: (error?: Error) => void }).end
    if (typeof end === 'function') {
      end.call(sock, new Error('Hammurabi WhatsApp socket close'))
      return
    }
    sock.ws?.close()
  } catch {
    // Best-effort socket shutdown.
  }
}

function pairingRestartMessage(error: unknown): string {
  const code = statusCode(error)
  return code
    ? `WhatsApp requested a pairing restart after scan (status ${code}); reconnecting.`
    : 'WhatsApp requested a pairing restart after scan; reconnecting.'
}

function isPairingRestartStatus(error: unknown): boolean {
  return statusCode(error) === 515
}

function isLoggedOutStatus(error: unknown): boolean {
  return statusCode(error) === DisconnectReason.loggedOut
}

async function createBaileysSocket(input: BaileysRuntimeOptions): Promise<WASocket> {
  const authStateDir = input.config.baileys.authStateDir
  if (!authStateDir) {
    throw new Error('Baileys authStateDir is required')
  }
  await waitForCredsSaveQueue(authStateDir)
  const logger = createNoopLogger()
  const { state, saveCreds } = await useMultiFileAuthState(authStateDir)
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger as never),
    },
    version,
    logger: logger as never,
    browser: [input.config.baileys.browserName, 'hammurabi', '1.0.0'],
    markOnlineOnConnect: input.config.baileys.markOnlineOnConnect,
    syncFullHistory: input.config.baileys.syncFullHistory,
  })
  sock.ev.on('creds.update', () => {
    enqueueCredsSave(authStateDir, saveCreds)
  })
  return sock
}

function normalizePeerJid(peerId: string): string {
  const trimmed = peerId.trim()
  if (!trimmed) {
    throw new Error('WhatsApp peer id is required')
  }
  if (trimmed.includes('@')) {
    return trimmed
  }
  const digits = trimmed.replace(/[^\d]/gu, '')
  return digits ? `${digits}${DIRECT_JID_SUFFIX}` : trimmed
}

function normalizeJid(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return undefined
  }
  return trimmed.replace(/:\d+@/u, '@')
}

function jidLocalPart(value: unknown): string | undefined {
  const normalized = normalizeJid(value)
  if (!normalized) {
    return undefined
  }
  const atIndex = normalized.indexOf('@')
  return atIndex >= 0 ? normalized.slice(0, atIndex) : normalized
}

function isDirectWhatsAppJid(value: unknown): boolean {
  const normalized = normalizeJid(value)
  return Boolean(normalized?.endsWith(DIRECT_JID_SUFFIX) || normalized?.endsWith(LID_JID_SUFFIX))
}

function socketSelfJidCandidates(sock: WASocket): Set<string> {
  const user = (sock as { user?: { id?: string; jid?: string; lid?: string } }).user
  const candidates = new Set<string>()
  for (const value of [user?.id, user?.jid, user?.lid]) {
    const normalized = normalizeJid(value)
    const localPart = jidLocalPart(value)
    if (normalized) {
      candidates.add(normalized)
    }
    if (localPart) {
      candidates.add(localPart)
      candidates.add(`${localPart}${DIRECT_JID_SUFFIX}`)
      candidates.add(`${localPart}${LID_JID_SUFFIX}`)
    }
  }
  return candidates
}

function isSocketSelfChatMessage(sock: WASocket, message: WAMessage): boolean {
  const remoteJid = message.key.remoteJid
  if (!isDirectWhatsAppJid(remoteJid)) {
    return false
  }
  const normalizedRemote = normalizeJid(remoteJid)
  const remoteLocalPart = jidLocalPart(remoteJid)
  const selfCandidates = socketSelfJidCandidates(sock)
  return Boolean(
    normalizedRemote && selfCandidates.has(normalizedRemote),
  ) || Boolean(
    remoteLocalPart && selfCandidates.has(remoteLocalPart),
  )
}

function rawMessageId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function sentMessageId(message: unknown): string | undefined {
  return rawMessageId((message as { key?: { id?: unknown } } | undefined)?.key?.id)
}

function extractText(message: WAMessage): string | undefined {
  const body = message.message
  const text =
    body?.conversation
    ?? body?.extendedTextMessage?.text
    ?? body?.imageMessage?.caption
    ?? body?.videoMessage?.caption
    ?? body?.documentMessage?.caption
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : undefined
}

function audioMessage(message: WAMessage): { mimeType: string; durationMs?: number } | null {
  const audio = message.message?.audioMessage
  if (!audio) {
    return null
  }
  const durationMs = typeof audio.seconds === 'number'
    ? Math.max(0, Math.trunc(audio.seconds * 1000))
    : undefined
  return {
    mimeType: audio.mimetype || 'audio/ogg',
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

async function downloadAudioBuffer(message: WAMessage): Promise<Buffer | null> {
  try {
    const media = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: createNoopLogger() as never,
        reuploadRequest: async (original) => original,
      },
    )
    return Buffer.isBuffer(media) ? media : Buffer.from(media as ArrayBuffer)
  } catch {
    return null
  }
}

function mediaSummary(message: WAMessage): Array<{ mimeType?: string; caption?: string; metadata?: Record<string, unknown> }> {
  const body = message.message
  const media: Array<{ mimeType?: string; caption?: string; metadata?: Record<string, unknown> }> = []
  if (body?.imageMessage) {
    media.push({
      ...(body.imageMessage.mimetype ? { mimeType: body.imageMessage.mimetype } : {}),
      ...(body.imageMessage.caption ? { caption: body.imageMessage.caption } : {}),
      metadata: { type: 'image' },
    })
  }
  if (body?.videoMessage) {
    media.push({
      ...(body.videoMessage.mimetype ? { mimeType: body.videoMessage.mimetype } : {}),
      ...(body.videoMessage.caption ? { caption: body.videoMessage.caption } : {}),
      metadata: { type: 'video' },
    })
  }
  if (body?.documentMessage) {
    media.push({
      ...(body.documentMessage.mimetype ? { mimeType: body.documentMessage.mimetype } : {}),
      ...(body.documentMessage.caption ? { caption: body.documentMessage.caption } : {}),
      metadata: {
        type: 'document',
        ...(body.documentMessage.fileName ? { fileName: body.documentMessage.fileName } : {}),
      },
    })
  }
  if (body?.stickerMessage) {
    media.push({
      ...(body.stickerMessage.mimetype ? { mimeType: body.stickerMessage.mimetype } : {}),
      metadata: { type: 'sticker' },
    })
  }
  return media
}

async function toInboundEvent(
  accountId: string,
  message: WAMessage,
  options: { fromMeSelfChat?: boolean } = {},
): Promise<ChannelInboundEvent | null> {
  if (message.key.fromMe && !options.fromMeSelfChat) {
    return null
  }
  const remoteJid = message.key.remoteJid
  if (!remoteJid) {
    return null
  }

  const chatType = remoteJid.endsWith(GROUP_JID_SUFFIX) ? 'group' : 'direct'
  const audio = audioMessage(message)
  const audioBuffer = audio ? await downloadAudioBuffer(message) : null
  const media = mediaSummary(message)
  const text = extractText(message)
  if (!text && !audioBuffer && media.length === 0) {
    return null
  }

  return {
    provider: 'whatsapp',
    accountId,
    chatType,
    peerId: remoteJid,
    peerDisplayName: message.pushName ?? remoteJid,
    ...(chatType === 'group' ? { groupId: remoteJid } : {}),
    ...(text ? { text } : {}),
    ...(audio && audioBuffer ? { audio: { buffer: audioBuffer, mimeType: audio.mimeType, durationMs: audio.durationMs } } : {}),
    ...(media.length > 0 ? { media } : {}),
    ...(options.fromMeSelfChat ? { metadata: { selfAuthored: true, selfChat: true } } : {}),
    rawTimestamp: typeof message.messageTimestamp === 'number'
      ? message.messageTimestamp * 1000
      : nowIso(),
    rawSourceId: message.key.id ?? `${remoteJid}:${Date.now()}`,
  }
}

class BaileysRuntime implements WhatsAppTransportRuntime {
  readonly accountId: string
  private sock: WASocket
  private readonly handlers: WhatsAppTransportHandlers
  private readonly createSocket: () => Promise<WASocket>
  private runtimeStatus: WhatsAppRuntimeStatus
  private stopped = false
  private restartedDuringPairing = false
  private qrOutcome?: (outcome: PairingOutcome) => void
  private qrFailure?: (error: Error) => void
  private readonly recentlySentMessageIds = new Set<string>()
  private readonly recentlySentMessageOrder: string[] = []

  constructor(input: {
    accountId: string
    sock: WASocket
    handlers: WhatsAppTransportHandlers
    createSocket: () => Promise<WASocket>
    initialStatus: WhatsAppRuntimeStatus
  }) {
    this.accountId = input.accountId
    this.sock = input.sock
    this.handlers = input.handlers
    this.createSocket = input.createSocket
    this.runtimeStatus = input.initialStatus
    this.attachSocket(this.sock)
  }

  private attachSocket(sock: WASocket): void {
    sock.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update).catch((error) => {
        this.markError(error)
      })
    })
    sock.ev.on('messages.upsert', (upsert) => {
      void this.handleMessages(upsert.messages ?? []).catch((error) => {
        this.markError(error)
      })
    })
  }

  private detachSocket(sock: WASocket): void {
    sock.ev.removeAllListeners('connection.update')
    sock.ev.removeAllListeners('messages.upsert')
  }

  private replaceSocket(sock: WASocket): void {
    this.detachSocket(this.sock)
    closeWaSocket(this.sock)
    this.sock = sock
    this.attachSocket(this.sock)
  }

  private async restartPairingSocket(error: unknown): Promise<void> {
    if (this.stopped) {
      return
    }
    this.restartedDuringPairing = true
    this.runtimeStatus = {
      ...this.runtimeStatus,
      state: 'pairing',
      connected: false,
      lastError: pairingRestartMessage(error),
      lastEventAt: nowIso(),
    }
    await this.handlers.onStatus?.(this.status())
    const replacement = await this.createSocket()
    if (this.stopped) {
      closeWaSocket(replacement)
      return
    }
    this.replaceSocket(replacement)
  }

  private isPairingLoginInProgress(): boolean {
    return this.runtimeStatus.state === 'pairing' || Boolean(this.runtimeStatus.qrCode)
  }

  status(): WhatsAppRuntimeStatus {
    return { ...this.runtimeStatus }
  }

  private rememberSentMessageId(value: unknown): void {
    const id = rawMessageId(value)
    if (!id || this.recentlySentMessageIds.has(id)) {
      return
    }
    this.recentlySentMessageIds.add(id)
    this.recentlySentMessageOrder.push(id)
    while (this.recentlySentMessageOrder.length > RECENT_SENT_MESSAGE_LIMIT) {
      const oldest = this.recentlySentMessageOrder.shift()
      if (oldest) {
        this.recentlySentMessageIds.delete(oldest)
      }
    }
  }

  private isRecentlySentMessage(value: unknown): boolean {
    const id = rawMessageId(value)
    return Boolean(id && this.recentlySentMessageIds.has(id))
  }

  private shouldAcceptFromMeSelfChat(message: WAMessage): boolean {
    if (!message.key.fromMe) {
      return false
    }
    if (this.isRecentlySentMessage(message.key.id)) {
      return false
    }
    return isSocketSelfChatMessage(this.sock, message)
  }

  waitForPairingOutcome(timeoutMs: number): Promise<PairingOutcome> {
    if (this.runtimeStatus.state === 'connected') {
      return Promise.resolve({ kind: 'connected' })
    }
    if (this.runtimeStatus.qrCode && this.runtimeStatus.qrDataUrl) {
      return Promise.resolve({
        kind: 'qr',
        qrCode: this.runtimeStatus.qrCode,
        qrDataUrl: this.runtimeStatus.qrDataUrl,
      })
    }

    return new Promise<PairingOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.qrOutcome === resolve) {
          this.qrOutcome = undefined
          this.qrFailure = undefined
        }
        reject(new Error(`Timed out waiting for WhatsApp QR after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()
      this.qrOutcome = (outcome) => {
        clearTimeout(timer)
        this.qrOutcome = undefined
        this.qrFailure = undefined
        resolve(outcome)
      }
      this.qrFailure = (error) => {
        clearTimeout(timer)
        this.qrOutcome = undefined
        this.qrFailure = undefined
        reject(error)
      }
    })
  }

  async send(
    peerId: string,
    payload: ChannelOutboundPayload,
    options: { sendTextWithVoiceNote?: boolean } = {},
  ): Promise<void> {
    const jid = normalizePeerJid(peerId)
    if (payload.audio) {
      const audioMessageResult = await this.sock.sendMessage(jid, {
        audio: payload.audio.buffer,
        ptt: true,
        mimetype: payload.audio.mimeType || 'audio/ogg; codecs=opus',
      })
      this.rememberSentMessageId(sentMessageId(audioMessageResult))
      if (!options.sendTextWithVoiceNote) {
        return
      }
    }
    if (payload.text?.trim()) {
      const textMessageResult = await this.sock.sendMessage(jid, { text: payload.text.trim() })
      this.rememberSentMessageId(sentMessageId(textMessageResult))
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.runtimeStatus = {
      ...this.runtimeStatus,
      state: 'stopped',
      connected: false,
      lastEventAt: nowIso(),
    }
    this.detachSocket(this.sock)
    closeWaSocket(this.sock)
  }

  private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const candidate = update as {
      connection?: string
      qr?: string
      lastDisconnect?: { error?: unknown }
    }
    if (candidate.qr) {
      const qrDataUrl = await qrcode.toDataURL(candidate.qr)
      this.runtimeStatus = {
        ...this.runtimeStatus,
        state: 'pairing',
        connected: false,
        lastQrAt: nowIso(),
        lastEventAt: nowIso(),
        qrCode: candidate.qr,
        qrDataUrl,
      }
      await this.handlers.onStatus?.(this.status())
      this.qrOutcome?.({ kind: 'qr', qrCode: candidate.qr, qrDataUrl })
      return
    }

    if (candidate.connection === 'open') {
      this.runtimeStatus = {
        ...this.runtimeStatus,
        state: 'connected',
        connected: true,
        lastEventAt: nowIso(),
        lastError: undefined,
      }
      await this.handlers.onStatus?.(this.status())
      this.qrOutcome?.({ kind: 'connected' })
      return
    }

    if (candidate.connection === 'close') {
      if (
        isPairingRestartStatus(candidate.lastDisconnect?.error) &&
        this.isPairingLoginInProgress() &&
        !this.restartedDuringPairing
      ) {
        await this.restartPairingSocket(candidate.lastDisconnect?.error)
        return
      }

      const loggedOut = isLoggedOutStatus(candidate.lastDisconnect?.error)
      this.runtimeStatus = {
        ...this.runtimeStatus,
        state: loggedOut ? 'logged-out' : 'disconnected',
        connected: false,
        lastEventAt: nowIso(),
        ...(candidate.lastDisconnect?.error ? { lastError: errorMessage(candidate.lastDisconnect.error) } : {}),
      }
      await this.handlers.onStatus?.(this.status())
      if (loggedOut) {
        this.qrFailure?.(new Error('WhatsApp account logged out during pairing'))
      }
    }
  }

  private async handleMessages(messages: readonly WAMessage[]): Promise<void> {
    for (const message of messages) {
      const event = await toInboundEvent(this.accountId, message, {
        fromMeSelfChat: this.shouldAcceptFromMeSelfChat(message),
      })
      if (event) {
        await this.handlers.onInbound(event)
      }
    }
  }

  private markError(error: unknown): void {
    this.runtimeStatus = {
      ...this.runtimeStatus,
      state: 'error',
      connected: false,
      lastError: errorMessage(error),
      lastEventAt: nowIso(),
    }
    this.qrFailure?.(error instanceof Error ? error : new Error(errorMessage(error)))
  }
}

export class BaileysWhatsAppTransport implements WhatsAppTransport {
  readonly kind = 'baileys'

  async start(input: {
    accountId: string
    config: WhatsAppChannelConfig
    handlers: WhatsAppTransportHandlers
  }): Promise<WhatsAppTransportRuntime> {
    return createRuntime(input)
  }

  async beginPairing(input: {
    challengeId: string
    accountId: string
    config: WhatsAppChannelConfig
    handlers: WhatsAppTransportHandlers
  }): Promise<WhatsAppPairingSession> {
    const runtime = await createRuntime(input)
    try {
      const outcome = await runtime.waitForPairingOutcome(input.config.baileys.connectTimeoutMs)
      const status = runtime.status()
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
      return {
        challengeId: input.challengeId,
        accountId: input.accountId,
        expiresAt,
        runtime,
        status,
        ...(outcome.kind === 'qr' ? { qrCode: outcome.qrCode, qrDataUrl: outcome.qrDataUrl } : {}),
      }
    } catch (error) {
      await runtime.stop().catch(() => undefined)
      throw error
    }
  }
}

async function createRuntime(input: BaileysRuntimeOptions): Promise<BaileysRuntime> {
  const authStateDir = input.config.baileys.authStateDir
  if (!authStateDir) {
    throw new Error('Baileys authStateDir is required')
  }
  await mkdir(path.resolve(authStateDir), { recursive: true, mode: 0o700 })
  const createSocket = () => createBaileysSocket(input)
  const sock = await createSocket()
  return new BaileysRuntime({
    accountId: input.accountId,
    sock,
    handlers: input.handlers,
    createSocket,
    initialStatus: {
      provider: 'whatsapp',
      accountId: input.accountId,
      transport: 'baileys',
      state: 'starting',
      connected: false,
      lastEventAt: nowIso(),
    },
  })
}

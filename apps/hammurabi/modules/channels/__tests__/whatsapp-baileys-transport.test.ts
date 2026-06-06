import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWhatsAppChannelConfig } from '../whatsapp/config'
import { BaileysWhatsAppTransport } from '../whatsapp/baileys-transport'

const baileysMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  function createEmitter() {
    const listeners = new Map<string, Set<Listener>>()
    return {
      on(event: string, listener: Listener) {
        const existing = listeners.get(event) ?? new Set<Listener>()
        existing.add(listener)
        listeners.set(event, existing)
      },
      emit(event: string, ...args: unknown[]) {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args)
        }
      },
      removeAllListeners(event?: string) {
        if (event) {
          listeners.delete(event)
          return
        }
        listeners.clear()
      },
    }
  }

  const sockets: Array<{
    ev: ReturnType<typeof createEmitter>
    user: { id: string; lid: string }
    ws: { close: ReturnType<typeof vi.fn> }
    end: ReturnType<typeof vi.fn>
    sendMessage: ReturnType<typeof vi.fn>
  }> = []
  const saveCreds = vi.fn(async () => undefined)
  let sentCounter = 0

  return {
    sockets,
    saveCreds,
    resetSentCounter: () => {
      sentCounter = 0
    },
    fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3000, 0] })),
    makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
    makeWASocket: vi.fn(() => {
      const socket = {
        ev: createEmitter(),
        user: {
          id: '15551234567:1@s.whatsapp.net',
          lid: '67427329167522:1@lid',
        },
        ws: { close: vi.fn() },
        end: vi.fn(),
        sendMessage: vi.fn(async () => ({ key: { id: `sent-${++sentCounter}` } })),
      }
      sockets.push(socket)
      return socket
    }),
    useMultiFileAuthState: vi.fn(async () => ({
      state: {
        creds: {},
        keys: {},
      },
      saveCreds,
    })),
    downloadMediaMessage: vi.fn(),
  }
})

vi.mock('@whiskeysockets/baileys', () => ({
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: baileysMock.downloadMediaMessage,
  fetchLatestBaileysVersion: baileysMock.fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore: baileysMock.makeCacheableSignalKeyStore,
  makeWASocket: baileysMock.makeWASocket,
  useMultiFileAuthState: baileysMock.useMultiFileAuthState,
}))

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (qr: string) => `data:image/png;base64,${qr}`),
  },
}))

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-whatsapp-transport-'))
  tempDirs.push(dir)
  return dir
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for condition')
}

beforeEach(() => {
  baileysMock.sockets.splice(0)
  baileysMock.saveCreds.mockClear()
  baileysMock.resetSentCounter()
  baileysMock.fetchLatestBaileysVersion.mockClear()
  baileysMock.makeCacheableSignalKeyStore.mockClear()
  baileysMock.makeWASocket.mockClear()
  baileysMock.useMultiFileAuthState.mockClear()
  baileysMock.downloadMediaMessage.mockClear()
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('BaileysWhatsAppTransport', () => {
  it('does not pass Baileys deprecated terminal QR option', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig(
      {
        transport: 'baileys',
        baileys: {
          connectTimeoutMs: 1_000,
          printQrInTerminal: true,
        },
      },
      'pm-ai',
      dataDir,
    )
    const transport = new BaileysWhatsAppTransport()

    const sessionPromise = transport.beginPairing({
      challengeId: 'challenge-qr-option',
      accountId: 'pm-ai',
      config,
      handlers: {
        onInbound: () => undefined,
      },
    })

    await waitForCondition(() => baileysMock.sockets.length === 1)
    const socketConfig = baileysMock.makeWASocket.mock.calls[0]?.[0] as Record<string, unknown>
    expect(socketConfig).not.toHaveProperty('printQRInTerminal')

    baileysMock.sockets[0]?.ev.emit('connection.update', { qr: 'qr-1' })
    const session = await sessionPromise
    expect(session.qrCode).toBe('qr-1')
    await session.runtime.stop()
  })

  it('closes the pairing socket when the QR challenge times out', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig(
      {
        transport: 'baileys',
        baileys: {
          connectTimeoutMs: 5,
          printQrInTerminal: false,
        },
      },
      'pm-ai',
      dataDir,
    )

    await expect(new BaileysWhatsAppTransport().beginPairing({
      challengeId: 'challenge-timeout',
      accountId: 'pm-ai',
      config,
      handlers: {
        onInbound: () => undefined,
      },
    })).rejects.toThrow(/Timed out waiting for WhatsApp QR/)

    expect(baileysMock.sockets[0]?.end).toHaveBeenCalled()
  })

  it('restarts a pending QR pairing socket once when Baileys closes with nested status 515', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig(
      {
        transport: 'baileys',
        baileys: {
          connectTimeoutMs: 1_000,
          printQrInTerminal: false,
        },
      },
      'pm-ai',
      dataDir,
    )
    const transport = new BaileysWhatsAppTransport()

    const sessionPromise = transport.beginPairing({
      challengeId: 'challenge-1',
      accountId: 'pm-ai',
      config,
      handlers: {
        onInbound: () => undefined,
      },
    })

    await waitForCondition(() => baileysMock.sockets.length === 1)
    baileysMock.sockets[0]?.ev.emit('connection.update', { qr: 'qr-1' })

    const session = await sessionPromise
    expect(session).toMatchObject({
      challengeId: 'challenge-1',
      qrCode: 'qr-1',
      qrDataUrl: 'data:image/png;base64,qr-1',
    })

    baileysMock.sockets[0]?.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: {
          error: {
            output: {
              statusCode: 515,
            },
          },
        },
      },
    })

    await waitForCondition(() => baileysMock.sockets.length === 2)
    expect(session.runtime.status()).toMatchObject({
      state: 'pairing',
      connected: false,
      lastError: 'WhatsApp requested a pairing restart after scan (status 515); reconnecting.',
    })
    expect(baileysMock.sockets[0]?.end).toHaveBeenCalled()

    baileysMock.sockets[1]?.ev.emit('connection.update', { connection: 'open' })
    await waitForCondition(() => session.runtime.status().connected)
    expect(session.runtime.status()).toMatchObject({
      state: 'connected',
      connected: true,
    })
  })

  it('accepts self-chat messages sent from the linked WhatsApp account', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig(
      {
        transport: 'baileys',
        baileys: {
          printQrInTerminal: false,
        },
      },
      'pm-ai',
      dataDir,
    )
    const onInbound = vi.fn()
    const runtime = await new BaileysWhatsAppTransport().start({
      accountId: 'pm-ai',
      config,
      handlers: { onInbound },
    })

    try {
      await waitForCondition(() => baileysMock.sockets.length === 1)
      baileysMock.sockets[0]?.ev.emit('messages.upsert', {
        messages: [
          {
            key: {
              fromMe: true,
              remoteJid: '15551234567@s.whatsapp.net',
              id: 'human-self-1',
            },
            message: { conversation: 'hello commander' },
            messageTimestamp: 1_779_000_000,
            pushName: 'Nick',
          },
        ],
      })

      await waitForCondition(() => onInbound.mock.calls.length === 1)
      expect(onInbound).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'whatsapp',
        accountId: 'pm-ai',
        chatType: 'direct',
        peerId: '15551234567@s.whatsapp.net',
        peerDisplayName: 'Nick',
        text: 'hello commander',
        rawSourceId: 'human-self-1',
        metadata: {
          selfAuthored: true,
          selfChat: true,
        },
      }))
    } finally {
      await runtime.stop()
    }
  })

  it('keeps ignoring fromMe messages sent to other WhatsApp chats', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig({ transport: 'baileys' }, 'pm-ai', dataDir)
    const onInbound = vi.fn()
    const runtime = await new BaileysWhatsAppTransport().start({
      accountId: 'pm-ai',
      config,
      handlers: { onInbound },
    })

    try {
      await waitForCondition(() => baileysMock.sockets.length === 1)
      baileysMock.sockets[0]?.ev.emit('messages.upsert', {
        messages: [
          {
            key: {
              fromMe: true,
              remoteJid: '19998887777@s.whatsapp.net',
              id: 'human-other-chat-1',
            },
            message: { conversation: 'private note to someone else' },
            messageTimestamp: 1_779_000_000,
          },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(onInbound).not.toHaveBeenCalled()
    } finally {
      await runtime.stop()
    }
  })

  it('suppresses outbound self-chat echoes from Hammurabi sends', async () => {
    const dataDir = await createTempDir()
    const config = parseWhatsAppChannelConfig({ transport: 'baileys' }, 'pm-ai', dataDir)
    const onInbound = vi.fn()
    const runtime = await new BaileysWhatsAppTransport().start({
      accountId: 'pm-ai',
      config,
      handlers: { onInbound },
    })

    try {
      await waitForCondition(() => baileysMock.sockets.length === 1)
      await runtime.send('15551234567@s.whatsapp.net', { text: 'agent reply' })
      baileysMock.sockets[0]?.ev.emit('messages.upsert', {
        messages: [
          {
            key: {
              fromMe: true,
              remoteJid: '15551234567@s.whatsapp.net',
              id: 'sent-1',
            },
            message: { conversation: 'agent reply' },
            messageTimestamp: 1_779_000_000,
          },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(onInbound).not.toHaveBeenCalled()
    } finally {
      await runtime.stop()
    }
  })
})

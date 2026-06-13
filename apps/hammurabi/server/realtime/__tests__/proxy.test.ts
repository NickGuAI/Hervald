import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import type { TranscriptionProvider } from '@gehirn/transcription'
import type { ApiKeyStoreLike } from '../../api-keys/store'
import type {
  OpenAITranscriptionKeyStatus,
  OpenAITranscriptionKeyStoreLike,
} from '../../api-keys/transcription-store'
import {
  createRealtimeProxy,
  type RealtimeProxyOptions,
} from '../proxy'
import type { RealtimeTranscriptionClientLike } from '../openai-realtime'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
  httpServer: Server
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      if (!requiredScopes.every((scope) => scope === 'agents:write')) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }

      return {
        ok: true as const,
        record: {
          id: 'test-key-id',
          name: 'test',
          keyHash: 'hash',
          prefix: 'hmrb_test',
          createdBy: 'test',
          createdAt: '2026-02-28T00:00:00.000Z',
          lastUsedAt: null,
          scopes: ['agents:read', 'agents:write'],
        },
      }
    },
  }
}

function createTranscriptionKeyStore(
  status: OpenAITranscriptionKeyStatus,
  openAiApiKey: string | null,
): OpenAITranscriptionKeyStoreLike {
  return {
    getStatus: async () => status,
    getOpenAIApiKey: async () => openAiApiKey,
    setOpenAIApiKey: async () => undefined,
    clearOpenAIApiKey: async () => false,
  }
}

class MockRealtimeClient
  extends EventEmitter
  implements RealtimeTranscriptionClientLike
{
  connect = vi.fn(async () => undefined)
  sendAudio = vi.fn((_base64Audio: string) => undefined)
  commitAudioBuffer = vi.fn(() => {
    this.emit('final', 'hello from mock transcription')
  })
  close = vi.fn(() => undefined)
}

const MIN_COMMIT_AUDIO_BYTES = 4800

async function waitForMessage(
  received: Array<{ type: string; text?: string; message?: string }>,
  type: string,
  timeoutMs = 1000,
): Promise<void> {
  const startedAt = Date.now()
  while (!received.some((message) => message.type === type)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${type} message`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function openRealtimeSocket(server: RunningServer): Promise<{
  ws: WebSocket
  received: Array<{ type: string; text?: string; message?: string }>
}> {
  const wsUrl =
    server.baseUrl.replace('http://', 'ws://') +
    '/api/realtime/transcription'
  const ws = new WebSocket(wsUrl, {
    headers: { 'x-hammurabi-api-key': 'test-key' },
  })
  const received: Array<{ type: string; text?: string; message?: string }> = []
  ws.on('message', (data) => {
    received.push(JSON.parse(data.toString()) as { type: string; text?: string; message?: string })
  })

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
    ws.once('unexpected-response', (_request, response) => {
      reject(new Error(`Unexpected websocket status ${response.statusCode}`))
    })
  })

  ws.send(JSON.stringify({ type: 'start' }))
  await waitForMessage(received, 'ready')

  return { ws, received }
}

async function startServer(
  options: Partial<RealtimeProxyOptions> = {},
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const realtime = createRealtimeProxy({
    apiKeyStore: createTestApiKeyStore(),
    transcriptionKeyStore: createTranscriptionKeyStore(
      {
        configured: true,
        updatedAt: '2026-02-28T00:00:00.000Z',
      },
      'sk-test-openai',
    ),
    ...options,
  })
  app.use('/api/realtime', realtime.router)

  const httpServer = createServer(app)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/realtime/')) {
      realtime.handleUpgrade(req, socket, head)
      return
    }
    socket.destroy()
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    httpServer,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('realtime proxy routes', () => {
  it('requires auth for /api/realtime/config', async () => {
    const server = await startServer()
    const response = await fetch(`${server.baseUrl}/api/realtime/config`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
    })

    await server.close()
  })

  it('returns whether OpenAI realtime transcription is configured', async () => {
    const server = await startServer()
    const response = await fetch(`${server.baseUrl}/api/realtime/config`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      openaiConfigured: true,
    })

    await server.close()
  })
})

describe('realtime proxy websocket', () => {
  it('does not commit buffered audio when below the 100ms threshold', async () => {
    const mockClient = new MockRealtimeClient()
    mockClient.commitAudioBuffer = vi.fn()
    const server = await startServer({
      createClient: () => mockClient,
    })

    const { ws, received } = await openRealtimeSocket(server)

    const closed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
      ws.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString() })
      })
      ws.once('error', reject)
    })

    ws.send(Buffer.alloc(MIN_COMMIT_AUDIO_BYTES - 1))
    ws.send(JSON.stringify({ type: 'commit' }))

    const closeEvent = await closed
    expect(closeEvent).toEqual({
      code: 1000,
      reason: 'Recording too short',
    })
    expect(received).toContainEqual({
      type: 'error',
      code: 'audio_too_short',
      message: 'Recording too short',
      bytesAppended: MIN_COMMIT_AUDIO_BYTES - 1,
    })
    expect(mockClient.commitAudioBuffer).not.toHaveBeenCalled()

    await server.close()
  })

  it('streams audio chunks and final transcript through the websocket bridge', async () => {
    const mockClient = new MockRealtimeClient()
    const server = await startServer({
      createClient: () => mockClient,
    })

    const { ws } = await openRealtimeSocket(server)

    const finalMessage = new Promise<{ type: string; text: string }>((resolve, reject) => {
      ws.on('message', (data) => {
        const payload = JSON.parse(data.toString()) as { type: string; text: string }
        if (payload.type === 'final') {
          resolve(payload)
        }
      })
      ws.on('error', reject)
    })

    ws.send(Buffer.alloc(MIN_COMMIT_AUDIO_BYTES))
    ws.send(JSON.stringify({ type: 'commit' }))

    const payload = await finalMessage
    expect(payload).toEqual({
      type: 'final',
      text: 'hello from mock transcription',
    })
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    expect(mockClient.sendAudio).toHaveBeenCalledTimes(1)
    expect(mockClient.commitAudioBuffer).toHaveBeenCalledTimes(1)

    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
    await server.close()
  })

  it('ignores pre-commit final events so pause fragments are not surfaced as transcript text', async () => {
    const mockClient = new MockRealtimeClient()
    mockClient.commitAudioBuffer = vi.fn()
    const server = await startServer({
      createClient: () => mockClient,
    })

    const { ws, received } = await openRealtimeSocket(server)

    mockClient.emit('final', 'first segment')
    mockClient.emit('final', 'second segment')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const finals = received.filter((m) => m.type === 'final')
    expect(finals).toEqual([])
    expect(ws.readyState).toBe(WebSocket.OPEN)

    ws.send(Buffer.alloc(MIN_COMMIT_AUDIO_BYTES))
    ws.send(JSON.stringify({ type: 'commit' }))
    await waitForCondition(() => mockClient.commitAudioBuffer.mock.calls.length === 1)
    mockClient.emit('final', 'first segment second segment')
    await waitForMessage(received, 'final')

    expect(received.filter((m) => m.type === 'final')).toEqual([
      { type: 'final', text: 'first segment second segment' },
    ])
    expect(mockClient.commitAudioBuffer).toHaveBeenCalledOnce()

    ws.close()
    await server.close()
  })

  it('passes prompt and merged terms into the realtime provider on start', async () => {
    const mockClient = new MockRealtimeClient()
    const clientOptions: Array<Parameters<NonNullable<RealtimeProxyOptions['createClient']>>[0]> = []
    const server = await startServer({
      createClient: (options) => {
        clientOptions.push(options)
        return mockClient
      },
    })

    const wsUrl =
      server.baseUrl.replace('http://', 'ws://') +
      '/api/realtime/transcription?prompt=Preserve%20issue%20terms&term=VoiceFlow&terms=Kubernetes,gRPC'
    const ws = new WebSocket(wsUrl, {
      headers: { 'x-hammurabi-api-key': 'test-key' },
    })
    const received: Array<{ type: string; text?: string; message?: string }> = []
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()) as { type: string; text?: string; message?: string })
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    ws.send(JSON.stringify({ type: 'start' }))
    await waitForMessage(received, 'ready')

    expect(clientOptions).toHaveLength(1)
    expect(clientOptions[0]).toMatchObject({
      apiKey: 'sk-test-openai',
      language: 'en',
      model: 'gpt-4o-transcribe',
    })
    expect(clientOptions[0]?.terms).toContain('Hammurabi')
    expect(clientOptions[0]?.terms).toContain('VoiceFlow')
    expect(clientOptions[0]?.terms).toContain('Kubernetes')
    expect(clientOptions[0]?.terms).toContain('gRPC')
    expect(clientOptions[0]?.prompt).toContain('Preserve issue terms')
    expect(clientOptions[0]?.prompt).toContain('VoiceFlow')

    ws.close()
    await server.close()
  })

  it('retries empty live finalization once from preserved PCM audio', async () => {
    const mockClient = new MockRealtimeClient()
    mockClient.commitAudioBuffer = vi.fn()
    const retryProvider: TranscriptionProvider = {
      provider: 'mock',
      transcribe: vi.fn(async (_audioPath, options) => ({
        title: 'retry',
        segments: [{ content: 'retried Hammurabi transcript' }],
        summary: 'retried Hammurabi transcript',
        readability: JSON.stringify(options),
      })),
    }
    const server = await startServer({
      createClient: () => mockClient,
      retryTranscriptionProvider: retryProvider,
      finalizeTimeoutMs: 5,
    })

    const { ws, received } = await openRealtimeSocket(server)
    ws.send(Buffer.alloc(MIN_COMMIT_AUDIO_BYTES, 1))
    ws.send(JSON.stringify({ type: 'commit' }))
    await waitForMessage(received, 'final')

    expect(received).toContainEqual({
      type: 'final',
      text: 'retried Hammurabi transcript',
    })
    expect(mockClient.commitAudioBuffer).toHaveBeenCalledOnce()
    expect(retryProvider.transcribe).toHaveBeenCalledOnce()
    expect(vi.mocked(retryProvider.transcribe).mock.calls[0]?.[0]).toMatch(/voice-note\.wav$/)
    expect(vi.mocked(retryProvider.transcribe).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        model: 'gpt-4o-transcribe',
        language: 'en',
        prompt: expect.stringContaining('Hammurabi'),
        terms: expect.arrayContaining(['Hammurabi', 'Gehirn', 'Claude Code', 'OpenCode', 'PMAI', 'Kubernetes', 'gRPC']),
        metadata: expect.objectContaining({
          source: 'realtime',
          retryReason: 'live-finalization-timeout',
          pcm16Bytes: MIN_COMMIT_AUDIO_BYTES,
          mimeType: 'audio/wav',
        }),
      }),
    )

    ws.close()
    await server.close()
  })

  it('drops transient upstream commit-race errors without sending an error frame or closing the browser websocket', async () => {
    const mockClient = new MockRealtimeClient()
    mockClient.commitAudioBuffer = vi.fn()
    const server = await startServer({
      createClient: () => mockClient,
    })

    const { ws, received } = await openRealtimeSocket(server)
    ws.send(Buffer.alloc(MIN_COMMIT_AUDIO_BYTES))
    ws.send(JSON.stringify({ type: 'commit' }))
    await waitForCondition(() => mockClient.commitAudioBuffer.mock.calls.length === 1)

    mockClient.emit('error', {
      code: 'audio_buffer_too_small',
      message:
        'Error committing input audio buffer: buffer too small. Expected at least 100ms of audio.',
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(received.some((message) => message.type === 'error')).toBe(false)
    expect(ws.readyState).toBe(WebSocket.OPEN)

    mockClient.emit('final', 'transcript after transient error')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(received).toContainEqual({
      type: 'final',
      text: 'transcript after transient error',
    })

    ws.close()
    await server.close()
  })

  it('rejects websocket upgrades when no OpenAI key is configured', async () => {
    const server = await startServer({
      transcriptionKeyStore: createTranscriptionKeyStore(
        {
          configured: false,
          updatedAt: null,
        },
        null,
      ),
    })

    const wsUrl =
      server.baseUrl.replace('http://', 'ws://') +
      '/api/realtime/transcription'
    const ws = new WebSocket(wsUrl, {
      headers: { 'x-hammurabi-api-key': 'test-key' },
    })

    const error = await new Promise<Error>((resolve) => {
      ws.once('unexpected-response', (_request, response) => {
        resolve(new Error(`status:${response.statusCode}`))
      })
    })
    expect(error.message).toContain('412')

    await server.close()
  })
})

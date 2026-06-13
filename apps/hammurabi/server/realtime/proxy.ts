import { Router } from 'express'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { bearerTokenFromHeader, type AuthUser } from '@gehirn/auth-providers'
import type { TranscriptionProvider } from '@gehirn/transcription'
import type { ApiKeyStoreLike } from '../api-keys/store.js'
import {
  OpenAITranscriptionKeyStore,
  type OpenAITranscriptionKeyStoreLike,
} from '../api-keys/transcription-store.js'
import { combinedAuth } from '../middleware/combined-auth.js'
import { createAuth0Verifier } from '../middleware/auth0.js'
import {
  InMemoryTransportAuthTicketStore,
  readTransportAuthTicketFromUrl,
} from '../auth/transport-tickets.js'
import {
  OpenAIRealtimeClient,
  isTransientCommitRaceError,
  type RealtimeTranscriptionClientLike,
} from './openai-realtime.js'
import {
  createOpenAIBulkTranscriptionProvider,
  transcribePreservedAudio,
} from '../voice/stt.js'
import {
  buildVoiceTranscriptionContext,
} from '../voice/transcription-context.js'

const DEFAULT_WS_KEEPALIVE_INTERVAL_MS = 30000
const DEFAULT_FINALIZE_TIMEOUT_MS = 2500
const PCM16_MONO_SAMPLE_RATE_HZ = 24000
const PCM16_BYTES_PER_SAMPLE = 2
const MIN_BUFFERED_AUDIO_MS = 100
const MIN_COMMIT_AUDIO_BYTES =
  (PCM16_MONO_SAMPLE_RATE_HZ * PCM16_BYTES_PER_SAMPLE * MIN_BUFFERED_AUDIO_MS) / 1000

interface BrowserControlMessage {
  type?: unknown
}

interface RealtimeClientErrorMessage {
  code?: unknown
  message?: unknown
  bytesAppended?: unknown
}

export interface RealtimeProxyOptions {
  apiKeyStore?: ApiKeyStoreLike
  transcriptionKeyStore?: OpenAITranscriptionKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  wsKeepAliveIntervalMs?: number
  createClient?: (options: {
    apiKey: string
    language: string
    model: string
    prompt: string
    terms: string[]
  }) => RealtimeTranscriptionClientLike
  retryTranscriptionProvider?: TranscriptionProvider
  finalizeTimeoutMs?: number
}

export interface RealtimeProxyResult {
  router: Router
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeLanguage(value: string | null): string {
  if (!value) {
    return 'en'
  }

  const normalized = value.trim()
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(normalized)) {
    return 'en'
  }

  return normalized
}

function parseKeepAliveIntervalMs(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WS_KEEPALIVE_INTERVAL_MS
  }
  return parsed
}

function parseFinalizeTimeoutMs(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FINALIZE_TIMEOUT_MS
  }
  return parsed
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return
  }
  ws.send(JSON.stringify(payload))
}

function toBinaryAudioBuffer(data: RawData): Buffer | null {
  if (typeof data === 'string') {
    return null
  }

  if (data instanceof ArrayBuffer) {
    const buffer = Buffer.from(data)
    return buffer.length > 0 ? buffer : null
  }

  if (Array.isArray(data)) {
    const buffer = Buffer.concat(data.map((chunk) => Buffer.from(chunk)))
    return buffer.length > 0 ? buffer : null
  }

  const buffer = Buffer.from(data)
  return buffer.length > 0 ? buffer : null
}

function parseTranscriptionTerms(url: URL): string[] {
  const terms = [
    ...url.searchParams.getAll('term'),
    ...url.searchParams.getAll('terms').flatMap((value) => value.split(',')),
  ]
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
  return terms
}

export function createPcm16MonoWavBuffer(
  pcm16Audio: Buffer,
  sampleRate = PCM16_MONO_SAMPLE_RATE_HZ,
): Buffer {
  const header = Buffer.alloc(44)
  const dataLength = pcm16Audio.length
  const byteRate = sampleRate * PCM16_BYTES_PER_SAMPLE
  const blockAlign = PCM16_BYTES_PER_SAMPLE

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataLength, 40)

  return Buffer.concat([header, pcm16Audio])
}

function attachWebSocketKeepAlive(
  ws: WebSocket,
  intervalMs: number,
  onStale: () => void,
): () => void {
  let waitingForPong = false
  let stopped = false

  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    clearInterval(interval)
    ws.off('pong', onPong)
    ws.off('close', onCloseOrError)
    ws.off('error', onCloseOrError)
  }

  const onPong = () => {
    waitingForPong = false
  }

  const onCloseOrError = () => {
    stop()
  }

  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return
    }

    if (waitingForPong) {
      onStale()
      ws.terminate()
      stop()
      return
    }

    waitingForPong = true
    ws.ping()
  }, intervalMs)

  ws.on('pong', onPong)
  ws.on('close', onCloseOrError)
  ws.on('error', onCloseOrError)

  return stop
}

export function createRealtimeProxy(options: RealtimeProxyOptions = {}): RealtimeProxyResult {
  const router = Router()
  const wss = new WebSocketServer({ noServer: true })
  const transcriptionKeyStore =
    options.transcriptionKeyStore ?? new OpenAITranscriptionKeyStore()
  const wsKeepAliveIntervalMs = parseKeepAliveIntervalMs(options.wsKeepAliveIntervalMs)
  const finalizeTimeoutMs = parseFinalizeTimeoutMs(options.finalizeTimeoutMs)
  const createClient =
    options.createClient ??
    ((clientOptions: {
      apiKey: string
      language: string
      model: string
      prompt: string
      terms: string[]
    }) =>
      new OpenAIRealtimeClient({
        apiKey: clientOptions.apiKey,
        transcriptionContext: {
          language: clientOptions.language,
          model: clientOptions.model,
          prompt: clientOptions.prompt,
          terms: clientOptions.terms,
        },
      }))

  const requireRealtimeAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })
  const transcriptionTickets = new InMemoryTransportAuthTicketStore()

  router.get('/config', requireRealtimeAccess, async (_req, res) => {
    try {
      const status = await transcriptionKeyStore.getStatus()
      res.json({
        openaiConfigured: status.configured,
      })
    } catch {
      res.status(500).json({ error: 'Failed to read realtime transcription settings' })
    }
  })

  router.post('/transcription-ticket', requireRealtimeAccess, (_req, res) => {
    res.json(transcriptionTickets.issue('realtime.transcription'))
  })

  const auth0Verifier = createAuth0Verifier({
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  async function verifyWsAuth(req: IncomingMessage): Promise<boolean> {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    if (
      transcriptionTickets.consume(
        readTransportAuthTicketFromUrl(url),
        'realtime.transcription',
      )
    ) {
      return true
    }

    const authorizationHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization
    const bearerToken = bearerTokenFromHeader(authorizationHeader)
    const apiKeyHeader = req.headers['x-hammurabi-api-key'] as string | undefined
    const token = bearerToken ?? apiKeyHeader

    if (!token) {
      return false
    }

    if (auth0Verifier) {
      try {
        await auth0Verifier(token)
        return true
      } catch {
        // Fall through to API key validation.
      }
    }

    if (options.apiKeyStore) {
      const result = await options.apiKeyStore.verifyKey(token, {
        requiredScopes: ['agents:write'],
      })
      return result.ok
    }

    return false
  }

  function isTranscriptionRoute(url: URL): boolean {
    return url.pathname === '/api/realtime/transcription'
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    if (!isTranscriptionRoute(url)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    void verifyWsAuth(req).then(async (authorized) => {
      if (!authorized) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const openaiApiKey = await transcriptionKeyStore.getOpenAIApiKey()
      if (!openaiApiKey) {
        socket.write('HTTP/1.1 412 Precondition Failed\r\n\r\n')
        socket.destroy()
        return
      }

      const language = normalizeLanguage(url.searchParams.get('language'))
      const transcriptionContext = buildVoiceTranscriptionContext({
        language,
        model: asNonEmptyString(url.searchParams.get('model')) ?? undefined,
        prompt: asNonEmptyString(url.searchParams.get('prompt')) ?? undefined,
        terms: parseTranscriptionTerms(url),
      })
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client = createClient({
          apiKey: openaiApiKey,
          language: transcriptionContext.language,
          model: transcriptionContext.model,
          prompt: transcriptionContext.prompt,
          terms: transcriptionContext.terms,
        })
        const retryProvider = options.retryTranscriptionProvider ?? createOpenAIBulkTranscriptionProvider({
          apiKeyProvider: async () => openaiApiKey,
        })

        const stopKeepAlive = attachWebSocketKeepAlive(ws, wsKeepAliveIntervalMs, () => {
          client.close()
        })

        let startPromise: Promise<void> | null = null
        let finalized = false
        let retrying = false
        let disposed = false
        let pendingStop = false
        let bufferedAudioBytes = 0
        const preservedAudioChunks: Buffer[] = []
        let finalizeTimer: NodeJS.Timeout | null = null

        const clearFinalizeTimer = () => {
          if (finalizeTimer !== null) {
            clearTimeout(finalizeTimer)
            finalizeTimer = null
          }
        }

        const dispose = () => {
          if (disposed) {
            return
          }
          disposed = true
          clearFinalizeTimer()
          stopKeepAlive()
          client.close()
        }

        const closeBrowser = (code: number, reason: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(code, reason)
          }
        }

        const sendError = (payload: {
          code?: string | null
          message: string
          bytesAppended?: number | null
        }) => {
          sendJson(ws, {
            type: 'error',
            ...(payload.code ? { code: payload.code } : {}),
            message: payload.message,
            ...(typeof payload.bytesAppended === 'number' ? { bytesAppended: payload.bytesAppended } : {}),
          })
        }

        const retryFromPreservedAudio = async (reason: string) => {
          if (finalized || retrying || disposed) {
            return
          }
          retrying = true
          clearFinalizeTimer()

          const pcmAudio = Buffer.concat(preservedAudioChunks)
          if (pcmAudio.length < MIN_COMMIT_AUDIO_BYTES) {
            sendError({
              code: 'audio_too_short',
              message: 'Recording too short',
              bytesAppended: pcmAudio.length,
            })
            closeBrowser(1000, 'Recording too short')
            return
          }

          try {
            const transcript = await transcribePreservedAudio(
              {
                buffer: createPcm16MonoWavBuffer(pcmAudio),
                mimeType: 'audio/wav',
              },
              {
                ...transcriptionContext,
                metadata: {
                  source: 'realtime',
                  retryReason: reason,
                  pcm16Bytes: pcmAudio.length,
                },
              },
              retryProvider,
            )
            finalized = true
            sendJson(ws, {
              type: 'final',
              text: transcript,
            })
            closeBrowser(1000, 'Transcription completed')
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Realtime transcription retry failed'
            sendError({
              message: errorMessage,
            })
            closeBrowser(1011, 'Realtime transcription failed')
          }
        }

        const scheduleRetryTimeout = () => {
          clearFinalizeTimer()
          finalizeTimer = setTimeout(() => {
            void retryFromPreservedAudio('live-finalization-timeout')
          }, finalizeTimeoutMs)
        }

        const startClient = () => {
          if (startPromise) {
            return
          }
          startPromise = client.connect().then(
            () => {
              sendJson(ws, {
                type: 'ready',
              })
            },
            (error) => {
              const message =
                error instanceof Error ? error.message : 'Failed to initialize realtime transcription'
              sendError({ message })
              closeBrowser(1011, 'Realtime initialization failed')
              dispose()
            },
          )
        }

        client.on('partial', (text: unknown) => {
          const partialText = asNonEmptyString(text)
          if (!partialText || !pendingStop) {
            return
          }
          sendJson(ws, {
            type: 'partial',
            text: partialText,
          })
        })

        client.on('final', (text: unknown) => {
          const finalText = asNonEmptyString(text)
          if (!finalText || !pendingStop) {
            return
          }
          finalized = true
          clearFinalizeTimer()
          sendJson(ws, {
            type: 'final',
            text: finalText,
          })
          closeBrowser(1000, 'Transcription completed')
        })

        client.on('error', (message: unknown) => {
          const errorPayload =
            typeof message === 'object' && message !== null
              ? (message as RealtimeClientErrorMessage)
              : null
          const errorCode = asNonEmptyString(errorPayload?.code)
          const errorMessage =
            asNonEmptyString(errorPayload?.message) ??
            asNonEmptyString(message) ??
            'Realtime transcription failed'
          const bytesAppended = asFiniteNumber(errorPayload?.bytesAppended)

          if (isTransientCommitRaceError({ code: errorCode, message: errorMessage })) {
            console.debug('[realtime-proxy] Dropping transient upstream commit-race error', {
              code: errorCode,
              message: errorMessage,
            })
            return
          }

          if (errorCode === 'audio_too_short') {
            sendError({
              code: errorCode,
              message: errorMessage,
              bytesAppended,
            })
            return
          }

          if (pendingStop && !finalized) {
            void retryFromPreservedAudio(`live-error:${errorCode ?? 'unknown'}`)
            return
          }

          sendError({
            code: errorCode,
            message: errorMessage,
            bytesAppended,
          })
          closeBrowser(1011, 'Realtime transcription failed')
        })

        client.on('close', () => {
          if (disposed || finalized) {
            return
          }
          if (pendingStop) {
            void retryFromPreservedAudio('live-upstream-closed')
            return
          }
          closeBrowser(1011, 'Realtime upstream closed')
        })

        ws.on('message', (rawData, isBinary) => {
          if (isBinary) {
            const audioBuffer = toBinaryAudioBuffer(rawData)
            if (audioBuffer) {
              preservedAudioChunks.push(audioBuffer)
              client.sendAudio(audioBuffer.toString('base64'))
              bufferedAudioBytes += audioBuffer.byteLength
            }
            return
          }

          let message: BrowserControlMessage
          try {
            message = JSON.parse(rawData.toString()) as BrowserControlMessage
          } catch {
            return
          }

          const messageType = asNonEmptyString(message.type)
          if (messageType === 'start') {
            startClient()
            return
          }

          if (messageType === 'commit' || messageType === 'stop') {
            pendingStop = true
            if (bufferedAudioBytes >= MIN_COMMIT_AUDIO_BYTES) {
              client.commitAudioBuffer()
              scheduleRetryTimeout()
            } else {
              sendError({
                code: 'audio_too_short',
                message: 'Recording too short',
                bytesAppended: bufferedAudioBytes,
              })
              closeBrowser(1000, 'Recording too short')
            }
          }
        })

        ws.on('close', () => {
          dispose()
        })

        ws.on('error', () => {
          dispose()
        })
      })
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    })
  }

  return {
    router,
    handleUpgrade,
  }
}

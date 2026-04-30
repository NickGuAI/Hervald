import { EventEmitter } from 'node:events'
import WebSocket, { type RawData } from 'ws'
import { LIVE_TRANSCRIPTION_PROMPT } from './prompts.js'

const DEFAULT_MODEL = 'gpt-4o-transcribe'
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const PCM16_SAMPLE_RATE = 24_000
const PCM16_BYTES_PER_SAMPLE = 2
const MIN_AUDIO_DURATION_MS = 100

export const MIN_AUDIO_BUFFER_BYTES =
  (PCM16_SAMPLE_RATE * PCM16_BYTES_PER_SAMPLE * MIN_AUDIO_DURATION_MS) / 1000

interface OpenAIRealtimeClientOptions {
  apiKey: string
  model?: string
  language?: string
  prompt?: string
}

interface OpenAIRealtimeServerEvent {
  type?: unknown
  delta?: unknown
  transcript?: unknown
  text?: unknown
  error?: {
    code?: unknown
    message?: unknown
  }
  message?: unknown
}

interface OpenAIRealtimeClientErrorPayload {
  code: string
  message: string
  bytesAppended?: number
}

export interface TransientCommitRaceErrorLike {
  code?: unknown
  message?: unknown
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isLikelyLanguageCode(value: string): boolean {
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)
}

function getBase64DecodedByteLength(base64Audio: string): number {
  const paddingChars = base64Audio.endsWith('==') ? 2 : base64Audio.endsWith('=') ? 1 : 0
  return Math.floor((base64Audio.length * 3) / 4) - paddingChars
}

export function isTransientCommitRaceError(
  error: TransientCommitRaceErrorLike | null | undefined,
): boolean {
  const code = asNonEmptyString(error?.code)?.toLowerCase()
  if (code === 'audio_buffer_too_small' || code === 'buffer_too_small') {
    return true
  }

  const message = asNonEmptyString(error?.message)?.toLowerCase()
  if (!message) {
    return false
  }

  return (
    message.includes('buffer too small') &&
    (message.includes('expected at least 100ms') || message.includes('expected at least 100 ms'))
  )
}

export class OpenAIRealtimeClient extends EventEmitter {
  private readonly apiKey: string
  private readonly model: string
  private readonly prompt: string
  private readonly language: string
  private ws: WebSocket | null = null
  private connected = false
  private closed = false
  private bytesAppended = 0

  constructor(options: OpenAIRealtimeClientOptions) {
    super()
    this.apiKey = options.apiKey.trim()
    this.model = options.model?.trim() || DEFAULT_MODEL
    this.prompt = options.prompt?.trim() || LIVE_TRANSCRIPTION_PROMPT

    const normalizedLanguage = options.language?.trim() ?? 'en'
    this.language = isLikelyLanguageCode(normalizedLanguage) ? normalizedLanguage : 'en'
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }
    if (this.closed) {
      throw new Error('Realtime client is closed')
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      })

      let settled = false

      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        if (error) {
          reject(error)
          return
        }
        resolve()
      }

      ws.on('open', () => {
        this.ws = ws
        this.connected = true
        this.sendEvent({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: {
                  type: 'audio/pcm',
                  rate: 24000,
                },
                transcription: {
                  model: this.model,
                  prompt: this.prompt,
                  language: this.language,
                },
                // Keep server_vad for streaming partial/final events, but make
                // silence detection less eager so brief pauses do not trigger
                // rapid empty-buffer auto-commits upstream.
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 600,
                },
                noise_reduction: {
                  type: 'near_field',
                },
              },
            },
          },
        })
        finish()
      })

      ws.on('message', (rawData) => {
        this.handleServerEvent(rawData)
      })

      ws.on('error', (error) => {
        const message = error instanceof Error ? error.message : 'OpenAI realtime websocket error'
        this.emit('error', message)
        if (!settled) {
          finish(new Error(message))
        }
      })

      ws.on('close', () => {
        this.connected = false
        this.bytesAppended = 0
        this.ws = null
        this.closed = true
        this.emit('close')
        if (!settled) {
          finish(new Error('OpenAI realtime websocket closed before initialization'))
        }
      })
    })
  }

  sendAudio(base64Audio: string): void {
    const normalized = asNonEmptyString(base64Audio)
    if (!normalized || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    this.bytesAppended += getBase64DecodedByteLength(normalized)
    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: normalized,
    })
  }

  commitAudioBuffer(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    if (this.bytesAppended < MIN_AUDIO_BUFFER_BYTES) {
      const errorPayload: OpenAIRealtimeClientErrorPayload = {
        code: 'audio_too_short',
        message: 'Recording too short',
        bytesAppended: this.bytesAppended,
      }
      this.emit('error', errorPayload)
      return
    }

    this.sendEvent({
      type: 'input_audio_buffer.commit',
    })
    this.bytesAppended = 0
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.connected = false
    this.bytesAppended = 0
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private handleServerEvent(rawData: RawData): void {
    let parsed: OpenAIRealtimeServerEvent
    try {
      parsed = JSON.parse(rawData.toString()) as OpenAIRealtimeServerEvent
    } catch {
      return
    }

    const eventType = asNonEmptyString(parsed.type)
    if (!eventType) {
      return
    }

    if (
      eventType === 'conversation.item.input_audio_transcription.delta' ||
      eventType === 'transcript.text.delta'
    ) {
      const deltaText = asNonEmptyString(parsed.delta) ?? asNonEmptyString(parsed.text)
      if (deltaText) {
        this.emit('partial', deltaText)
      }
      return
    }

    if (
      eventType === 'conversation.item.input_audio_transcription.completed' ||
      eventType === 'transcript.text.done'
    ) {
      const completedText = asNonEmptyString(parsed.transcript) ?? asNonEmptyString(parsed.text)
      if (completedText) {
        this.emit('final', completedText)
      }
      return
    }

    if (eventType === 'error') {
      const upstreamError = {
        code: parsed.error?.code,
        message: parsed.error?.message ?? parsed.message,
      }
      if (isTransientCommitRaceError(upstreamError)) {
        console.debug('[openai-realtime] Dropping transient upstream commit-race error', {
          code: asNonEmptyString(parsed.error?.code),
          message: asNonEmptyString(parsed.error?.message) ?? asNonEmptyString(parsed.message),
        })
        return
      }

      const errorMessage =
        asNonEmptyString(parsed.error?.message) ??
        asNonEmptyString(parsed.message) ??
        'OpenAI realtime transcription error'
      this.emit('error', errorMessage)
    }
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    this.ws.send(JSON.stringify(event))
  }
}

export interface RealtimeTranscriptionClientLike {
  connect(): Promise<void>
  sendAudio(base64Audio: string): void
  commitAudioBuffer(): void
  close(): void
  on(
    event: 'partial' | 'final' | 'error' | 'close',
    listener: (...args: unknown[]) => void,
  ): this
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  OpenAITranscriptionProvider,
  type TranscriptionOptions,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '@gehirn/transcription'
import {
  OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID,
  type ProviderSecretsStoreLike,
} from '../api-keys/provider-secrets-store.js'
import {
  buildVoiceTranscriptionContext,
  DEFAULT_TRANSCRIPTION_MODEL,
  type VoiceTranscriptionContext,
} from './transcription-context.js'

export class TranscriptionError extends Error {
  readonly cause?: unknown

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'TranscriptionError'
    this.cause = options.cause
  }
}

interface OpenAITranscriptionClientOptions {
  apiKeyProvider: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

interface PreservedVoiceAudio {
  buffer: Buffer
  mimeType: string
  durationMs?: number
}

type PreservedAudioTranscriptionOptions = TranscriptionOptions & Partial<VoiceTranscriptionContext>

class OpenAIBulkTranscriptionClient {
  private readonly apiKeyProvider: () => Promise<string | null>
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenAITranscriptionClientOptions) {
    this.apiKeyProvider = options.apiKeyProvider
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {},
  ): Promise<TranscriptionResult> {
    const apiKey = await this.apiKeyProvider()
    if (!apiKey) {
      throw new Error('OpenAI transcription key is not configured')
    }

    const body = new FormData()
    const audio = await import('node:fs/promises').then((fs) => fs.readFile(audioPath))
    const context = buildVoiceTranscriptionContext({
      model: options.model,
      language: options.language,
      prompt: options.prompt,
      terms: options.terms,
    })
    body.set('file', new Blob([audio]), path.basename(audioPath))
    body.set('model', context.model)
    body.set('language', context.language)
    body.set('prompt', context.prompt)
    body.set('response_format', 'json')

    const response = await this.fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    })
    if (!response.ok) {
      const details = await response.text().catch(() => '')
      throw new Error(`OpenAI transcription failed (${response.status}): ${details || response.statusText}`)
    }

    const parsed = await response.json() as { text?: unknown }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (!text) {
      throw new Error('OpenAI transcription returned empty text')
    }
    return {
      title: 'Channel voice note',
      segments: [{ content: text }],
      summary: text,
    }
  }
}

let transcriptionProvider: TranscriptionProvider | null = null

export function createOpenAIBulkTranscriptionProvider(options: {
  apiKeyProvider: () => Promise<string | null>
  fetchImpl?: typeof fetch
}): TranscriptionProvider {
  return new OpenAITranscriptionProvider(new OpenAIBulkTranscriptionClient(options))
}

export function initializeInboundTranscriptionProvider(options: {
  providerSecretsStore: ProviderSecretsStoreLike
  fetchImpl?: typeof fetch
}): void {
  transcriptionProvider = createOpenAIBulkTranscriptionProvider({
    apiKeyProvider: () => options.providerSecretsStore.getSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID),
    fetchImpl: options.fetchImpl,
  })
}

export function setInboundTranscriptionProviderForTests(provider: TranscriptionProvider | null): void {
  transcriptionProvider = provider
}

export async function transcribeInboundAudio(
  buffer: Buffer,
  mimeType: string,
  options: TranscriptionOptions = {},
): Promise<string> {
  const context = buildVoiceTranscriptionContext({
    model: options.model,
    language: options.language,
    prompt: options.prompt,
    terms: options.terms,
  })
  return transcribePreservedAudio(
    { buffer, mimeType },
    {
      ...context,
      metadata: options.metadata,
    },
  )
}

export async function transcribePreservedAudio(
  audio: PreservedVoiceAudio,
  options: PreservedAudioTranscriptionOptions = {},
  provider: TranscriptionProvider | null = transcriptionProvider,
): Promise<string> {
  if (!provider) {
    throw new TranscriptionError('Inbound transcription provider is not initialized')
  }
  if (audio.buffer.length === 0) {
    throw new TranscriptionError('Inbound audio buffer is empty')
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-channel-audio-'))
  const audioPath = path.join(tempDir, `voice-note${extensionForMimeType(audio.mimeType)}`)
  try {
    await writeFile(audioPath, audio.buffer)
    const result = await provider.transcribe(audioPath, {
      model: options.model ?? DEFAULT_TRANSCRIPTION_MODEL,
      language: options.language,
      prompt: options.prompt,
      terms: options.terms,
      metadata: {
        ...(options.metadata ?? {}),
        mimeType: audio.mimeType,
        ...(audio.durationMs !== undefined ? { durationMs: audio.durationMs } : {}),
      },
    })
    const text = extractTranscriptText(result)
    if (!text) {
      throw new TranscriptionError('Transcription produced empty text')
    }
    return text
  } catch (error) {
    if (error instanceof TranscriptionError) {
      throw error
    }
    throw new TranscriptionError(
      error instanceof Error ? error.message : 'Transcription failed',
      { cause: error },
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function extractTranscriptText(result: TranscriptionResult): string {
  const segmentText = result.segments
    .map((segment) => segment.content.trim())
    .filter((content) => content.length > 0)
    .join('\n')
    .trim()
  return segmentText || result.summary.trim()
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('ogg') || normalized.includes('opus')) {
    return '.ogg'
  }
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return '.mp3'
  }
  if (normalized.includes('wav')) {
    return '.wav'
  }
  if (normalized.includes('m4a') || normalized.includes('mp4')) {
    return '.m4a'
  }
  return '.bin'
}

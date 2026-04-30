import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import {
  MIN_AUDIO_BUFFER_BYTES,
  OpenAIRealtimeClient,
  isTransientCommitRaceError,
} from '../openai-realtime'

function createSocketMock() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket
}

function attachSocket(client: OpenAIRealtimeClient, ws: WebSocket): void {
  ;(client as unknown as { ws: WebSocket | null }).ws = ws
}

function emitServerEvent(client: OpenAIRealtimeClient, payload: Record<string, unknown>): void {
  ;(
    client as unknown as {
      handleServerEvent(rawData: Buffer): void
    }
  ).handleServerEvent(Buffer.from(JSON.stringify(payload)))
}

function collectSentEventTypes(ws: WebSocket): string[] {
  return vi
    .mocked(ws.send)
    .mock
    .calls
    .map(([payload]) => JSON.parse(payload as string) as { type: string })
    .map((event) => event.type)
}

describe('OpenAIRealtimeClient commit guard', () => {
  it('blocks commit and emits audio_too_short until enough audio has been appended', () => {
    const client = new OpenAIRealtimeClient({ apiKey: 'sk-test' })
    const ws = createSocketMock()
    const errors: unknown[] = []

    attachSocket(client, ws)
    client.on('error', (payload) => {
      errors.push(payload)
    })

    client.sendAudio(Buffer.alloc(MIN_AUDIO_BUFFER_BYTES - 1, 1).toString('base64'))
    client.commitAudioBuffer()

    expect(collectSentEventTypes(ws)).toEqual(['input_audio_buffer.append'])
    expect(errors).toEqual([
      {
        code: 'audio_too_short',
        bytesAppended: MIN_AUDIO_BUFFER_BYTES - 1,
        message: 'Recording too short',
      },
    ])

    vi.mocked(ws.send).mockClear()
    errors.length = 0

    client.sendAudio(Buffer.alloc(MIN_AUDIO_BUFFER_BYTES, 1).toString('base64'))
    client.commitAudioBuffer()

    expect(collectSentEventTypes(ws)).toEqual([
      'input_audio_buffer.append',
      'input_audio_buffer.commit',
    ])
    expect(errors).toEqual([])
  })
})

describe('OpenAIRealtimeClient transient commit-race handling', () => {
  it('classifies upstream buffer-too-small errors as transient', () => {
    expect(
      isTransientCommitRaceError({
        code: 'audio_buffer_too_small',
        message:
          'Error committing input audio buffer: buffer too small. Expected at least 100ms of audio.',
      }),
    ).toBe(true)
    expect(
      isTransientCommitRaceError({
        message: 'OpenAI realtime transcription error',
      }),
    ).toBe(false)
  })

  it('drops transient upstream buffer-too-small errors without emitting client errors', () => {
    const client = new OpenAIRealtimeClient({ apiKey: 'sk-test' })
    const ws = createSocketMock()
    const errors: unknown[] = []

    attachSocket(client, ws)
    client.on('error', (payload) => {
      errors.push(payload)
    })

    emitServerEvent(client, {
      type: 'error',
      error: {
        code: 'audio_buffer_too_small',
        message:
          'Error committing input audio buffer: buffer too small. Expected at least 100ms of audio, but buffer only has 0.00ms of audio.',
      },
    })

    expect(errors).toEqual([])
    expect(ws.close).not.toHaveBeenCalled()
  })
})

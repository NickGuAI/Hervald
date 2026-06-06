import { describe, expect, it, vi } from 'vitest'
import {
  createOpenAIBulkTranscriptionProvider,
  transcribePreservedAudio,
} from '../stt'

describe('OpenAI bulk voice transcription', () => {
  it('uses the upgraded default model and sends prompt context with preserved terms', async () => {
    let capturedBody: FormData | null = null
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body instanceof FormData ? init.body : null
      return new Response(JSON.stringify({ text: 'Hammurabi uses Claude Code with gRPC.' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    })
    const provider = createOpenAIBulkTranscriptionProvider({
      apiKeyProvider: async () => 'sk-test',
      fetchImpl,
    })

    const text = await transcribePreservedAudio(
      {
        buffer: Buffer.from('test wav bytes'),
        mimeType: 'audio/wav',
      },
      {
        language: 'en',
        prompt: 'Preserve operator command terms.',
        terms: ['Hammurabi', 'Gehirn', 'Claude Code', 'OpenCode', 'PMAI', 'Kubernetes', 'gRPC'],
      },
      provider,
    )

    expect(text).toBe('Hammurabi uses Claude Code with gRPC.')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(capturedBody).not.toBeNull()
    const body = capturedBody as unknown as FormData
    expect(body.get('model')).toBe('gpt-4o-transcribe')
    expect(body.get('language')).toBe('en')
    expect(String(body.get('prompt'))).toContain('Preserve operator command terms.')
    expect(String(body.get('prompt'))).toContain('Hammurabi')
    expect(String(body.get('prompt'))).toContain('Claude Code')
    expect(String(body.get('prompt'))).toContain('gRPC')
    expect(body.get('model')).not.toBe('whisper-1')
  })
})

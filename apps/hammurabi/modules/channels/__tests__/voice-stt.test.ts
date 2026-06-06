import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyInboundVoicePreflight } from '../../commanders/routes/register-channels'
import {
  readTranscriptEvents,
  resetTranscriptStoreRoot,
  setTranscriptStoreRoot,
} from '../../agents/transcript-store'
import { buildConversationSessionName } from '../../commanders/routes/conversation-runtime'
import { setInboundTranscriptionProviderForTests } from '../../../server/voice/stt'
import { createChannelConversation, createMockAdapter, createTempChannelStores, makeInboundEvent } from './helpers'

afterEach(() => {
  setInboundTranscriptionProviderForTests(null)
  resetTranscriptStoreRoot()
})

describe('voice STT preflight', () => {
  it('runs only in core when inbound audio arrives for a voice-capable adapter', async () => {
    const stores = await createTempChannelStores()
    const transcriptRoot = await mkdtemp(join(tmpdir(), 'hammurabi-channel-stt-transcripts-'))
    setTranscriptStoreRoot(transcriptRoot)
    try {
      const transcribe = vi.fn(async () => ({
        title: 'voice',
        segments: [{ content: 'transcribed text' }],
        summary: 'transcribed text',
      }))
      setInboundTranscriptionProviderForTests({ provider: 'mock', transcribe })
      const adapter = createMockAdapter('whatsapp', true)
      const conversation = await createChannelConversation(stores.conversationStore, {
        voiceConfig: {
          stt: {
            model: 'gpt-4o-mini-transcribe',
            prompt: 'Preserve PMAI and Kubernetes deployment terms.',
            terms: ['VoiceFlow', 'Claude Code'],
          },
        },
      })
      const event = makeInboundEvent({
        text: undefined,
        audio: { buffer: Buffer.from('audio'), mimeType: 'audio/ogg', durationMs: 1200 },
      })

      const result = await applyInboundVoicePreflight({
        event,
        conversation,
        adapter,
        message: '',
        env: {
          HAMMURABI_DATA_DIR: stores.dataRoot,
        } as NodeJS.ProcessEnv,
      })

      expect(result).toEqual({ ok: true, message: 'transcribed text', transcribed: true })
      expect(transcribe).toHaveBeenCalledOnce()
      expect(transcribe.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          model: 'gpt-4o-mini-transcribe',
          language: 'en',
          prompt: expect.stringContaining('Preserve PMAI and Kubernetes deployment terms.'),
          terms: expect.arrayContaining([
            'Hammurabi',
            'Gehirn',
            'Claude Code',
            'OpenCode',
            'PMAI',
            'Kubernetes',
            'gRPC',
            'VoiceFlow',
            'whatsapp',
            'peer-1',
          ]),
          metadata: expect.objectContaining({
            mimeType: 'audio/ogg',
            durationMs: 1200,
          }),
        }),
      )
      expect(adapter.send).not.toHaveBeenCalled()
      const ledger = await readTranscriptEvents(buildConversationSessionName(conversation))
      expect(ledger).toEqual([
        expect.objectContaining({
          type: 'channel_voice_transcript',
          status: 'transcribed',
          transcript: 'transcribed text',
          audioRef: expect.objectContaining({ encoding: 'base64' }),
        }),
      ])
    } finally {
      await rm(transcriptRoot, { recursive: true, force: true })
      await stores.cleanup()
    }
  })
})

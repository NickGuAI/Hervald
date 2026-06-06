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

describe('voice STT failure handling', () => {
  it('drops the message and writes a transcript ledger entry when transcription fails', async () => {
    const stores = await createTempChannelStores()
    const transcriptRoot = await mkdtemp(join(tmpdir(), 'hammurabi-channel-stt-failure-'))
    setTranscriptStoreRoot(transcriptRoot)
    try {
      setInboundTranscriptionProviderForTests({
        provider: 'mock',
        transcribe: vi.fn(async () => {
          throw new Error('stt unavailable')
        }),
      })
      const conversation = await createChannelConversation(stores.conversationStore)
      const result = await applyInboundVoicePreflight({
        event: makeInboundEvent({
          text: undefined,
          audio: { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' },
        }),
        conversation,
        adapter: createMockAdapter('whatsapp', true),
        message: '',
        env: {
          HAMMURABI_DATA_DIR: stores.dataRoot,
        } as NodeJS.ProcessEnv,
      })

      expect(result).toEqual({ ok: false, reason: 'transcription-failed' })
      const ledger = await readTranscriptEvents(buildConversationSessionName(conversation))
      expect(ledger).toEqual([
        expect.objectContaining({
          type: 'channel_voice_transcript',
          status: 'failed',
          error: 'stt unavailable',
        }),
      ])
    } finally {
      await rm(transcriptRoot, { recursive: true, force: true })
      await stores.cleanup()
    }
  })
})

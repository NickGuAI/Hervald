import {
  parseChannelMessageInput,
  parseMessage,
  parseSessionId,
} from '../route-parsers.js'
import { appendTranscriptEvent } from '../../agents/transcript-store.js'
import { getChannelAdapter } from '../../channels/registry.js'
import { CommanderMismatchError, resolveInboundChannelMessage } from '../../channels/resolver.js'
import { TranscriptionError, transcribePreservedAudio } from '../../../server/voice/stt.js'
import { buildVoiceTranscriptionContext } from '../../../server/voice/transcription-context.js'
import {
  buildConversationSessionName,
  deliverConversationMessage,
  stopConversationSession,
} from './conversation-runtime.js'
import { resolveConversationVoiceConfig } from '../voice-config.js'
import type { ParsedChannelMessageInput } from '../route-parsers.js'
import type { ChannelAdapter, ChannelInboundEvent } from '../../channels/types.js'
import type { Conversation } from '../conversation-store.js'
import type { CommanderChannelMeta } from '../store.js'
import type { CommanderRoutesContext } from './types.js'

function requestAbortSignal(
  req: import('express').Request,
  res: import('express').Response,
): AbortSignal {
  const controller = new AbortController()
  let responseFinished = false
  const abort = () => {
    if (!responseFinished && !controller.signal.aborted) {
      controller.abort(new Error('HTTP request closed before response finished'))
    }
  }
  res.once('finish', () => {
    responseFinished = true
    req.off('aborted', abort)
    req.off('close', abort)
  })
  req.once('aborted', abort)
  req.once('close', abort)
  return controller.signal
}

function resolveParsedChannelDisplayName(
  meta: Pick<ParsedChannelMessageInput['channelMeta'], 'displayName' | 'peerId'>,
): string {
  return meta.displayName ?? meta.peerId
}

function toCommanderChannelMeta(parsed: ParsedChannelMessageInput): CommanderChannelMeta {
  return {
    ...parsed.channelMeta,
    // Channel webhooks often omit friendly names; persist one stable generic fallback.
    displayName: resolveParsedChannelDisplayName(parsed.channelMeta),
  }
}

function toInboundEvent(
  parsed: ParsedChannelMessageInput,
  channelMeta: CommanderChannelMeta,
): ChannelInboundEvent {
  return {
    provider: channelMeta.provider,
    accountId: channelMeta.accountId,
    chatType: channelMeta.chatType,
    peerId: channelMeta.peerId,
    peerDisplayName: channelMeta.displayName,
    groupId: channelMeta.groupId,
    threadId: channelMeta.threadId,
    ...(parsed.message ? { text: parsed.message } : {}),
    ...(parsed.audio ? { audio: parsed.audio } : {}),
    ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
    rawTimestamp: parsed.rawTimestamp,
    rawSourceId: parsed.rawSourceId,
  }
}

function voiceChannelTerms(input: {
  event: ChannelInboundEvent
  conversation: Conversation
}): string[] {
  return [
    input.event.provider,
    input.event.peerDisplayName,
    input.event.peerId,
    input.event.groupId,
    input.event.threadId,
    input.conversation.channelMeta?.displayName,
    input.conversation.channelMeta?.subject,
    input.conversation.channelMeta?.space,
  ].filter((term): term is string => typeof term === 'string' && term.trim().length > 0)
}

async function appendVoiceTranscriptLedgerEntry(input: {
  conversation: Conversation
  event: ChannelInboundEvent
  status: 'transcribed' | 'failed' | 'dropped'
  transcript?: string
  error?: unknown
}): Promise<void> {
  const audio = input.event.audio
  if (!audio) {
    return
  }
  await appendTranscriptEvent(buildConversationSessionName(input.conversation), {
    type: 'channel_voice_transcript',
    timestamp: new Date().toISOString(),
    status: input.status,
    provider: input.event.provider,
    accountId: input.event.accountId,
    peerId: input.event.peerId,
    threadId: input.event.threadId,
    rawSourceId: input.event.rawSourceId,
    ...(input.transcript ? { transcript: input.transcript } : {}),
    ...(input.error ? { error: input.error instanceof Error ? input.error.message : String(input.error) } : {}),
    audioRef: {
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      byteLength: audio.buffer.length,
      encoding: 'base64',
      data: audio.buffer.toString('base64'),
    },
  })
}

export async function applyInboundVoicePreflight(input: {
  event: ChannelInboundEvent
  conversation: Conversation
  adapter: ChannelAdapter | null
  message: string
  env?: NodeJS.ProcessEnv
}): Promise<
  | { ok: true; message: string; transcribed: boolean }
  | { ok: false; reason: 'transcription-failed' }
> {
  if (!input.event.audio || !input.adapter?.capabilities.voiceNotes) {
    return { ok: true, message: input.message, transcribed: false }
  }

  try {
    const voiceConfig = await resolveConversationVoiceConfig(input.conversation, input.env)
    if (!voiceConfig.stt.enabled) {
      return { ok: true, message: input.message, transcribed: false }
    }
    const context = buildVoiceTranscriptionContext({
      model: voiceConfig.stt.model,
      prompt: voiceConfig.stt.prompt,
      terms: [
        ...voiceConfig.stt.terms,
        ...voiceChannelTerms({
          event: input.event,
          conversation: input.conversation,
        }),
      ],
    })
    const transcript = await transcribePreservedAudio(input.event.audio, context)
    await appendVoiceTranscriptLedgerEntry({
      conversation: input.conversation,
      event: input.event,
      status: 'transcribed',
      transcript,
    })
    return { ok: true, message: transcript, transcribed: true }
  } catch (error) {
    await appendVoiceTranscriptLedgerEntry({
      conversation: input.conversation,
      event: input.event,
      status: 'failed',
      error: error instanceof TranscriptionError
        ? error
        : new TranscriptionError('Transcription failed', { cause: error }),
    })
    return { ok: false, reason: 'transcription-failed' }
  }
}

export function registerChannelRoutes(
  router: import('express').Router,
  context: CommanderRoutesContext,
): void {
  router.post('/channel-message', context.requireChannelIngestAccess, async (req, res) => {
    const parsed = parseChannelMessageInput(req.body)
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      const channelMeta = toCommanderChannelMeta(parsed.value)
      const event = toInboundEvent(parsed.value, channelMeta)
      const resolved = await resolveInboundChannelMessage(
        {
          event,
          commanderId: parsed.value.commanderId,
          channelMeta,
          lastRoute: parsed.value.lastRoute,
        },
        {
          surfaceBindingStore: context.surfaceBindingStore,
          accountBindingStore: context.channelBindingStore,
          conversationStore: context.conversationStore,
        },
      )

      if (!resolved.ok) {
        if (resolved.reason === 'ambiguous-account-binding') {
          res.status(409).json({
            error: 'Channel message matches multiple account bindings; specify commanderId',
          })
          return
        }
        res.status(202).json({
          accepted: true,
          delivered: false,
          dropped: true,
          reason: resolved.reason,
        })
        return
      }

      const commander = await context.sessionStore.get(resolved.conversation.commanderId)
      if (!commander) {
        if (resolved.conversation.status !== 'archived') {
          await stopConversationSession(context, resolved.conversation, 'archived').catch((cleanupError) => {
            console.warn(
              `[commanders] Failed to archive orphaned channel conversation "${resolved.conversation.id}" for missing commander "${resolved.conversation.commanderId}":`,
              cleanupError,
            )
          })
        }
        res.status(410).json({
          accepted: false,
          delivered: false,
          conversationId: resolved.conversation.id,
          commanderId: resolved.conversation.commanderId,
          error: `Channel surface "${resolved.binding.surfaceKey}" is bound to deleted commander "${resolved.conversation.commanderId}"`,
        })
        return
      }

      let message = parsed.value.message
      const adapter = getChannelAdapter(resolved.binding.provider)
      const voicePreflight = await applyInboundVoicePreflight({
        event,
        conversation: resolved.conversation,
        adapter,
        message,
      })
      if (!voicePreflight.ok) {
        res.status(202).json({
          accepted: true,
          delivered: false,
          dropped: true,
          reason: voicePreflight.reason,
        })
        return
      }
      message = voicePreflight.message

      if (!message.trim()) {
        if (event.audio) {
          await appendVoiceTranscriptLedgerEntry({
            conversation: resolved.conversation,
            event,
            status: 'dropped',
            error: 'no text after voice preflight',
          })
        }
        res.status(202).json({
          accepted: true,
          delivered: false,
          dropped: true,
          reason: 'empty-message',
        })
        return
      }

      const sendOptions = parsed.value.mode === 'collect'
        ? { queue: true, priority: 'normal' as const }
        : undefined

      const delivered = await deliverConversationMessage(
        context,
        resolved.conversation,
        { message },
        {
          ...sendOptions,
          autoStartIdle: true,
          dispatchChannelReplies: true,
          abortSignal: requestAbortSignal(req, res),
        },
      )

      if (!delivered.ok) {
        res.status(delivered.status).json({
          accepted: false,
          delivered: false,
          created: resolved.created,
          commanderId: commander.id,
          conversationId: resolved.conversation.id,
          sessionKey: channelMeta.sessionKey,
          error: delivered.error,
        })
        return
      }

      res.status(resolved.created ? 201 : 200).json({
        accepted: true,
        delivered: true,
        created: resolved.created,
        createdSession: delivered.createdSession,
        commanderId: commander.id,
        conversationId: delivered.conversation.id,
        sessionKey: channelMeta.sessionKey,
        surfaceKey: resolved.binding.surfaceKey,
      })
    } catch (error) {
      if (error instanceof CommanderMismatchError) {
        res.status(403).json({ error: error.message })
        return
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to route channel message',
      })
    }
  })

  router.post('/:id/channel-reply', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const message = parseMessage(req.body?.message) ?? parseMessage(req.body?.text)
    if (!message) {
      res.status(400).json({ error: 'message must be a non-empty string' })
      return
    }

    const conversationId = parseMessage(req.body?.conversationId) ?? undefined
    const delivered = await context.dispatchCommanderChannelReply({
      commanderId,
      message,
      ...(conversationId ? { conversationId } : {}),
    })
    if (!delivered.ok) {
      res.status(delivered.status).json({ error: delivered.error })
      return
    }

    res.json({
      accepted: true,
      delivered: true,
      commanderId,
      provider: delivered.provider,
      sessionKey: delivered.sessionKey,
      lastRoute: delivered.lastRoute,
    })
  })
}

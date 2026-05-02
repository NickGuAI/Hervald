import { readFile } from 'node:fs/promises'
import {
  parseChannelMessageInput,
  parseMessage,
  parseSessionId,
} from '../route-parsers.js'
import { resolveCommanderNamesPath } from '../paths.js'
import type { ParsedChannelMessageInput } from '../route-parsers.js'
import type { CommanderSession } from '../store.js'
import {
  deliverConversationMessage,
  stopConversationSession,
} from './conversation-runtime.js'
import type { CommanderRoutesContext } from './types.js'

type CommanderChannelResolution =
  | { ok: true; commander: CommanderSession }
  | { ok: false; status: 404 | 409; error: string }

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeCommanderAlias(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function aliasMentioned(alias: string, haystacks: readonly string[]): boolean {
  const normalizedAlias = normalizeCommanderAlias(alias)
  if (!normalizedAlias) {
    return false
  }

  const boundaryPattern = new RegExp(
    `(^|[^a-z0-9])@?${escapeRegex(normalizedAlias)}($|[^a-z0-9])`,
    'i',
  )
  return haystacks.some((haystack) => boundaryPattern.test(haystack))
}

async function readCommanderDisplayNames(dataDir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(resolveCommanderNamesPath(dataDir), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

async function resolveCommanderForInboundChannelMessage(
  context: CommanderRoutesContext,
  parsed: ParsedChannelMessageInput,
): Promise<CommanderChannelResolution> {
  if (parsed.commanderId) {
    const commander = await context.sessionStore.get(parsed.commanderId)
    if (!commander) {
      return {
        ok: false,
        status: 404,
        error: `Commander "${parsed.commanderId}" not found`,
      }
    }
    return { ok: true, commander }
  }

  const commanders = await context.sessionStore.list()
  const displayNames = await readCommanderDisplayNames(context.commanderDataDir)
  const haystacks = [
    parsed.message,
    parsed.channelMeta.displayName,
    parsed.channelMeta.subject,
    parsed.channelMeta.space,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeCommanderAlias(value))

  const matches = commanders.filter((commander) => {
    const aliases = new Set<string>([
      commander.host,
      displayNames[commander.id] ?? '',
    ])
    return [...aliases].some((alias) => aliasMentioned(alias, haystacks))
  })

  if (matches.length === 1) {
    return { ok: true, commander: matches[0] }
  }

  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      error: 'Channel message matches multiple commanders; specify commanderId',
    }
  }

  return {
    ok: false,
    status: 409,
    error: 'Channel message could not resolve a commander; specify commanderId',
  }
}

export function registerChannelRoutes(
  router: import('express').Router,
  context: CommanderRoutesContext,
): void {
  router.post('/channel-message', context.requireWriteAccess, async (req, res) => {
    const parsed = parseChannelMessageInput(req.body)
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      const conversations = await context.conversationStore.listAll()
      const existingConversation = conversations.find(
        (conversation) => conversation.channelMeta?.sessionKey === parsed.value.channelMeta.sessionKey,
      )

      let commander: CommanderSession
      if (existingConversation) {
        if (parsed.value.commanderId && parsed.value.commanderId !== existingConversation.commanderId) {
          res.status(409).json({
            error: `Channel session "${parsed.value.channelMeta.sessionKey}" already belongs to commander "${existingConversation.commanderId}"`,
          })
          return
        }

        const existingCommander = await context.sessionStore.get(existingConversation.commanderId)
        if (!existingCommander) {
          // Orphaned channel binding: the conversation's owning commander has
          // been deleted but the conversation row survived. Archive the
          // orphan defensively so it stops matching future webhook lookups,
          // then return 410 Gone so the inbound webhook treats this thread
          // as no longer routable. Fixes the 500-loop reported in
          // codex-review P1 on PR #1279 (comment 3174814198) for any
          // pre-existing orphans that still exist after the commander-delete
          // cascade-archive ships.
          if (existingConversation.status !== 'archived') {
            try {
              await stopConversationSession(context, existingConversation, 'archived')
            } catch (cleanupError) {
              console.warn(
                `[commanders] Failed to archive orphaned conversation "${existingConversation.id}" for missing commander "${existingConversation.commanderId}":`,
                cleanupError,
              )
            }
          }
          res.status(410).json({
            accepted: false,
            delivered: false,
            sessionKey: parsed.value.channelMeta.sessionKey,
            conversationId: existingConversation.id,
            commanderId: existingConversation.commanderId,
            error: `Channel session "${parsed.value.channelMeta.sessionKey}" is bound to deleted commander "${existingConversation.commanderId}"`,
          })
          return
        }
        commander = existingCommander
      } else {
        const resolved = await resolveCommanderForInboundChannelMessage(context, parsed.value)
        if (!resolved.ok) {
          res.status(resolved.status).json({ error: resolved.error })
          return
        }
        commander = resolved.commander
      }

      const upserted = await context.conversationStore.findOrCreateConversationBySessionKey(
        commander.id,
        parsed.value.channelMeta.sessionKey,
        {
          surface: parsed.value.channelMeta.provider,
          channelMeta: parsed.value.channelMeta,
          lastRoute: parsed.value.lastRoute,
        },
      )

      // Mode semantics: `collect` defers the message into the queue lane
      // (batched, not interrupted) while `followup` is the live-send default.
      // Without this branch, channel inputs that explicitly opt into collect
      // mode were being sent live, breaking the agreed buffering contract.
      // See codex-review P1 on PR #1279 (comment 3174491798).
      const sendOptions = parsed.value.mode === 'collect'
        ? { queue: true, priority: 'normal' as const }
        : undefined

      // Channel webhooks are one-way ingress — they cannot manually call
      // POST /api/conversations/:id/start. The first inbound message for a
      // newly-created (or paused-and-now-idle) channel conversation IS the
      // implicit start signal. `autoStartIdle: true` opts into resume-on-input
      // for channel surfaces only; UI surfaces stay on the explicit-Start
      // contract. See codex-review P1 on PR #1279 (comment 3174904129).
      const delivered = await deliverConversationMessage(
        context,
        upserted.conversation,
        parsed.value.message,
        {
          ...sendOptions,
          autoStartIdle: true,
        },
      )

      if (!delivered.ok) {
        res.status(delivered.status).json({
          accepted: false,
          delivered: false,
          created: upserted.created,
          commanderId: commander.id,
          conversationId: upserted.conversation.id,
          sessionKey: parsed.value.channelMeta.sessionKey,
          error: delivered.error,
        })
        return
      }

      res.status(upserted.created ? 201 : 200).json({
        accepted: true,
        delivered: true,
        created: upserted.created,
        createdSession: delivered.createdSession,
        commanderId: commander.id,
        conversationId: delivered.conversation.id,
        sessionKey: parsed.value.channelMeta.sessionKey,
      })
    } catch (error) {
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

    const message = parseMessage(req.body?.message)
    if (!message) {
      res.status(400).json({ error: 'message must be a non-empty string' })
      return
    }

    const delivered = await context.dispatchCommanderChannelReply({
      commanderId,
      message,
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

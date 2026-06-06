import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import { SESSION_NAME_PATTERN } from './constants.js'
import { projectSessionReplay } from './messages/projection.js'
import { readCodexThreadId } from './providers/provider-session-context.js'
import {
  MESSAGE_IMAGE_WEBSOCKET_MAX_PAYLOAD_BYTES,
  parseMessageImagesForRequest,
} from './message-images.js'
import {
  applyWorkspaceContextToText,
  readWorkspaceContextPayload,
} from '../workspace/context.js'
import type { WorkspaceResolverCapability } from '../workspace/capability.js'
import { toWorkspaceError } from '../workspace/resolver.js'
import {
  buildToolAnswerPayload,
  deliverPlanApprovalDecision,
  findPlanApprovalEvent,
  firstToolAnswerValue,
  parsePlanApprovalDecision,
  type ToolAnswerMap,
} from './plan-approval.js'
import {
  deliverCodexMcpElicitationQuestionAnswer,
  findCodexMcpElicitationQuestionEvent,
} from './adapters/codex/elicitation.js'
import { attachWebSocketKeepAlive } from './session/helpers.js'
import type {
  AnySession,
  ExternalSession,
  StreamJsonEvent,
  StreamSession,
} from './types.js'

export const WS_REPLAY_TAIL_LIMIT = 200

export interface AgentsWebSocketContext {
  sessions: Map<string, AnySession>
  verifyWsAuth(req: IncomingMessage): Promise<boolean>
  wsKeepAliveIntervalMs: number
  getQueueUpdatePayload(session: StreamSession): Extract<StreamJsonEvent, { type: 'queue_update' }>
  broadcastStreamEvent(session: StreamSession | ExternalSession, event: StreamJsonEvent): void
  sendImmediateTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: { mediaType: string; data: string }[],
    displayText?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  getWorkspaceResolver?: () => WorkspaceResolverCapability | undefined
  writeToStdin(session: StreamSession, data: string): boolean
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  scheduleTurnWatchdog?: (session: StreamSession) => void
  schedulePersistedSessionsWrite(): void
}

function extractSessionNameFromUrl(url: URL): string | null {
  // Expected path: /api/agents/sessions/:name/ws
  const match = url.pathname.match(/\/sessions\/([^/]+)\/ws$/)
  if (!match) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    return null
  }

  return SESSION_NAME_PATTERN.test(decoded) ? decoded : null
}

function hasLatestSystemEvent(session: StreamSession, text: string): boolean {
  const latest = session.events.at(-1)
  return latest?.type === 'system' && latest.text === text
}

export function createAgentsWebSocket(ctx: AgentsWebSocketContext): {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
} {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MESSAGE_IMAGE_WEBSOCKET_MAX_PAYLOAD_BYTES,
  })
  const {
    sessions,
    verifyWsAuth,
    wsKeepAliveIntervalMs,
    getQueueUpdatePayload,
    broadcastStreamEvent,
    sendImmediateTextToStreamSession,
    getWorkspaceResolver,
    writeToStdin,
    appendStreamEvent,
    scheduleTurnWatchdog,
    schedulePersistedSessionsWrite,
  } = ctx

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const sessionName = extractSessionNameFromUrl(url)

    if (!sessionName) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    void verifyWsAuth(req).then((authorized) => {
      if (!authorized) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const session = sessions.get(sessionName)
      if (!session) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (session.kind === 'stream' || session.kind === 'external') {
          // Stream/external session: send buffered events as JSON array for replay.
          // Include the accumulated usage so the client can set totals
          // directly rather than re-accumulating from individual deltas.
          if (session.events.length > 0) {
            const replayEvents = session.events.slice(-WS_REPLAY_TAIL_LIMIT)
            const replayMore = session.events.length > WS_REPLAY_TAIL_LIMIT
            const queue = session.kind === 'stream' ? getQueueUpdatePayload(session).queue : undefined
            const projection = projectSessionReplay({
              events: replayEvents,
              totalEvents: session.events.length,
              more: replayMore,
              ...(session.kind === 'stream' ? { usage: session.usage } : {}),
              ...(queue ? { queue } : {}),
            })
            ws.send(JSON.stringify({
              type: 'replay',
              events: replayEvents,
              ...(projection.envelopes ? { envelopes: projection.envelopes } : {}),
              messages: projection.messages,
              projection,
              more: replayMore,
              ...(session.kind === 'stream'
                ? { usage: session.usage, queue }
                : {}),
            }))
          }

          session.clients.add(ws)
          const stopKeepAlive = attachWebSocketKeepAlive(ws, wsKeepAliveIntervalMs, () => {
            // Use live session - may differ from `session` if a respawn occurred.
            sessions.get(sessionName)?.clients.delete(ws)
          })

          ws.on('message', async (data) => {
            // Look up the live session on every message - the map entry may have
            // been replaced by a respawn while this WS connection is still open.
            // Using the stale closed-over `session` after a respawn would write to
            // the dead process and trigger repeated respawn loops.
            const liveSession = sessions.get(sessionName)
            if (!liveSession || liveSession.kind === 'pty') {
              ws.close(4004, 'Session not found')
              return
            }

            // External sessions are read-only viewers - ignore input from WS clients.
            if (liveSession.kind === 'external') return

            try {
              const msg = JSON.parse(data.toString()) as {
                type: string
                text?: string
                images?: { mediaType: string; data: string }[]
                workspaceContext?: unknown
                toolId?: string
                answers?: Record<string, string[]>
              }

              if (msg.type === 'input') {
                const rawInputText = typeof msg.text === 'string' ? msg.text.trim() : ''
                const workspaceContext = readWorkspaceContextPayload(msg.workspaceContext)
                let inputText: string
                try {
                  inputText = await applyWorkspaceContextToText({
                    text: rawInputText,
                    resolver: workspaceContext?.targetId ? getWorkspaceResolver?.() : undefined,
                    context: workspaceContext,
                  })
                } catch (error) {
                  const workspaceError = toWorkspaceError(error)
                  const errEvent: StreamJsonEvent = {
                    type: 'system',
                    text: workspaceError.message,
                  }
                  broadcastStreamEvent(liveSession, errEvent)
                  return
                }
                const parsedImages = parseMessageImagesForRequest(msg.images)

                if (!parsedImages.ok) {
                  const errEvent: StreamJsonEvent = {
                    type: 'system',
                    text: `Image rejected: ${parsedImages.error}`,
                  }
                  broadcastStreamEvent(liveSession, errEvent)
                  return
                }
                const validImages = parsedImages.images

                if (inputText || validImages.length > 0) {
                  const immediateResult = await sendImmediateTextToStreamSession(
                    liveSession,
                    inputText,
                    validImages,
                    rawInputText,
                  )
                  if (!immediateResult.ok) {
                    if (!hasLatestSystemEvent(liveSession, immediateResult.error)) {
                      const errEvent: StreamJsonEvent = {
                        type: 'system',
                        text: immediateResult.error,
                      }
                      broadcastStreamEvent(liveSession, errEvent)
                    }
                  }
                } // end if (inputText || validImages.length > 0)
              } else if (msg.type === 'tool_answer' && msg.toolId && msg.answers) {
                const planApproval = findPlanApprovalEvent(liveSession, msg.toolId)
                if (planApproval) {
                  const answers = msg.answers as ToolAnswerMap
                  const decision = parsePlanApprovalDecision(firstToolAnswerValue(answers, ['decision', 'approved']))
                  if (!decision) {
                    ws.send(JSON.stringify({ type: 'tool_answer_error', toolId: msg.toolId }))
                    return
                  }
                  const message = firstToolAnswerValue(answers, ['message', 'response', 'customResponse'])
                  const result = deliverPlanApprovalDecision(
                    liveSession,
                    planApproval,
                    decision,
                    message,
                    writeToStdin,
                  )
                  if (!result.ok) {
                    ws.send(JSON.stringify({ type: 'tool_answer_error', toolId: msg.toolId }))
                    return
                  }

                  appendStreamEvent(liveSession, result.payload)
                  broadcastStreamEvent(liveSession, result.payload)
                  if (readCodexThreadId(liveSession) && !liveSession.lastTurnCompleted) {
                    scheduleTurnWatchdog?.(liveSession)
                  }
                  schedulePersistedSessionsWrite()
                  ws.send(JSON.stringify({ type: 'tool_answer_ack', toolId: msg.toolId }))
                  return
                }

                const codexElicitationQuestion = findCodexMcpElicitationQuestionEvent(liveSession, msg.toolId)
                if (codexElicitationQuestion) {
                  const result = deliverCodexMcpElicitationQuestionAnswer(
                    liveSession,
                    codexElicitationQuestion,
                    msg.answers as ToolAnswerMap,
                  )
                  if (!result.ok) {
                    ws.send(JSON.stringify({ type: 'tool_answer_error', toolId: msg.toolId }))
                    return
                  }
                  appendStreamEvent(liveSession, result.payload)
                  broadcastStreamEvent(liveSession, result.payload)
                  if (readCodexThreadId(liveSession) && !liveSession.lastTurnCompleted) {
                    scheduleTurnWatchdog?.(liveSession)
                  }
                  schedulePersistedSessionsWrite()
                  ws.send(JSON.stringify({ type: 'tool_answer_ack', toolId: msg.toolId }))
                  return
                }

                if (readCodexThreadId(liveSession)) {
                  ws.send(JSON.stringify({ type: 'tool_answer_error', toolId: msg.toolId }))
                  return
                }

                const toolResultPayload = buildToolAnswerPayload(
                  liveSession,
                  msg.toolId,
                  msg.answers as ToolAnswerMap,
                )
                if (!toolResultPayload) {
                  ws.send(JSON.stringify({ type: 'tool_answer_error', toolId: msg.toolId }))
                  return
                }
                // Persist tool answer in session events for replay on reconnect
                appendStreamEvent(liveSession, toolResultPayload)
                broadcastStreamEvent(liveSession, toolResultPayload)

                const ok = writeToStdin(liveSession, JSON.stringify(toolResultPayload) + '\n')
                if (ok) {
                  ws.send(JSON.stringify({ type: 'tool_answer_ack', toolId: msg.toolId }))
                } else {
                  ws.send(JSON.stringify({ type: 'tool_answer_error', toolId: msg.toolId }))
                }
              }
            } catch {
              // Ignore invalid messages
            }
          })

          ws.on('close', () => {
            stopKeepAlive()
            sessions.get(sessionName)?.clients.delete(ws)
          })

          ws.on('error', () => {
            stopKeepAlive()
            sessions.get(sessionName)?.clients.delete(ws)
          })
          return
        }

        // PTY session (unchanged)
        if (session.buffer.length > 0) {
          ws.send(Buffer.from(session.buffer), { binary: true })
        }

        session.clients.add(ws)
        const stopKeepAlive = attachWebSocketKeepAlive(ws, wsKeepAliveIntervalMs, () => {
          session.clients.delete(ws)
        })

        ws.on('message', (data, isBinary) => {
          if (!sessions.has(sessionName)) {
            ws.close(4004, 'Session not found')
            return
          }

          if (isBinary) {
            session.pty.write(data.toString())
          } else {
            try {
              const msg = JSON.parse(data.toString()) as { type: string; cols?: number; rows?: number }
              if (
                msg.type === 'resize' &&
                typeof msg.cols === 'number' &&
                typeof msg.rows === 'number' &&
                Number.isFinite(msg.cols) &&
                Number.isFinite(msg.rows) &&
                msg.cols >= 1 &&
                msg.cols <= 500 &&
                msg.rows >= 1 &&
                msg.rows <= 500
              ) {
                session.pty.resize(msg.cols, msg.rows)
              }
            } catch {
              // Ignore invalid control messages
            }
          }
        })

        ws.on('close', () => {
          stopKeepAlive()
          session.clients.delete(ws)
        })

        ws.on('error', () => {
          stopKeepAlive()
          session.clients.delete(ws)
        })
      })
    })
  }

  return { handleUpgrade }
}

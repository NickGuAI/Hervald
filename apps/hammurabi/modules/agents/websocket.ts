import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import { SESSION_NAME_PATTERN } from './constants.js'
import {
  readClaudeSessionId,
  readCodexThreadId,
} from './providers/provider-session-context.js'
import { attachWebSocketKeepAlive } from './session/helpers.js'
import type {
  AnySession,
  ExternalSession,
  MachineConfig,
  StreamJsonEvent,
  StreamSession,
  StreamSessionCreateOptions,
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
  ): Promise<{ ok: true } | { ok: false; error: string }>
  writeToStdin(session: StreamSession, data: string): boolean
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  readMachineRegistry(): Promise<MachineConfig[]>
  createStreamSession(
    sessionName: string,
    mode: StreamSession['mode'],
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: StreamSession['agentType'],
    options?: StreamSessionCreateOptions,
  ): StreamSession
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

export function createAgentsWebSocket(ctx: AgentsWebSocketContext): {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
} {
  const wss = new WebSocketServer({ noServer: true })
  const {
    sessions,
    verifyWsAuth,
    wsKeepAliveIntervalMs,
    getQueueUpdatePayload,
    broadcastStreamEvent,
    sendImmediateTextToStreamSession,
    writeToStdin,
    appendStreamEvent,
    readMachineRegistry,
    createStreamSession,
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
            ws.send(JSON.stringify({
              type: 'replay',
              events: replayEvents,
              more: session.events.length > WS_REPLAY_TAIL_LIMIT,
              ...(session.kind === 'stream'
                ? { usage: session.usage, queue: getQueueUpdatePayload(session).queue }
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
                toolId?: string
                answers?: Record<string, string[]>
              }

              if (msg.type === 'input') {
                const inputText = typeof msg.text === 'string' ? msg.text.trim() : ''

                // Validate attached images: allowed MIME types, max 20 MB each (≈26.67 MB base64), max 5 total
                const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
                const MAX_B64_LEN = Math.ceil(20 * 1024 * 1024 / 3) * 4
                const rawImages = Array.isArray(msg.images) ? msg.images : []
                const validImages = rawImages.filter(
                  (img) =>
                    img !== null &&
                    typeof img === 'object' &&
                    typeof img.mediaType === 'string' &&
                    ALLOWED_IMAGE_TYPES.has(img.mediaType) &&
                    typeof img.data === 'string' &&
                    img.data.length <= MAX_B64_LEN,
                ).slice(0, 5)

                if (rawImages.length > 0 && validImages.length === 0) {
                  const errEvent: StreamJsonEvent = {
                    type: 'system',
                    text: 'Image rejected: unsupported type, too large (max 20 MB each), or limit exceeded.',
                  }
                  broadcastStreamEvent(liveSession, errEvent)
                }

                if (inputText || validImages.length > 0) {
                  if (liveSession.agentType === 'gemini') {
                    if (rawImages.length > 0) {
                      const imageEvent: StreamJsonEvent = {
                        type: 'system',
                        text: inputText
                          ? 'Image attachments are not supported in Gemini sessions. Sending text only.'
                          : 'Image attachments are not supported in Gemini sessions.',
                      }
                      broadcastStreamEvent(liveSession, imageEvent)
                    }

                    if (inputText) {
                      const immediateResult = await sendImmediateTextToStreamSession(liveSession, inputText)
                      if (!immediateResult.ok) {
                        const errEvent: StreamJsonEvent = {
                          type: 'system',
                          text: immediateResult.error,
                        }
                        broadcastStreamEvent(liveSession, errEvent)
                      }
                    }
                    return
                  }

                  if (validImages.length === 0) {
                    const immediateResult = await sendImmediateTextToStreamSession(liveSession, inputText)
                    if (!immediateResult.ok) {
                      const errEvent: StreamJsonEvent = {
                        type: 'system',
                        text: immediateResult.error,
                      }
                      broadcastStreamEvent(liveSession, errEvent)
                    }
                    return
                  }

                  // For codex sessions, use the sidecar transport and only
                  // record the user event after Codex accepts the turn.
                  const resumeThreadId = readCodexThreadId(liveSession)
                  if (resumeThreadId) {
                    if (!inputText) {
                      const errEvent: StreamJsonEvent = {
                        type: 'system',
                        text: 'Image-only messages are not supported in Codex sessions. Please include text with your image.',
                      }
                      broadcastStreamEvent(liveSession, errEvent)
                    } else {
                      console.warn(`[agents] Codex session ${sessionName}: ignoring ${validImages.length} image(s) — not yet supported`)
                      const immediateResult = await sendImmediateTextToStreamSession(liveSession, inputText)
                      if (!immediateResult.ok) {
                        const errEvent: StreamJsonEvent = {
                          type: 'system',
                          text: immediateResult.error,
                        }
                        broadcastStreamEvent(liveSession, errEvent)
                      }
                    }
                  } else {
                    // Clear completed state on new input so the RPG world-state poller
                    // immediately sees the session as active again. Command-room sessions
                    // are intentionally one-shot and must remain in completed state.
                    if (
                      liveSession.lastTurnCompleted &&
                      liveSession.sessionType !== 'cron' &&
                      liveSession.sessionType !== 'automation'
                    ) {
                      liveSession.lastTurnCompleted = false
                      liveSession.completedTurnAt = undefined
                    }

                    // Build content: array with text+image blocks when images present, plain string otherwise
                    const content = validImages.length > 0
                      ? [
                          ...(inputText ? [{ type: 'text', text: inputText }] : []),
                          ...validImages.map((img) => ({
                            type: 'image',
                            source: { type: 'base64', media_type: img.mediaType, data: img.data },
                          })),
                        ]
                      : inputText

                    // Persist user message in session events for replay on reconnect
                    // only after stdin accepts the write to avoid phantom history
                    const userEvent: StreamJsonEvent = {
                      type: 'user',
                      message: { role: 'user', content },
                    } as unknown as StreamJsonEvent

                    const userMsg = JSON.stringify({
                      type: 'user',
                      message: { role: 'user', content },
                    })
                    const wrote = writeToStdin(liveSession, userMsg + '\n')
                    if (wrote) {
                      appendStreamEvent(liveSession, userEvent)
                      broadcastStreamEvent(liveSession, userEvent)
                    } else if (!liveSession.process.stdin?.writable && readClaudeSessionId(liveSession)) {
                      // Process exited after its last turn — respawn with --resume
                      // and relay the pending user message once the new process is ready.
                      const resumeId = readClaudeSessionId(liveSession)!
                      const pendingInput = userMsg + '\n'
                      void readMachineRegistry()
                        .then((machines) => {
                          const machine = liveSession.host
                            ? machines.find((candidate) => candidate.id === liveSession.host)
                            : undefined
                          const newSession = createStreamSession(
                            sessionName,
                            liveSession.mode,
                            '',
                            liveSession.cwd,
                            machine,
                            'claude',
                            {
                              effort: liveSession.effort,
                              adaptiveThinking: liveSession.adaptiveThinking,
                              model: liveSession.model,
                              systemPrompt: liveSession.systemPrompt,
                              maxTurns: liveSession.maxTurns,
                              resumeSessionId: resumeId,
                              creator: liveSession.creator,
                              sessionType: liveSession.sessionType,
                              spawnedBy: liveSession.spawnedBy,
                              spawnedWorkers: liveSession.spawnedWorkers,
                              resumedFrom: liveSession.resumedFrom,
                            },
                          )
                          newSession.events = liveSession.events.slice()
                          newSession.usage = { ...liveSession.usage }
                          newSession.conversationEntryCount = liveSession.conversationEntryCount
                          newSession.autoRotatePending = liveSession.autoRotatePending
                          // Transfer connected WebSocket clients before swapping the
                          // map entry so broadcasts from the new process reach them.
                          for (const client of liveSession.clients) {
                            newSession.clients.add(client)
                          }
                          liveSession.clients.clear()
                          sessions.set(sessionName, newSession)
                          schedulePersistedSessionsWrite()
                          const systemEvent: StreamJsonEvent = {
                            type: 'system',
                            text: 'Session resumed — replaying your command...',
                          }
                          appendStreamEvent(newSession, systemEvent)
                          broadcastStreamEvent(newSession, systemEvent)
                          // Write the pending input once the new process signals
                          // readiness via its first stdout chunk (message_start).
                          newSession.process.stdout?.once('data', () => {
                            setTimeout(() => {
                              if (writeToStdin(newSession, pendingInput)) {
                                appendStreamEvent(newSession, userEvent)
                                broadcastStreamEvent(newSession, userEvent)
                              }
                            }, 500)
                          })
                        })
                        .catch(() => {})
                    }
                  }
                } // end if (inputText || validImages.length > 0)
              } else if (msg.type === 'tool_answer' && msg.toolId && msg.answers && !readCodexThreadId(liveSession)) {
                // Serialize string[] values to comma-separated strings
                // per the AskUserQuestion contract (answers: Record<string, string>)
                const serialized: Record<string, string> = {}
                for (const [key, val] of Object.entries(msg.answers)) {
                  serialized[key] = Array.isArray(val) ? val.join(', ') : String(val)
                }
                const toolResultPayload = {
                  type: 'user' as const,
                  message: {
                    role: 'user' as const,
                    content: [{
                      type: 'tool_result',
                      tool_use_id: msg.toolId,
                      content: JSON.stringify({ answers: serialized, annotations: {} }),
                    }],
                  },
                }
                // Persist tool answer in session events for replay on reconnect
                appendStreamEvent(liveSession, toolResultPayload as unknown as StreamJsonEvent)
                broadcastStreamEvent(liveSession, toolResultPayload as unknown as StreamJsonEvent)

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

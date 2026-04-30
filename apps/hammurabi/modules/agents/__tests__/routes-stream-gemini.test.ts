import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import type { PtySpawner } from '../routes'
import {
  AUTH_HEADERS,
  READ_ONLY_AUTH_HEADERS,
  appendTranscriptEvent,
  connectWs,
  connectWsWithReplay,
  createMissingMachinesRegistryPath,
  createMockChildProcess,
  createMockPtyHandle,
  createMockPtySpawner,
  createTempMachinesRegistry,
  installMockCodexSidecar,
  installMockGeminiAcpRuntime,
  mockedNodePtySpawn,
  mockedSpawn,
  setTranscriptStoreRoot,
  startServer,
  writeSessionMeta,
} from './routes-test-harness'
import type { MockCodexSidecar, MockGeminiAcpRuntime, RunningServer } from './routes-test-harness'


describe("stream sessions", () => {
  function installMockProcess() {
      const mock = createMockChildProcess()
      mockedSpawn.mockReturnValue(mock.cp as never)
      return mock
    }

  afterEach(() => {
      mockedSpawn.mockRestore()
    })

  it('routes Gemini WebSocket input through ACP prompt and normalized events', async () => {
      const geminiAcp = installMockGeminiAcpRuntime()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'gemini-ws-input',
            mode: 'default',
            agentType: 'gemini',
          }),
        })

        expect(createResponse.status).toBe(201)
        expect(geminiAcp.requests.some((request) => request.method === 'session/new')).toBe(true)
        expect(geminiAcp.requests.some((request) => request.method === 'session/set_mode')).toBe(false)

        const ws = await connectWs(server.baseUrl, 'gemini-ws-input')
        const received: Array<{ type: string; source?: { provider?: string; backend?: string } }> = []

        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; source?: { provider?: string; backend?: string } }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        ws.send(JSON.stringify({ type: 'input', text: 'What files handle auth?' }))

        await vi.waitFor(() => {
          expect(geminiAcp.requests.some((request) => request.method === 'session/prompt')).toBe(true)
          expect(geminiAcp.promptTexts).toEqual(['What files handle auth?'])
        })

        await vi.waitFor(() => {
          expect(received
            .filter((message) => message.type !== 'queue_update')
            .map((message) => message.type)).toEqual([
            'user',
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop',
            'result',
          ])
        })

        expect(received).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'message_start',
            source: { provider: 'gemini', backend: 'acp' },
          }),
          expect.objectContaining({
            type: 'content_block_delta',
            source: { provider: 'gemini', backend: 'acp' },
          }),
          expect.objectContaining({
            type: 'result',
            source: { provider: 'gemini', backend: 'acp' },
          }),
        ]))

        ws.close()
      } finally {
        await server.close()
      }
    })

  it('rejects Gemini WebSocket image attachments with a clear system message', async () => {
      const geminiAcp = installMockGeminiAcpRuntime()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'gemini-ws-images',
            mode: 'default',
            agentType: 'gemini',
          }),
        })

        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'gemini-ws-images')
        const received: Array<{ type: string; text?: string }> = []

        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        ws.send(JSON.stringify({
          type: 'input',
          images: [{
            mediaType: 'image/png',
            data: Buffer.from('fake-image-bytes').toString('base64'),
          }],
        }))

        await vi.waitFor(() => {
          expect(received).toEqual([
            {
              type: 'system',
              text: 'Image attachments are not supported in Gemini sessions.',
            },
          ])
        })

        expect(geminiAcp.requests.some((request) => request.method === 'session/prompt')).toBe(false)
        expect(geminiAcp.promptTexts).toEqual([])

        ws.close()
      } finally {
        await server.close()
      }
    })

  it('warns on Gemini WebSocket image attachments and still sends text-only prompts', async () => {
      const geminiAcp = installMockGeminiAcpRuntime()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'gemini-ws-text-and-images',
            mode: 'default',
            agentType: 'gemini',
          }),
        })

        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'gemini-ws-text-and-images')
        const received: Array<{ type: string; text?: string }> = []

        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        ws.send(JSON.stringify({
          type: 'input',
          text: 'Describe the auth files.',
          images: [{
            mediaType: 'image/png',
            data: Buffer.from('fake-image-bytes').toString('base64'),
          }],
        }))

        await vi.waitFor(() => {
          expect(received).toEqual(expect.arrayContaining([
            {
              type: 'system',
              text: 'Image attachments are not supported in Gemini sessions. Sending text only.',
            },
          ]))
          expect(geminiAcp.promptTexts).toEqual(['Describe the auth files.'])
        })

        ws.close()
      } finally {
        await server.close()
      }
    })

  it('creates, prompts, and resumes Gemini ACP sessions without replaying provider history', async () => {
      const geminiAcp = installMockGeminiAcpRuntime()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'gemini-acp',
            mode: 'default',
            agentType: 'gemini',
          }),
        })

        expect(createResponse.status).toBe(201)
        expect(geminiAcp.requests.some((request) => request.method === 'session/new')).toBe(true)
        expect(geminiAcp.requests.some((request) => request.method === 'session/set_mode')).toBe(false)

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'hello gemini' }),
        })

        expect(sendResponse.status).toBe(200)
        expect(geminiAcp.promptTexts).toEqual(['hello gemini'])

        const liveSession = server.agents.sessionsInterface.getSession('gemini-acp')
        expect(liveSession?.agentType).toBe('gemini')
        expect(liveSession?.events).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'message_start',
            source: { provider: 'gemini', backend: 'acp' },
          }),
          expect.objectContaining({
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'pondering...' },
            source: { provider: 'gemini', backend: 'acp' },
          }),
          expect.objectContaining({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'reply 1' },
            source: { provider: 'gemini', backend: 'acp' },
          }),
          expect.objectContaining({
            type: 'message_delta',
            usage: { input_tokens: 5, output_tokens: 7 },
            source: { provider: 'gemini', backend: 'acp' },
          }),
          expect.objectContaining({
            type: 'result',
            result: 'Turn completed',
            source: { provider: 'gemini', backend: 'acp' },
          }),
        ]))

        const deleteResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(deleteResponse.status).toBe(200)

        const resumeResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp/resume`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
        expect(resumeResponse.status).toBe(201)
        expect(geminiAcp.requests.some((request) => request.method === 'session/load')).toBe(true)

        const resumedSession = server.agents.sessionsInterface.getSession('gemini-acp')
        expect(resumedSession?.agentType).toBe('gemini')
        expect(resumedSession?.events).toEqual([])

        const resumedSendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'hello again' }),
        })

        expect(resumedSendResponse.status).toBe(200)
        expect(geminiAcp.promptTexts).toEqual(['hello gemini', 'hello again'])
      } finally {
        await server.close()
      }
    })

  it('delivers a second /send directly while a Gemini turn is still in flight', async () => {
      const geminiAcp = installMockGeminiAcpRuntime()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'gemini-acp-active-send',
            mode: 'default',
            agentType: 'gemini',
          }),
        })

        expect(createResponse.status).toBe(201)

        const liveSession = server.agents.sessionsInterface.getSession('gemini-acp-active-send')
        expect(liveSession?.kind).toBe('stream')
        expect(liveSession?.agentType).toBe('gemini')
        expect(liveSession?.adapter).toBeDefined()

        geminiAcp.deferNextPromptResult()
        const firstSendPromise = fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp-active-send/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'first active gemini turn' }),
        })

        await vi.waitFor(() => {
          expect(geminiAcp.promptTexts).toEqual(['first active gemini turn'])
        })

        const secondSendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp-active-send/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'interrupt follow-up' }),
        })

        expect(secondSendResponse.status).toBe(200)
        expect(await secondSendResponse.json()).toEqual({ sent: true })

        await vi.waitFor(() => {
          expect(geminiAcp.promptTexts).toEqual([
            'first active gemini turn',
            'interrupt follow-up',
          ])
        })

        const queueResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp-active-send/queue`, {
          headers: AUTH_HEADERS,
        })
        expect(queueResponse.status).toBe(200)
        expect(await queueResponse.json()).toMatchObject({
          items: [],
          currentMessage: null,
          totalCount: 0,
        })

        geminiAcp.releaseDeferredPromptResults()

        const firstSendResponse = await firstSendPromise
        expect(firstSendResponse.status).toBe(200)
        expect(await firstSendResponse.json()).toEqual({ sent: true })
      } finally {
        await server.close()
      }
    })

  it('keeps queue=true on SessionMessageQueue semantics while a Gemini turn is active', async () => {
      const geminiAcp = installMockGeminiAcpRuntime()
      const server = await startServer()
      let ws: Awaited<ReturnType<typeof connectWs>> | undefined

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'gemini-acp-queued-send',
            mode: 'default',
            agentType: 'gemini',
          }),
        })

        expect(createResponse.status).toBe(201)

        const liveSession = server.agents.sessionsInterface.getSession('gemini-acp-queued-send')
        expect(liveSession?.kind).toBe('stream')
        expect(liveSession?.agentType).toBe('gemini')
        expect(liveSession?.adapter).toBeDefined()

        geminiAcp.deferNextPromptResult()
        ws = await connectWs(server.baseUrl, 'gemini-acp-queued-send')
        ws.send(JSON.stringify({ type: 'input', text: 'first active gemini turn' }))

        await vi.waitFor(() => {
          expect(geminiAcp.promptTexts).toEqual(['first active gemini turn'])
        })

        const queueResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp-queued-send/message?queue=true`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'queued follow-up' }),
        })

        expect(queueResponse.status).toBe(202)
        expect(await queueResponse.json()).toMatchObject({ queued: true, position: 1 })

        const snapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp-queued-send/queue`, {
          headers: AUTH_HEADERS,
        })
        expect(snapshotResponse.status).toBe(200)
        expect(await snapshotResponse.json()).toMatchObject({
          currentMessage: {
            text: 'first active gemini turn',
          },
          items: [
            {
              text: 'queued follow-up',
            },
          ],
          totalCount: 1,
        })

        geminiAcp.releaseDeferredPromptResults()

        await vi.waitFor(() => {
          expect(geminiAcp.promptTexts).toEqual([
            'first active gemini turn',
            'queued follow-up',
          ])
        })

        await vi.waitFor(() => {
          const liveSession = server.agents.sessionsInterface.getSession('gemini-acp-queued-send')
          expect(liveSession?.events).toEqual(expect.arrayContaining([
            expect.objectContaining({
              type: 'user',
              subtype: 'queued_message',
              message: {
                role: 'user',
                content: 'queued follow-up',
              },
            }),
          ]))
        })

        const clearedSnapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/gemini-acp-queued-send/queue`, {
          headers: AUTH_HEADERS,
        })
        expect(clearedSnapshotResponse.status).toBe(200)
        expect(await clearedSnapshotResponse.json()).toMatchObject({
          items: [],
          currentMessage: null,
          totalCount: 0,
        })
      } finally {
        ws?.close()
        await server.close()
      }
    })
})

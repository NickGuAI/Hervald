// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActiveTranscriptionSession,
  UseOpenAITranscriptionOptions,
  UseOpenAITranscriptionResult,
} from '@/hooks/use-openai-transcription'
import {
  flushPendingAudioChunks,
  getBufferedTranscript,
  hasBufferedTranscript,
  MIN_AUDIO_BYTES,
  relayAudioChunk,
  stopTranscriptionSession,
  useOpenAITranscription,
} from '@/hooks/use-openai-transcription'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  getAccessToken: vi.fn(async () => null),
  getWsBase: vi.fn(() => 'ws://test.local'),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  getAccessToken: mocks.getAccessToken,
}))

vi.mock('@/lib/api-base', () => ({
  getWsBase: mocks.getWsBase,
}))

const WS_OPEN = 1
const WS_CLOSED = 3

class MockAudioContext {
  readonly audioWorklet = {
    addModule: vi.fn(async () => undefined),
  }
  readonly close = vi.fn(async () => undefined)
  readonly resume = vi.fn(async () => undefined)
  readonly createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }))
  state: AudioContextState = 'running'
}

class MockAudioWorkletNode {
  readonly port = {
    onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null,
  }
  readonly disconnect = vi.fn()

  constructor(
    _context: AudioContext,
    _name: string,
    _options?: AudioWorkletNodeOptions,
  ) {}
}

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = WS_OPEN
  static readonly CLOSING = 2
  static readonly CLOSED = WS_CLOSED
  static instances: MockWebSocket[] = []

  readonly send = vi.fn()
  readonly close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })
  readonly url: string
  readyState = MockWebSocket.CONNECTING
  binaryType: BinaryType = 'blob'
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  emitMessage(payload: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify(payload),
    } as MessageEvent)
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({} as CloseEvent)
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalAudioContext: typeof window.AudioContext | undefined
let originalWebkitAudioContext: typeof window.webkitAudioContext | undefined
let originalAudioWorkletNode: typeof window.AudioWorkletNode | undefined
let originalWebSocket: typeof window.WebSocket | undefined
let originalMediaDevices: MediaDevices | undefined
let originalActEnvironment: boolean | undefined
let latestHookState: UseOpenAITranscriptionResult | null = null
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function createChunk(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function createSession(
  overrides: Partial<ActiveTranscriptionSession> = {},
): ActiveTranscriptionSession {
  return {
    ws: {
      readyState: WS_OPEN,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket,
    mediaStream: {
      getTracks: () => [],
    } as unknown as MediaStream,
    audioContext: {
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext,
    sourceNode: {} as MediaStreamAudioSourceNode,
    workletNode: {
      port: {
        onmessage: null,
      },
    } as unknown as AudioWorkletNode,
    pendingStop: false,
    finalizationTimer: null,
    ready: false,
    pendingChunks: [],
    totalBytesSent: 0,
    ...overrides,
  }
}

function HookHarness({
  options,
}: {
  options?: UseOpenAITranscriptionOptions
}) {
  latestHookState = useOpenAITranscription(options)
  return null
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve()
  }
}

async function renderHook(options?: UseOpenAITranscriptionOptions): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(createElement(HookHarness, { options }))
  })
}

async function startListeningAndGetSocket(): Promise<MockWebSocket> {
  if (!latestHookState) {
    throw new Error('Hook was not rendered')
  }

  latestHookState?.startListening()
  await flushMicrotasks()

  const socket = MockWebSocket.instances.at(-1)
  if (!socket) {
    throw new Error('WebSocket was not created')
  }

  return socket
}

beforeEach(() => {
  latestHookState = null
  MockWebSocket.instances = []

  originalAudioContext = window.AudioContext
  originalWebkitAudioContext = window.webkitAudioContext
  originalAudioWorkletNode = window.AudioWorkletNode
  originalWebSocket = window.WebSocket
  originalMediaDevices = navigator.mediaDevices
  originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

  window.AudioContext = MockAudioContext as unknown as typeof window.AudioContext
  window.webkitAudioContext = undefined
  window.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof window.AudioWorkletNode
  window.WebSocket = MockWebSocket as unknown as typeof window.WebSocket
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    } satisfies Partial<MediaDevices>,
  })
})

afterEach(() => {
  if (root) {
    flushSync(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  latestHookState = null
  MockWebSocket.instances = []
  window.AudioContext = originalAudioContext
  window.webkitAudioContext = originalWebkitAudioContext
  window.AudioWorkletNode = originalAudioWorkletNode
  window.WebSocket = originalWebSocket
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: originalMediaDevices,
  })
  vi.clearAllMocks()
})

describe('useOpenAITranscription helpers', () => {
  it('queues pre-ready chunks and drains them in order once ready', () => {
    const session = createSession()
    const send = vi.mocked(session.ws.send)
    const firstChunk = createChunk([1, 2])
    const secondChunk = createChunk([3, 4, 5])
    const thirdChunk = createChunk([6])

    expect(relayAudioChunk(session, firstChunk)).toBe('queued')
    expect(relayAudioChunk(session, secondChunk)).toBe('queued')
    expect(relayAudioChunk(session, thirdChunk)).toBe('queued')
    expect(session.pendingChunks).toHaveLength(3)
    expect(send).not.toHaveBeenCalled()

    session.ready = true
    expect(flushPendingAudioChunks(session)).toBe(3)
    expect(session.pendingChunks).toHaveLength(0)
    expect(send.mock.calls.map(([chunk]) => Array.from(new Uint8Array(chunk as ArrayBuffer)))).toEqual([
      [1, 2],
      [3, 4, 5],
      [6],
    ])
    expect(session.totalBytesSent).toBe(6)
  })

  it('skips commit and invokes the short-audio callback below the minimum byte threshold', () => {
    const session = createSession({
      ready: true,
      totalBytesSent: MIN_AUDIO_BYTES - 1,
    })
    const onShortAudio = vi.fn()
    const closeSession = vi.fn()
    const releaseAudioCapture = vi.fn()

    const result = stopTranscriptionSession({
      session,
      onShortAudio,
      closeSession,
      releaseAudioCapture,
      setIsListening: vi.fn(),
      scheduleFinalization: vi.fn(),
      finalizeTranscript: vi.fn(),
    })

    expect(result).toEqual({
      stopped: true,
      tooShort: true,
    })
    expect(session.ws.send).not.toHaveBeenCalled()
    expect(onShortAudio).toHaveBeenCalledTimes(1)
    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(releaseAudioCapture).not.toHaveBeenCalled()
  })

  it('prefers accumulated final segments and falls back to the latest partial transcript', () => {
    expect(getBufferedTranscript(['first', 'second'], 'ignored partial')).toBe('first second')
    expect(getBufferedTranscript([], 'partial only')).toBe('partial only')
    expect(hasBufferedTranscript(['final segment'], '')).toBe(true)
    expect(hasBufferedTranscript([], '  ')).toBe(false)
  })
})

describe('useOpenAITranscription websocket lifecycle', () => {
  it('finalizes captured transcript segments on websocket close even when stop was never requested', async () => {
    await renderHook()
    const socket = await startListeningAndGetSocket()

    flushSync(() => {
      socket.emitOpen()
      socket.emitMessage({ type: 'ready' })
      socket.emitMessage({ type: 'final', text: 'first finalized segment' })
      socket.emitClose()
    })
    await flushMicrotasks()

    expect(latestHookState?.transcript).toBe('first finalized segment')
    expect(latestHookState?.isListening).toBe(false)
  })

  it('finalizes buffered transcript text on proxy error and routes the error through onError', async () => {
    const onError = vi.fn()

    await renderHook({ onError })
    const socket = await startListeningAndGetSocket()

    flushSync(() => {
      socket.emitOpen()
      socket.emitMessage({ type: 'ready' })
      socket.emitMessage({ type: 'partial', text: 'spoken words so far' })
      socket.emitMessage({ type: 'error', message: 'Realtime upstream closed' })
    })
    await flushMicrotasks()

    expect(latestHookState?.transcript).toBe('spoken words so far')
    expect(onError).toHaveBeenCalledWith('Realtime upstream closed')
    expect(latestHookState?.transcript).not.toBe('Realtime upstream closed')
    expect(socket.close).not.toHaveBeenCalled()
  })
})

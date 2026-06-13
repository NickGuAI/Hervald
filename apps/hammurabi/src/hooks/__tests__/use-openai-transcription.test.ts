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
let operationLog: string[] = []
let mockAudioContextState: AudioContextState = 'running'
let mockAudioContextResume: () => Promise<void> = async () => undefined
let mockAudioWorkletAddModule: (moduleUrl: string) => Promise<void> = async () => undefined
let mockGetUserMedia: ReturnType<typeof vi.fn>
let mockTrackStop: ReturnType<typeof vi.fn>

class MockAudioContext {
  static instances: MockAudioContext[] = []

  readonly constructorOptions?: AudioContextOptions
  readonly audioWorklet = {
    addModule: vi.fn((moduleUrl: string) => {
      operationLog.push('worklet')
      return mockAudioWorkletAddModule(moduleUrl)
    }),
  }
  readonly close = vi.fn(async () => undefined)
  readonly resume = vi.fn(() => {
    operationLog.push('resume')
    return mockAudioContextResume()
  })
  readonly createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }))
  state: AudioContextState = mockAudioContextState

  constructor(contextOptions?: AudioContextOptions) {
    this.constructorOptions = contextOptions
    operationLog.push('audio-context')
    MockAudioContext.instances.push(this)
  }
}

class MockAudioWorkletNode {
  static instances: MockAudioWorkletNode[] = []

  readonly port = {
    onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null,
  }
  readonly disconnect = vi.fn()

  constructor(
    _context: AudioContext,
    _name: string,
    _options?: AudioWorkletNodeOptions,
  ) {
    MockAudioWorkletNode.instances.push(this)
  }
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
    operationLog.push('websocket')
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

function createAudioBuffer(byteLength: number): ArrayBuffer {
  return new Uint8Array(byteLength).buffer
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

async function flushMicrotasks(rounds = 8): Promise<void> {
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
  MockAudioContext.instances = []
  MockAudioWorkletNode.instances = []
  operationLog = []
  mockAudioContextState = 'running'
  mockAudioContextResume = async () => undefined
  mockAudioWorkletAddModule = async () => undefined
  mockTrackStop = vi.fn()
  mockGetUserMedia = vi.fn(async () => {
    operationLog.push('get-user-media')
    return {
      getTracks: () => [{ stop: mockTrackStop }],
    }
  })

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
  mocks.fetchJson.mockReset()
  mocks.fetchJson.mockImplementation(async (path: string) => {
    if (path === '/api/realtime/transcription-ticket') {
      operationLog.push('ticket')
      return { ticket: 'transcription-ticket-123' }
    }
    return {}
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: mockGetUserMedia,
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
  MockAudioContext.instances = []
  MockAudioWorkletNode.instances = []
  operationLog = []
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
      onFinalizeTimeout: vi.fn(),
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

  it('commits explicitly and schedules timeout handling after enough audio is captured', () => {
    const session = createSession({
      ready: true,
      totalBytesSent: MIN_AUDIO_BYTES,
    })
    const closeSession = vi.fn()
    const releaseAudioCapture = vi.fn()
    const setIsListening = vi.fn()
    const onFinalizeTimeout = vi.fn()
    let scheduledCallback: (() => void) | null = null

    const result = stopTranscriptionSession({
      session,
      closeSession,
      releaseAudioCapture,
      setIsListening,
      scheduleFinalization: (callback, delayMs) => {
        expect(delayMs).toBe(10000)
        scheduledCallback = callback
        return 12
      },
      onFinalizeTimeout,
    })

    expect(result).toEqual({
      stopped: true,
      tooShort: false,
    })
    expect(session.pendingStop).toBe(true)
    expect(setIsListening).toHaveBeenCalledWith(false)
    expect(releaseAudioCapture).toHaveBeenCalledWith(session)
    expect(session.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'commit' }))
    expect(session.finalizationTimer).toBe(12)

    scheduledCallback?.()
    expect(onFinalizeTimeout).toHaveBeenCalledOnce()
    expect(closeSession).toHaveBeenCalledOnce()
  })

  it('prefers accumulated final segments and falls back to the latest partial transcript', () => {
    expect(getBufferedTranscript(['first', 'second'], 'ignored partial')).toBe('first second')
    expect(getBufferedTranscript([], 'partial only')).toBe('partial only')
    expect(hasBufferedTranscript(['final segment'], '')).toBe(true)
    expect(hasBufferedTranscript([], '  ')).toBe(false)
  })
})

describe('useOpenAITranscription websocket lifecycle', () => {
  it('creates and resumes a native-rate AudioContext synchronously before awaited setup work', async () => {
    let resolveResume: (() => void) | null = null
    mockAudioContextState = 'suspended'
    mockAudioContextResume = () =>
      new Promise<void>((resolve) => {
        resolveResume = resolve
      })

    await renderHook()

    latestHookState?.startListening()

    expect(operationLog).toEqual(['audio-context', 'resume'])
    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0]?.constructorOptions).toBeUndefined()
    expect(MockAudioContext.instances[0]?.resume).toHaveBeenCalledOnce()
    expect(mockGetUserMedia).not.toHaveBeenCalled()
    expect(mocks.fetchJson).not.toHaveBeenCalled()

    resolveResume?.()
    await flushMicrotasks()

    expect(operationLog).toEqual([
      'audio-context',
      'resume',
      'get-user-media',
      'worklet',
      'ticket',
      'websocket',
    ])
  })

  it('routes setup failures through onError and releases partial capture resources', async () => {
    const onError = vi.fn()
    mockAudioWorkletAddModule = async () => {
      throw new Error('worklet unavailable')
    }

    await renderHook({ onError })

    latestHookState?.startListening()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledWith(
      'Unable to start realtime transcription: worklet unavailable',
    )
    expect(mockTrackStop).toHaveBeenCalledOnce()
    expect(MockAudioContext.instances[0]?.close).toHaveBeenCalledOnce()
    expect(MockWebSocket.instances).toHaveLength(0)
    expect(latestHookState?.isListening).toBe(false)
  })

  it('sends start with context terms and ignores final frames while actively recording', async () => {
    await renderHook({
      terms: ['Claude Code', 'Kubernetes'],
    })
    const socket = await startListeningAndGetSocket()

    flushSync(() => {
      socket.emitOpen()
      socket.emitMessage({ type: 'ready' })
      socket.emitMessage({ type: 'final', text: 'first finalized segment' })
      socket.emitClose()
    })
    await flushMicrotasks()

    expect(socket.url).toContain('term=Claude+Code')
    expect(socket.url).toContain('term=Kubernetes')
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'start' }))
    expect(latestHookState?.transcript).toBe('')
    expect(latestHookState?.isListening).toBe(false)
  })

  it('finalizes the transcript only after stop commits captured audio', async () => {
    await renderHook()
    const socket = await startListeningAndGetSocket()

    flushSync(() => {
      socket.emitOpen()
      socket.emitMessage({ type: 'ready' })
    })
    await flushMicrotasks()

    const worklet = MockAudioWorkletNode.instances.at(-1)
    if (!worklet?.port.onmessage) {
      throw new Error('Expected audio worklet onmessage handler')
    }

    worklet.port.onmessage({
      data: createAudioBuffer(MIN_AUDIO_BYTES),
    } as MessageEvent<ArrayBuffer>)

    flushSync(() => {
      latestHookState?.stopListening()
      socket.emitMessage({ type: 'final', text: 'one final command' })
    })
    await flushMicrotasks()

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'start' }))
    expect(socket.send).toHaveBeenCalledWith(expect.any(ArrayBuffer))
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'commit' }))
    expect(latestHookState?.transcript).toBe('one final command')
    expect(latestHookState?.isListening).toBe(false)
  })

  it('finalizes buffered post-stop partial text on proxy error and routes the error through onError', async () => {
    const onError = vi.fn()

    await renderHook({ onError })
    const socket = await startListeningAndGetSocket()

    flushSync(() => {
      socket.emitOpen()
      socket.emitMessage({ type: 'ready' })
    })
    await flushMicrotasks()

    const worklet = MockAudioWorkletNode.instances.at(-1)
    if (!worklet?.port.onmessage) {
      throw new Error('Expected audio worklet onmessage handler')
    }

    worklet.port.onmessage({
      data: createAudioBuffer(MIN_AUDIO_BYTES),
    } as MessageEvent<ArrayBuffer>)

    flushSync(() => {
      latestHookState?.stopListening()
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

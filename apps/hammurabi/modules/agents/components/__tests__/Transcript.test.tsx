// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transcript } from '../Transcript'
import type { MsgItem } from '../../messages/model'

vi.mock('../SessionMessageList', () => ({
  SessionMessageList: ({ messages }: { messages: MsgItem[] }) => createElement(
    'div',
    { 'data-message-count': String(messages.length) },
    `messages:${messages.length}`,
  ),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null
let styleTag: HTMLStyleElement | null = null
let animationFrameQueue: FrameRequestCallback[] = []
let previousRequestAnimationFrame: typeof globalThis.requestAnimationFrame | undefined
let previousCancelAnimationFrame: typeof globalThis.cancelAnimationFrame | undefined
let previousElementScrollTo: typeof HTMLElement.prototype.scrollTo | undefined
let scrollToMock: ReturnType<typeof vi.fn>

function buildMessages(count: number): MsgItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    kind: index % 2 === 0 ? 'user' : 'agent',
    text: `Message ${index + 1}`,
  }))
}

function clampScrollTop(nextScrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  return Math.max(0, Math.min(nextScrollTop, maxScrollTop))
}

function installScrollMetrics(
  host: HTMLElement,
  initial: {
    scrollTop?: number
    scrollHeight: number
    clientHeight: number
  },
) {
  let scrollTop = initial.scrollTop ?? 0
  let scrollHeight = initial.scrollHeight
  let clientHeight = initial.clientHeight

  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = clampScrollTop(value, scrollHeight, clientHeight)
    },
  })

  Object.defineProperty(host, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
    set: (value: number) => {
      scrollHeight = value
      scrollTop = clampScrollTop(scrollTop, scrollHeight, clientHeight)
    },
  })

  Object.defineProperty(host, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
    set: (value: number) => {
      clientHeight = value
      scrollTop = clampScrollTop(scrollTop, scrollHeight, clientHeight)
    },
  })

  return {
    getScrollTop: () => scrollTop,
    setScrollTop(value: number) {
      scrollTop = clampScrollTop(value, scrollHeight, clientHeight)
    },
    setScrollHeight(value: number) {
      scrollHeight = value
      scrollTop = clampScrollTop(scrollTop, scrollHeight, clientHeight)
    },
  }
}

async function settleEffects() {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushAnimationFrames() {
  while (animationFrameQueue.length > 0) {
    const callbacks = animationFrameQueue.splice(0)
    for (const callback of callbacks) {
      callback(16)
    }
    await settleEffects()
  }
}

async function dispatchScroll(host: HTMLElement) {
  flushSync(() => {
    host.dispatchEvent(new Event('scroll'))
  })
  await settleEffects()
}

async function mountTranscript(options: {
  messages: MsgItem[]
  sessionId?: string
  mobile?: boolean
}) {
  const state = {
    messages: options.messages,
    sessionId: options.sessionId ?? 'session-alpha',
  }

  container = document.createElement('div')
  if (!options.mobile) {
    container.style.height = '400px'
    container.style.overflowY = 'auto'
  }
  document.body.appendChild(container)

  const renderNode = () => options.mobile
    ? createElement(
      'div',
      { className: 'session-view-overlay' },
      createElement(Transcript, {
        messages: state.messages,
        sessionId: state.sessionId,
      }),
    )
    : createElement(Transcript, {
      messages: state.messages,
      sessionId: state.sessionId,
    })

  flushSync(() => {
    root = createRoot(container)
    root?.render(renderNode())
  })
  await settleEffects()

  const messagesArea = container.querySelector('.messages-area')
  if (!(messagesArea instanceof HTMLDivElement)) {
    throw new Error('expected Transcript messages area')
  }

  return {
    host: options.mobile ? messagesArea : container,
    async rerender(nextMessages: MsgItem[], nextSessionId = state.sessionId) {
      state.messages = nextMessages
      state.sessionId = nextSessionId

      flushSync(() => {
        root?.render(renderNode())
      })
      await settleEffects()
    },
  }
}

describe('Transcript sticky scroll behavior', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    animationFrameQueue = []
    previousRequestAnimationFrame = globalThis.requestAnimationFrame
    previousCancelAnimationFrame = globalThis.cancelAnimationFrame
    previousElementScrollTo = HTMLElement.prototype.scrollTo
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      animationFrameQueue.push(callback)
      return animationFrameQueue.length
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame
    scrollToMock = vi.fn(function scrollTo(
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      if (typeof options === 'number') {
        this.scrollTop = y ?? options
        return
      }

      this.scrollTop = options?.top ?? this.scrollTop
    })
    HTMLElement.prototype.scrollTo = scrollToMock as typeof HTMLElement.prototype.scrollTo

    styleTag = document.createElement('style')
    styleTag.textContent = '.session-view-overlay .messages-area { overflow-y: auto; }'
    document.head.appendChild(styleTag)
  })

  afterEach(async () => {
    if (root) {
      flushSync(() => {
        root?.unmount()
      })
    }

    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    globalThis.requestAnimationFrame = previousRequestAnimationFrame as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame as typeof globalThis.cancelAnimationFrame
    HTMLElement.prototype.scrollTo = previousElementScrollTo as typeof HTMLElement.prototype.scrollTo
    root = null
    container?.remove()
    container = null
    styleTag?.remove()
    styleTag = null
    document.body.innerHTML = ''
    document.head.querySelectorAll('style').forEach((node) => {
      if (node.textContent === '.session-view-overlay .messages-area { overflow-y: auto; }') {
        node.remove()
      }
    })
    vi.clearAllMocks()
  })

  it('lands at the bottom on cold-load inside the desktop scroll host', async () => {
    const harness = await mountTranscript({ messages: buildMessages(50) })
    const metrics = installScrollMetrics(harness.host, {
      scrollHeight: 2000,
      clientHeight: 400,
    })

    await settleEffects()
    await flushAnimationFrames()

    expect(metrics.getScrollTop()).toBe(1600)
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it('does not drag the user down when they have scrolled to the top', async () => {
    const harness = await mountTranscript({ messages: buildMessages(50) })
    const metrics = installScrollMetrics(harness.host, {
      scrollHeight: 2000,
      clientHeight: 400,
    })

    await settleEffects()
    await flushAnimationFrames()

    metrics.setScrollTop(0)
    await dispatchScroll(harness.host)
    metrics.setScrollHeight(2400)

    await harness.rerender(buildMessages(51))
    await settleEffects()

    expect(metrics.getScrollTop()).toBe(0)
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it('keeps stick-to-bottom behavior when the user is within 120px of the bottom', async () => {
    const harness = await mountTranscript({ messages: buildMessages(50) })
    const metrics = installScrollMetrics(harness.host, {
      scrollHeight: 2000,
      clientHeight: 400,
    })

    await settleEffects()
    await flushAnimationFrames()

    metrics.setScrollTop(1590)
    await dispatchScroll(harness.host)
    metrics.setScrollHeight(2400)

    await harness.rerender(buildMessages(51))
    await settleEffects()

    expect(metrics.getScrollTop()).toBe(2000)
    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 2400, behavior: 'smooth' })
  })

  it('covers the mobile overlay shape by using Transcript as its own scroll host', async () => {
    const harness = await mountTranscript({
      messages: buildMessages(20),
      mobile: true,
      sessionId: 'session-mobile',
    })
    const metrics = installScrollMetrics(harness.host, {
      scrollHeight: 1200,
      clientHeight: 400,
    })

    await settleEffects()
    await flushAnimationFrames()

    expect(metrics.getScrollTop()).toBe(800)
    expect(scrollToMock).not.toHaveBeenCalled()
  })
})

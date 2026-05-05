import { describe, expect, it, vi } from 'vitest'

import {
  createHttpConversationDispatcher,
  createWsDirectDispatcher,
  type SendInput,
} from '@/hooks/send-dispatcher'

describe('SendDispatcher', () => {
  it('paints before WebSocket transport dispatch for direct stream sends', async () => {
    const calls: string[] = []
    const socket = {
      readyState: 1,
      send: vi.fn(() => {
        calls.push('transport')
      }),
    }
    const dispatcher = createWsDirectDispatcher({
      wsRef: { current: socket },
      sessionName: 'commander-test',
      fallbackHttp: vi.fn(async () => {
        calls.push('fallback')
        return true
      }),
    })

    const ok = await dispatcher.send(
      { text: '  hello world  ' },
      (text, images) => {
        calls.push('paint')
        expect(text).toBe('hello world')
        expect(images).toBeUndefined()
      },
    )

    expect(ok).toBe(true)
    expect(calls).toEqual(['paint', 'transport'])
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'input',
      text: 'hello world',
      images: undefined,
    }))
  })

  it('paints before HTTP fallback transport dispatch for direct stream sends', async () => {
    const calls: string[] = []
    const fallbackHttp = vi.fn(async (_input: SendInput) => {
      calls.push('transport')
      return true
    })
    const dispatcher = createWsDirectDispatcher({
      wsRef: { current: null },
      sessionName: 'commander-test',
      fallbackHttp,
    })
    const image = { mediaType: 'image/png', data: 'base64-data' }

    const ok = await dispatcher.send(
      { text: '  ', images: [image] },
      (text, images) => {
        calls.push('paint')
        expect(text).toBe('')
        expect(images).toEqual([image])
      },
    )

    expect(ok).toBe(true)
    expect(calls).toEqual(['paint', 'transport'])
    expect(fallbackHttp).toHaveBeenCalledWith({ text: '', images: [image] })
  })

  it('paints before conversation HTTP transport dispatch', async () => {
    const calls: string[] = []
    const submitConversationMessage = vi.fn(async () => {
      calls.push('transport')
      return true
    })
    const dispatcher = createHttpConversationDispatcher({ submitConversationMessage })

    const ok = await dispatcher.send(
      { text: '  Ship the bubble  ' },
      (text, images) => {
        calls.push('paint')
        expect(text).toBe('Ship the bubble')
        expect(images).toBeUndefined()
      },
    )

    expect(ok).toBe(true)
    expect(calls).toEqual(['paint', 'transport'])
    expect(submitConversationMessage).toHaveBeenCalledWith({ message: 'Ship the bubble' })
  })

  it('skips paint and transport when there is no sendable content', async () => {
    const paintOptimistic = vi.fn()
    const transport = vi.fn(async () => true)
    const dispatcher = createHttpConversationDispatcher({
      submitConversationMessage: transport,
    })

    const ok = await dispatcher.send({ text: '   ' }, paintOptimistic)

    expect(ok).toBe(false)
    expect(paintOptimistic).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })
})

import type { SessionQueueSnapshot } from '@/types'
import { describe, expect, it } from 'vitest'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  appendQueuedMessagesToTranscript,
  mapSessionMessagesToTranscript,
  mergeHistoricalAndLiveTranscript,
} from '../components/transcript'

describe('mapSessionMessagesToTranscript', () => {
  it('preserves the rich MsgItem transcript shape for Hervald rendering parity', () => {
    const messages = [
      {
        id: 'user-1',
        kind: 'user',
        text: 'Brief the fleet',
        timestamp: '2026-04-19T12:00:00.000Z',
      },
      {
        id: 'agent-1',
        kind: 'agent',
        text: 'Fleet brief ready.',
      },
      {
        id: 'tool-1',
        kind: 'tool',
        text: 'Bash',
      },
      {
        id: 'plan-1',
        kind: 'planning',
        text: '1. Inspect\n2. Report',
      },
    ]

    expect(mapSessionMessagesToTranscript(messages)).toEqual(messages)
  })
})

describe('mergeHistoricalAndLiveTranscript', () => {
  it('drops only replayed historical messages when live messages overlap', () => {
    const historicalMessages: MsgItem[] = [
      { id: 'history-1', kind: 'agent', text: 'same' },
      { id: 'history-2', kind: 'agent', text: 'older' },
      { id: 'history-3', kind: 'agent', text: 'same' },
    ]
    const liveMessages: MsgItem[] = [
      { id: 'live-1', kind: 'agent', text: 'same' },
      { id: 'live-2', kind: 'agent', text: 'newer' },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      { id: 'history-1', kind: 'agent', text: 'same' },
      { id: 'history-2', kind: 'agent', text: 'older' },
      { id: 'live-1', kind: 'agent', text: 'same' },
      { id: 'live-2', kind: 'agent', text: 'newer' },
    ])
  })

  it('does not render both optimistic and history copies for display-safe workspace sends', () => {
    const historicalMessages: MsgItem[] = [
      { id: 'history-user', kind: 'user', text: 'Use this context.' },
    ]
    const liveMessages: MsgItem[] = [
      { id: 'optimistic-user', kind: 'user', text: 'Use this context.' },
    ]

    const merged = mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)

    expect(merged).toEqual([
      { id: 'optimistic-user', kind: 'user', text: 'Use this context.' },
    ])
    expect(merged.some((message) => message.text.includes('<workspace-'))).toBe(false)
  })

  it('does not render both optimistic and backend copies for image-only user prompts', () => {
    const image = {
      mediaType: 'image/png',
      data: 'base64-product-logo',
      alt: 'Product logo upload',
    }
    const historicalMessages: MsgItem[] = [
      {
        id: 'history-user-image',
        kind: 'user',
        text: '',
        images: [image],
        transcript: {
          source: { provider: 'codex', backend: 'rpc' },
          turnId: 'turn-user-image',
          itemId: 'user-image-1',
        },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'optimistic-user-image',
        kind: 'user',
        text: '[image]',
        images: [image],
      },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      liveMessages[0],
    ])
  })

  it('dedupes separated historical and live user image rows by client send id when image bytes differ', () => {
    const clientSendId = 'conversation-image-send-1705'
    const historicalMessages: MsgItem[] = [
      {
        id: 'history-user-image',
        kind: 'user',
        text: '',
        clientSendId,
        images: [{ mediaType: 'image/png', data: 'history-image-bytes' }],
        transcript: {
          source: { provider: 'codex', backend: 'rpc' },
          turnId: 'turn-user-image',
          itemId: 'user-image-history',
        },
      },
      {
        id: 'history-agent-between',
        kind: 'agent',
        text: 'I will inspect the image.',
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-user-image',
        kind: 'user',
        text: '[image]',
        clientSendId,
        images: [{ mediaType: 'image/png', data: 'live-image-bytes' }],
      },
    ]

    const merged = mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)

    expect(merged).toEqual([
      liveMessages[0],
      historicalMessages[1],
    ])
    expect(merged.filter((message) => (
      message.kind === 'user'
      && message.clientSendId === clientSendId
      && (message.images?.length ?? 0) > 0
    ))).toHaveLength(1)
  })

  it('keeps repeated same-image user prompts when their text differs', () => {
    const image = {
      mediaType: 'image/png',
      data: 'base64-product-logo',
    }
    const historicalMessages: MsgItem[] = [
      {
        id: 'history-user-image',
        kind: 'user',
        text: 'Use this product logo.',
        images: [image],
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-user-image',
        kind: 'user',
        text: 'Now use it for the app icon.',
        images: [image],
      },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      historicalMessages[0],
      liveMessages[0],
    ])
  })

  it('folds a live replay tail into the fuller historical assistant message with the same transcript identity', () => {
    const fullText = [
      'CommandRoom.tsx](/home/builder/App/apps/hammurabi/modules/command-room/components/CommandRoom.tsx:825).',
      '',
      'So the clean fix is:',
      '',
      'After Resume/Start, set the conversation into a starting visual state.',
      'Show a full conversation loading panel while conversation.runtimeState === starting.',
      'Switch to transcript + composer only when composerEnabled && composerSendReady.',
    ].join('\n')
    const replayTail = [
      'So the clean fix is:',
      '',
      'After Resume/Start, set the conversation into a starting visual state.',
      'Show a full conversation loading panel while conversation.runtimeState === starting.',
      'Switch to transcript + composer only when composerEnabled && composerSendReady.',
    ].join('\n')
    const historicalMessages: MsgItem[] = [
      {
        id: 'history-agent',
        kind: 'agent',
        text: fullText,
        transcript: {
          source: { provider: 'codex', backend: 'rpc' },
          turnId: 'turn-1',
          itemId: 'assistant-1',
        },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-agent-tail',
        kind: 'agent',
        text: replayTail,
        transcript: {
          source: { provider: 'codex', backend: 'rpc' },
          turnId: 'turn-1',
          itemId: 'assistant-1',
        },
      },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      historicalMessages[0],
    ])
  })

  it('keeps the fuller live assistant message when the historical copy is the replay tail', () => {
    const historyTail = [
      'Show a full conversation loading panel while conversation.runtimeState === starting.',
      'Switch to transcript + composer only when composerEnabled && composerSendReady.',
    ].join('\n')
    const liveFullText = [
      'So the clean fix is:',
      '',
      'After Resume/Start, set the conversation into a starting visual state.',
      'Show a full conversation loading panel while conversation.runtimeState === starting.',
      'Switch to transcript + composer only when composerEnabled && composerSendReady.',
    ].join('\n')
    const historicalMessages: MsgItem[] = [
      {
        id: 'history-agent-tail',
        kind: 'agent',
        text: historyTail,
        transcript: {
          source: { provider: 'codex', backend: 'rpc' },
          turnId: 'turn-2',
          itemId: 'assistant-2',
        },
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-agent-full',
        kind: 'agent',
        text: liveFullText,
        transcript: {
          source: { provider: 'codex', backend: 'rpc' },
          turnId: 'turn-2',
          itemId: 'assistant-2',
        },
      },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      liveMessages[0],
    ])
  })

  it('drops long adjacent assistant tail duplicates even when old transcript rows lack provider identity', () => {
    const historicalMessages: MsgItem[] = [
      {
        id: 'history-agent',
        kind: 'agent',
        text: [
          'The backend/read model already exposes runtimeState, websocketReady, sendTarget, liveSession, and allowedActions.',
          'The UI should not infer readiness from message text or transcript events when deciding whether the conversation is ready.',
        ].join(' '),
      },
    ]
    const liveMessages: MsgItem[] = [
      {
        id: 'live-agent-tail',
        kind: 'agent',
        text: 'The UI should not infer readiness from message text or transcript events when deciding whether the conversation is ready.',
      },
      {
        id: 'live-agent-next',
        kind: 'agent',
        text: 'A genuinely new follow-up remains visible.',
      },
    ]

    expect(mergeHistoricalAndLiveTranscript(historicalMessages, liveMessages)).toEqual([
      historicalMessages[0],
      liveMessages[1],
    ])
  })
})

describe('appendQueuedMessagesToTranscript', () => {
  it('keeps queued backlog items out of the chat transcript', () => {
    const messages: MsgItem[] = [
      { id: 'agent-1', kind: 'agent', text: 'Working.' },
    ]
    const queueSnapshot: SessionQueueSnapshot = {
      currentMessage: null,
      totalCount: 1,
      items: [
        {
          id: 'queue-1',
          text: 'Do this next.',
          priority: 'normal',
          queuedAt: '2026-05-17T14:00:00.000Z',
        },
      ],
    }

    expect(appendQueuedMessagesToTranscript(messages, queueSnapshot)).toEqual([
      { id: 'agent-1', kind: 'agent', text: 'Working.' },
    ])
  })

  it('keeps the current queued message out of the chat transcript', () => {
    const queueSnapshot: SessionQueueSnapshot = {
      currentMessage: {
        id: 'queue-current',
        text: 'Current queued turn.',
        priority: 'normal',
        queuedAt: '2026-05-17T14:01:00.000Z',
      },
      totalCount: 1,
      items: [],
    }

    expect(appendQueuedMessagesToTranscript([], queueSnapshot)).toEqual([])

    expect(appendQueuedMessagesToTranscript([
      { id: 'live-user', kind: 'user', text: 'Current queued turn.' },
    ], queueSnapshot)).toEqual([
      { id: 'live-user', kind: 'user', text: 'Current queued turn.' },
    ])
  })
})

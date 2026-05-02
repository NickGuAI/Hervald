// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commanderConversationsQueryKey,
  conversationDetailQueryKey,
  type ConversationRecord,
  useStartConversation,
  useStopConversation,
} from '../hooks/use-conversations'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
let latestStartMutation: ReturnType<typeof useStartConversation> | null = null
let latestStopMutation: ReturnType<typeof useStopConversation> | null = null
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

function StartHookHarness() {
  latestStartMutation = useStartConversation()
  return null
}

function StopHookHarness() {
  latestStopMutation = useStopConversation()
  return null
}

async function renderHook(mode: 'start' | 'stop'): Promise<void> {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient! },
        createElement(mode === 'start' ? StartHookHarness : StopHookHarness),
      ),
    )
  })
}

beforeEach(() => {
  originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  queryClient?.clear()
  container?.remove()
  root = null
  container = null
  queryClient = null
  latestStartMutation = null
  latestStopMutation = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('useStartConversation', () => {
  it('posts to the conversation start route, updates both caches, and returns the started conversation', async () => {
    await renderHook('start')

    const commanderId = 'commander/athena'
    const otherConversation: ConversationRecord = {
      id: 'conv-other',
      commanderId,
      surface: 'ui',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: '2026-05-01T07:00:00.000Z',
      lastMessageAt: '2026-05-01T07:10:00.000Z',
      liveSession: null,
    }
    const startedConversation: ConversationRecord = {
      id: 'conv-started',
      commanderId,
      surface: 'ui',
      status: 'active',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 1,
      totalCostUsd: 0.25,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:05:00.000Z',
      liveSession: null,
    }

    queryClient?.setQueryData(
      commanderConversationsQueryKey(commanderId),
      [otherConversation],
    )
    mocks.fetchJson.mockResolvedValue({ conversation: startedConversation })

    if (!latestStartMutation) {
      throw new Error('expected start mutation hook to be rendered')
    }

    let result: ConversationRecord | undefined
    await act(async () => {
      result = await latestStartMutation?.mutateAsync({
        conversationId: startedConversation.id,
        agentType: 'claude',
        effort: 'high',
        adaptiveThinking: 'enabled',
        cwd: '/workspace/project',
        host: 'yus-mac-mini',
      })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/conversations/conv-started/start',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'claude',
          effort: 'high',
          adaptiveThinking: 'enabled',
          cwd: '/workspace/project',
          host: 'yus-mac-mini',
        }),
      },
    )
    expect(queryClient?.getQueryData(commanderConversationsQueryKey(commanderId))).toEqual([
      startedConversation,
      otherConversation,
    ])
    expect(
      queryClient?.getQueryData(conversationDetailQueryKey(startedConversation.id)),
    ).toEqual(startedConversation)
    expect(result).toEqual(startedConversation)
  })
})

describe('useStopConversation', () => {
  it('posts to the conversation pause route, updates both caches, and returns the paused conversation', async () => {
    await renderHook('stop')

    const commanderId = 'commander/athena'
    const otherConversation: ConversationRecord = {
      id: 'conv-other',
      commanderId,
      surface: 'ui',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: '2026-05-01T07:00:00.000Z',
      lastMessageAt: '2026-05-01T07:10:00.000Z',
      liveSession: null,
    }
    const pausedConversation: ConversationRecord = {
      id: 'conv-active',
      commanderId,
      surface: 'ui',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 2,
      totalCostUsd: 1.2,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:10:00.000Z',
      liveSession: null,
    }

    queryClient?.setQueryData(
      commanderConversationsQueryKey(commanderId),
      [{ ...pausedConversation, status: 'active' } satisfies ConversationRecord, otherConversation],
    )
    mocks.fetchJson.mockResolvedValue(pausedConversation)

    if (!latestStopMutation) {
      throw new Error('expected stop mutation hook to be rendered')
    }

    let result: ConversationRecord | undefined
    await act(async () => {
      result = await latestStopMutation?.mutateAsync({
        conversationId: pausedConversation.id,
      })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/conversations/conv-active/pause',
      {
        method: 'POST',
      },
    )
    expect(queryClient?.getQueryData(commanderConversationsQueryKey(commanderId))).toEqual([
      pausedConversation,
      otherConversation,
    ])
    expect(
      queryClient?.getQueryData(conversationDetailQueryKey(pausedConversation.id)),
    ).toEqual(pausedConversation)
    expect(result).toEqual(pausedConversation)
  })
})

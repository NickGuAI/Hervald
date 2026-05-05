// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commanderConversationsQueryKey,
  conversationDetailQueryKey,
  type ConversationRecord,
  useCreateConversation,
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
let latestMutation: ReturnType<typeof useCreateConversation> | null = null
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

function HookHarness() {
  latestMutation = useCreateConversation()
  return null
}

async function renderHook(): Promise<void> {
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
        createElement(HookHarness),
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
  latestMutation = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('useCreateConversation', () => {
  it('posts to the commander conversations route, updates both caches, and returns the created conversation', async () => {
    await renderHook()

    const commanderId = 'commander/atlas'
    const existingConversation: ConversationRecord = {
      id: 'conv-existing',
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
      completedTasks: 1,
      totalCostUsd: 0.75,
      createdAt: '2026-05-01T07:00:00.000Z',
      lastMessageAt: '2026-05-01T07:15:00.000Z',
      liveSession: null,
    }
    const createdConversation: ConversationRecord = {
      id: 'conv-created',
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
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:00:00.000Z',
      liveSession: null,
    }

    queryClient?.setQueryData(
      commanderConversationsQueryKey(commanderId),
      [existingConversation],
    )
    mocks.fetchJson.mockResolvedValue(createdConversation)

    if (!latestMutation) {
      throw new Error('expected mutation hook to be rendered')
    }

    let result: ConversationRecord | undefined
    await act(async () => {
      result = await latestMutation?.mutateAsync({ commanderId })
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      '/api/commanders/commander%2Fathena/conversations',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          surface: 'ui',
        }),
      },
    )
    expect(queryClient?.getQueryData(commanderConversationsQueryKey(commanderId))).toEqual([
      createdConversation,
      existingConversation,
    ])
    expect(
      queryClient?.getQueryData(conversationDetailQueryKey(createdConversation.id)),
    ).toEqual(createdConversation)
    expect(result).toEqual(createdConversation)
  })
})

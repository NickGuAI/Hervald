// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commanderActiveConversationQueryKey,
  commanderConversationsQueryKey,
  conversationDetailQueryKey,
  useActiveConversation,
  useConversations,
} from '../hooks/use-conversations'

const capturedQueries = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn((options: Record<string, unknown>) => {
      capturedQueries.push(options)
      return {
        data: undefined,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(async () => undefined),
      }
    }),
  }
})

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

function HookHarness() {
  useConversations('commander-1', 'conversation-1')
  useActiveConversation('commander-1', true)
  return null
}

async function renderHook(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(createElement(HookHarness))
  })
}

beforeEach(() => {
  originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  capturedQueries.length = 0
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  vi.clearAllMocks()
})

describe('conversation query polling', () => {
  it('polls the commander conversation list without polling selected detail or active-chat lookup', async () => {
    await renderHook()

    const listQuery = capturedQueries.find((query) =>
      JSON.stringify(query.queryKey) === JSON.stringify(commanderConversationsQueryKey('commander-1')),
    )
    const detailQuery = capturedQueries.find((query) =>
      JSON.stringify(query.queryKey) === JSON.stringify(conversationDetailQueryKey('conversation-1')),
    )
    const activeQuery = capturedQueries.find((query) =>
      JSON.stringify(query.queryKey) === JSON.stringify(commanderActiveConversationQueryKey('commander-1')),
    )

    expect(listQuery).toMatchObject({ refetchInterval: 5000 })
    expect(detailQuery).toMatchObject({ staleTime: 30_000 })
    expect(detailQuery).not.toHaveProperty('refetchInterval')
    expect(activeQuery).toMatchObject({ staleTime: 30_000 })
    expect(activeQuery).not.toHaveProperty('refetchInterval')
  })
})

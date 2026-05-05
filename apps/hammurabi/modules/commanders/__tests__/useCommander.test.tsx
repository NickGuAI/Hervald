// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
}))

vi.mock('../../../src/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
}))

import { useCommander, type CommanderSession } from '../hooks/useCommander'

function buildCommander(): CommanderSession {
  return {
    id: 'commander-running',
    host: 'running',
    displayName: 'Running Commander',
    pid: 1234,
    state: 'running',
    created: '2026-05-01T00:00:00.000Z',
    agentType: 'claude',
    effort: 'medium',
    cwd: '/tmp',
    persona: null,
    heartbeat: {
      intervalMs: 900_000,
      messageTemplate: '[HB {{timestamp}}]',
    },
    lastHeartbeat: null,
    taskSource: null,
    currentTask: null,
    completedTasks: 0,
    questCount: 0,
    scheduleCount: 0,
    totalCostUsd: 0,
    avatarUrl: null,
    ui: null,
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

describe('useCommander', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  let websocketConstructor: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = makeQueryClient()
    websocketConstructor = vi.fn()
    vi.stubGlobal('WebSocket', websocketConstructor)
    mocks.fetchJson.mockImplementation(async (url: string) => {
      if (url === '/api/commanders') {
        return [buildCommander()]
      }
      if (url === '/api/commanders/commander-running/tasks') {
        return []
      }
      if (url.startsWith('/api/automations?')) {
        return []
      }
      throw new Error(`Unexpected fetchJson URL: ${url}`)
    })
    mocks.fetchVoid.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does not open a commander chat websocket when a running commander is selected', async () => {
    function Harness() {
      useCommander()
      return null
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
      )
    })

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/commanders')
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    })

    expect(websocketConstructor).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommanderIdentityTab } from '../components/CommanderIdentityTab'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
}))

vi.mock('../components/HeartbeatMonitor', () => ({
  HeartbeatMonitor: () => createElement('div', { 'data-testid': 'heartbeat-monitor' }, 'HeartbeatMonitor'),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let mountedRoots: Root[] = []

function setElementValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype

  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  valueSetter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderIdentityTab() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(CommanderIdentityTab, {
          commander: {
            id: '72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3',
            host: 'arnold',
            displayName: 'Arnold',
            pid: null,
            state: 'running',
            created: '2026-04-25T02:00:00.000Z',
            agentType: 'claude',
            effort: 'medium',
            cwd: '/tmp/arnold',
            maxTurns: 9,
            contextMode: 'fat',
            heartbeat: {
              intervalMs: 900_000,
              messageTemplate: 'Check status',
            },
            lastHeartbeat: null,
            taskSource: null,
            currentTask: null,
            completedTasks: 0,
            questCount: 0,
            scheduleCount: 0,
            totalCostUsd: 0,
          },
        }),
      ),
    )
  })
}

describe('CommanderIdentityTab', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchJson.mockReset()
    mocks.fetchVoid.mockReset()
  })

  afterEach(async () => {
    for (const root of mountedRoots.splice(0)) {
      await act(async () => {
        root.unmount()
      })
    }
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('shows explicit max-turn runtime state and saves runtime settings through the runtime patch route', async () => {
    const runtimePatchCalls: Array<{
      maxTurns: number
      contextMode: 'thin' | 'fat'
      contextConfig: { fatPinInterval?: number }
    }> = []

    mocks.fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/commanders/72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3') {
        return {
          contextMode: 'fat',
          contextConfig: {
            fatPinInterval: 2,
          },
          runtime: {
            heartbeatCount: 4,
            terminalState: {
              kind: 'max_turns',
              subtype: 'error_max_turns',
              terminalReason: 'max_turns',
              message: 'Reached maximum number of turns (9)',
              errors: ['Reached maximum number of turns (9)'],
            },
          },
          runtimeConfig: {
            defaults: { maxTurns: 12 },
            limits: { maxTurns: 25 },
          },
        }
      }

      if (url === '/api/commanders/72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3/runtime' && init?.method === 'PATCH') {
        runtimePatchCalls.push(JSON.parse(String(init.body)) as {
          maxTurns: number
          contextMode: 'thin' | 'fat'
          contextConfig: { fatPinInterval?: number }
        })
        return {}
      }

      throw new Error(`Unexpected fetchJson call: ${url}`)
    })

    await renderIdentityTab()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Claude hit the max-turn cap at 9 turns.')
      expect(document.body.textContent).toContain('Global default 12 · limit 25')
    })

    const maxTurnsInput = document.body.querySelector<HTMLInputElement>('input[type="number"][max="25"]')
    if (!maxTurnsInput) {
      throw new Error('Could not find runtime maxTurns input')
    }

    await act(async () => {
      setElementValue(maxTurnsInput, '21')
    })

    const saveRuntimeButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save runtime',
    )
    if (!(saveRuntimeButton instanceof HTMLButtonElement)) {
      throw new Error('Could not find Save runtime button')
    }

    await act(async () => {
      saveRuntimeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(runtimePatchCalls).toEqual([
        {
          maxTurns: 21,
          contextMode: 'fat',
          contextConfig: {
            fatPinInterval: 2,
          },
        },
      ])
    })
  })
})

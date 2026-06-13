// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListItem } from '../../../automations/hooks/useAutomations'
import { AutomationPanel } from '../AutomationPanel'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
}))

vi.mock('@/hooks/use-agents', () => ({
  useMachines: () => ({ data: [] }),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

const codexProvider = {
  id: 'codex',
  label: 'Codex',
  eventProvider: 'codex',
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
    supportsMessageImages: true,
  },
  uiCapabilities: {
    supportsEffort: false,
    supportsAdaptiveThinking: false,
    supportsMaxThinkingTokens: false,
    supportsSkills: false,
    supportsLoginMode: true,
    permissionModes: [{ value: 'default', label: 'default', description: 'Default' }],
  },
  availableModels: [
    { id: 'gpt-5.5', label: 'GPT-5.5', default: true },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
  ],
  supportedTransports: ['stream'],
  defaults: { transportType: 'stream', permissionMode: 'default', model: 'gpt-5.5' },
  disabledReason: null,
} as const

const claudeProvider = {
  ...codexProvider,
  id: 'claude',
  label: 'Claude',
  eventProvider: 'claude',
  availableModels: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', default: true },
  ],
  defaults: { transportType: 'stream', permissionMode: 'default', model: 'claude-sonnet-4-6' },
} as const

function createAutomation(): AutomationListItem {
  return {
    id: 'auto-1',
    operatorId: 'operator-1',
    parentCommanderId: null,
    name: 'daily-check',
    trigger: 'schedule',
    schedule: '0 9 * * *',
    instruction: 'Run the check.',
    agentType: 'claude',
    permissionMode: 'default',
    skills: [],
    status: 'active',
    timezone: 'America/New_York',
    workDir: '/home/builder',
    model: 'claude-sonnet-4-6',
    totalRuns: 0,
    totalCostUsd: 0,
    history: [],
    observations: [],
    nextRun: null,
  }
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitForElement<T extends Element>(
  findElement: () => T | null,
  message: string,
): Promise<T> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const element = findElement()
    if (element) {
      return element
    }
    await flushEffects()
  }

  throw new Error(message)
}

async function renderPanel() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient!}>
        <AutomationPanel scope={{ kind: 'global' }} />
      </QueryClientProvider>,
    )
  })

  await flushEffects()
}

describe('AutomationPanel', () => {
  beforeEach(() => {
    let automation = createAutomation()
    mocks.fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/providers') {
        return { providers: [claudeProvider, codexProvider], defaultProviderId: 'codex' }
      }
      if (url.startsWith('/api/automations?')) {
        return [automation]
      }
      if (url === '/api/skills') {
        return []
      }
      if (url === '/api/automations/auto-1/history?limit=50') {
        return { entries: [] }
      }
      if (url === '/api/automations/auto-1' && init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Partial<AutomationListItem>
        automation = {
          ...automation,
          ...patch,
          nextRun: null,
        }
        return automation
      }

      throw new Error(`Unexpected fetchJson call: ${url}`)
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    queryClient?.clear()
    queryClient = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('updates provider and resets model to the selected provider default', async () => {
    await renderPanel()

    const cardButton = await waitForElement(
      () => Array.from(document.body.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('daily-check'),
      ) ?? null,
      'expected automation card button',
    )

    await act(async () => {
      cardButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushEffects()

    const providerSelect = await waitForElement(
      () => Array.from(document.body.querySelectorAll('select')).find((select) =>
        Array.from(select.options).some((option) => option.value === 'codex'),
      ) ?? null,
      'expected provider select',
    )

    await act(async () => {
      providerSelect.value = 'codex'
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flushEffects()

    const patchCall = mocks.fetchJson.mock.calls.find(([url, init]) =>
      url === '/api/automations/auto-1' && init?.method === 'PATCH',
    )
    expect(patchCall).toBeDefined()
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      agentType: 'codex',
      model: 'gpt-5.5',
    })
  })
})

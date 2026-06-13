// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useProviderRegistry: vi.fn(),
  useDirectories: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

vi.mock('@/hooks/use-agents', () => ({
  useDirectories: mocks.useDirectories,
}))

vi.mock('@/hooks/use-providers', () => ({
  useProviderRegistry: mocks.useProviderRegistry,
}))

import { CreateCommanderForm } from '../CreateCommanderForm'
import { CreateCommanderWizard } from '../CreateCommanderWizard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

async function flushReact(): Promise<void> {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) {
    throw new Error('Missing HTMLInputElement value setter')
  }
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (element): element is HTMLButtonElement => element.textContent?.includes(label) ?? false,
  )
  if (!button) {
    throw new Error(`Missing button with label: ${label}`)
  }
  return button
}

function findSelectByFirstOptionText(text: string): HTMLSelectElement {
  const select = Array.from(document.body.querySelectorAll('select')).find(
    (element): element is HTMLSelectElement => element.options[0]?.textContent?.includes(text) ?? false,
  )
  if (!select) {
    throw new Error(`Missing select with first option text containing: ${text}`)
  }
  return select
}

async function renderWizard(onAdd = vi.fn(async () => undefined)) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <CreateCommanderWizard
          onAdd={onAdd}
          isPending={false}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()

  return { onAdd }
}

async function renderForm(onAdd = vi.fn(async () => undefined)) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <CreateCommanderForm
          onAdd={onAdd}
          isPending={false}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()

  return { onAdd }
}

describe('CreateCommanderWizard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchJson.mockReset()
    mocks.useProviderRegistry.mockReset()
    mocks.useDirectories.mockReset()
    mocks.fetchJson.mockResolvedValue({
      defaults: { maxTurns: 25 },
      limits: { maxTurns: 25 },
    })
    mocks.useDirectories.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
    })
    mocks.useProviderRegistry.mockReturnValue({
      data: [
        {
          id: 'claude',
          label: 'Claude',
          eventProvider: 'claude',
          capabilities: {
            supportsAutomation: true,
            supportsCommanderConversation: true,
            supportsWorkerDispatch: true,
            supportsMessageImages: true,
          },
          uiCapabilities: {
            supportsEffort: true,
            supportsAdaptiveThinking: true,
            supportsMaxThinkingTokens: true,
            supportsSkills: true,
            supportsLoginMode: true,
            permissionModes: [],
          },
          availableModels: [
            { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
            { id: 'claude-opus-4-7', label: 'Opus 4.7' },
          ],
        },
        {
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
            permissionModes: [],
          },
          availableModels: [
            { id: 'gpt-5.4', label: 'GPT-5.4' },
            { id: 'gpt-5.5', label: 'GPT-5.5' },
          ],
        },
      ],
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      await flushReact()
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('re-populates model options and clears an invalid prior selection when agent type changes', async () => {
    await renderWizard()

    await act(async () => {
      findButton('Quick Create').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    const agentTypeSelect = Array.from(document.body.querySelectorAll('select')).find(
      (element): element is HTMLSelectElement => Array.from(element.options).some((option) => option.value === 'codex'),
    )
    if (!agentTypeSelect) {
      throw new Error('Missing agent type select')
    }
    const modelSelect = findSelectByFirstOptionText('Adapter default')

    await act(async () => {
      modelSelect.value = 'claude-opus-4-7'
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flushReact()
    expect(modelSelect.value).toBe('claude-opus-4-7')

    await act(async () => {
      agentTypeSelect.value = 'codex'
      agentTypeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flushReact()

    const refreshedModelSelect = findSelectByFirstOptionText('Adapter default')
    expect(refreshedModelSelect.value).toBe('')
    expect(Array.from(refreshedModelSelect.options).map((option) => option.textContent)).toEqual([
      '— Adapter default —',
      'GPT-5.4',
      'GPT-5.5',
    ])
  })

  it('submits model: null when adapter default is selected', async () => {
    const { onAdd } = await renderWizard()

    await act(async () => {
      findButton('Quick Create').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    const hostInput = Array.from(document.body.querySelectorAll('input')).find(
      (element): element is HTMLInputElement => element.placeholder === 'Host (e.g. infra-lead)',
    )
    if (!hostInput) {
      throw new Error('Missing host input')
    }

    await act(async () => {
      setInputValue(hostInput, 'atlas')
    })
    await flushReact()

    await act(async () => {
      findButton('Next').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    let cwdInput: HTMLInputElement | null = null
    await vi.waitFor(() => {
      const input = Array.from(document.body.querySelectorAll('input')).find(
        (element): element is HTMLInputElement => element.placeholder.includes('home directory'),
      )
      expect(input).toBeInstanceOf(HTMLInputElement)
      cwdInput = input as HTMLInputElement
    })
    expect(document.body.querySelector('button[aria-label="Browse directories"]')).not.toBeNull()

    await act(async () => {
      setInputValue(cwdInput!, '/Users/yugu/App')
    })
    await flushReact()

    await act(async () => {
      findButton('Next').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    await act(async () => {
      findButton('Create Commander').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      host: 'atlas',
      agentType: 'claude',
      model: null,
      cwd: '/Users/yugu/App',
    }))
  })

  it('passes the standalone form host to the directory picker', async () => {
    await renderForm()

    const hostInput = Array.from(document.body.querySelectorAll('input')).find(
      (element): element is HTMLInputElement => element.placeholder === 'host (e.g. my-agent-1)',
    )
    if (!hostInput) {
      throw new Error('Missing host input')
    }

    await act(async () => {
      setInputValue(hostInput, 'mac-mini')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(mocks.useDirectories.mock.calls.some((call) => call[2] === 'mac-mini')).toBe(true)
    })
  })

  it('passes the quick-create host to the wizard directory picker', async () => {
    await renderWizard()

    await act(async () => {
      findButton('Quick Create').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    const hostInput = Array.from(document.body.querySelectorAll('input')).find(
      (element): element is HTMLInputElement => element.placeholder === 'Host (e.g. infra-lead)',
    )
    if (!hostInput) {
      throw new Error('Missing host input')
    }

    await act(async () => {
      setInputValue(hostInput, 'remote-mac')
    })
    await flushReact()

    await act(async () => {
      findButton('Next').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(mocks.useDirectories.mock.calls.some((call) => call[2] === 'remote-mac')).toBe(true)
    })
  })
})

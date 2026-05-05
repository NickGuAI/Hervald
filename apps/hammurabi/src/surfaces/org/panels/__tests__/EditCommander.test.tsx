// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import type { OrgNode } from '@modules/org/types'

const mocks = vi.hoisted(() => ({
  fetchOrgCommanderDetail: vi.fn(),
  updateOrgCommander: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgActions', () => ({
  fetchOrgCommanderDetail: mocks.fetchOrgCommanderDetail,
  updateOrgCommander: mocks.updateOrgCommander,
}))

vi.mock('@modules/components/ModalFormContainer', () => ({
  ModalFormContainer: ({
    open,
    title,
    children,
  }: {
    open: boolean
    title: string
    children: ReactNode
  }) => (open ? (
    <div data-testid="modal-root">
      <h1>{title}</h1>
      {children}
    </div>
  ) : null),
}))

import { EditCommander } from '../EditCommander'

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

async function click(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`)
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flushReact()
}

async function renderPanel(props: {
  commanders: ReadonlyArray<Pick<OrgNode, 'id' | 'displayName'>>
  fallbackOperatorId?: string | null
  onClose?: () => void
  onUpdated?: (displayName: string) => void
  queryClient?: QueryClient
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = props.queryClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <EditCommander
          open
          commanderId="cmd-1"
          commanderDisplayName="Atlas"
          commanders={props.commanders}
          fallbackOperatorId={props.fallbackOperatorId}
          onClose={props.onClose ?? vi.fn()}
          onUpdated={props.onUpdated}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()

  return { queryClient }
}

describe('EditCommander', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchOrgCommanderDetail.mockReset()
    mocks.updateOrgCommander.mockReset()
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

  it('lazy-loads commander detail, validates duplicates, and patches only dirty fields', async () => {
    const onClose = vi.fn()
    const onUpdated = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)

    mocks.fetchOrgCommanderDetail.mockResolvedValue({
      id: 'cmd-1',
      displayName: 'Atlas',
      roleKey: 'engineering',
      persona: 'Owns the build pipeline.',
      agentType: 'claude',
      effort: 'max',
      cwd: '/tmp/atlas',
      maxTurns: 9,
      contextMode: 'fat',
      created: '2026-05-01T00:00:00.000Z',
      templateId: 'template-atlas',
      replicatedFromCommanderId: null,
      runtimeConfig: {
        limits: { maxTurns: 25 },
      },
    })
    mocks.updateOrgCommander.mockResolvedValue(undefined)

    await renderPanel({
      commanders: [
        { id: 'cmd-1', displayName: 'Atlas' },
        { id: 'cmd-2', displayName: 'Hermes' },
      ],
      fallbackOperatorId: 'founder-1',
      onClose,
      onUpdated,
      queryClient,
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLInputElement>('[data-testid="edit-commander-displayname-input"]')?.value).toBe('Atlas')
      expect(document.body.textContent).toContain('Update commander identity and runtime defaults without leaving the org page.')
      expect(document.body.querySelector('[data-testid="edit-commander-metadata"]')?.textContent).toContain('founder-1')
    })

    const saveButton = document.body.querySelector<HTMLButtonElement>('[data-testid="edit-commander-save-button"]')
    expect(saveButton?.disabled).toBe(true)

    const displayNameInput = document.body.querySelector<HTMLInputElement>('[data-testid="edit-commander-displayname-input"]')
    if (!displayNameInput) {
      throw new Error('Missing display name input')
    }

    await act(async () => {
      setElementValue(displayNameInput, 'Hermes')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Display name already exists.')
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="edit-commander-save-button"]')?.disabled).toBe(true)
    })

    await act(async () => {
      setElementValue(displayNameInput, 'Atlas Prime')
    })
    await flushReact()

    const maxTurnsInput = document.body.querySelector<HTMLInputElement>('[data-testid="edit-commander-maxturns-input"]')
    if (!maxTurnsInput) {
      throw new Error('Missing max turns input')
    }

    await act(async () => {
      setElementValue(maxTurnsInput, '21')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="edit-commander-save-button"]')?.disabled).toBe(false)
    })

    await click('[data-testid="edit-commander-save-button"]')

    expect(mocks.fetchOrgCommanderDetail).toHaveBeenCalledWith('cmd-1')
    expect(mocks.updateOrgCommander).toHaveBeenCalledTimes(1)
    expect(mocks.updateOrgCommander).toHaveBeenCalledWith('cmd-1', {
      displayName: 'Atlas Prime',
      maxTurns: 21,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ORG_QUERY_KEY })
    expect(onUpdated).toHaveBeenCalledWith('Atlas Prime')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

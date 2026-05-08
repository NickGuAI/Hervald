// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'

const mocks = vi.hoisted(() => ({
  replicateOrgCommander: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgActions', () => ({
  replicateOrgCommander: mocks.replicateOrgCommander,
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

import { ReplicateCommander } from '../ReplicateCommander'

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

function setElementValue(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
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

async function renderDialog(props: {
  onClose?: () => void
  onReplicated?: (commanderId: string, displayName: string) => void
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
        <ReplicateCommander
          open
          commanderId="cmd-1"
          commanderDisplayName="Atlas"
          commanders={[
            { displayName: 'Atlas' },
            { displayName: 'Atlas Copy' },
          ]}
          onClose={props.onClose ?? vi.fn()}
          onReplicated={props.onReplicated ?? vi.fn()}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()

  return { queryClient }
}

describe('ReplicateCommander', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.replicateOrgCommander.mockReset()
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

  it('validates duplicate names and posts the new display name to the replicate route', async () => {
    const onClose = vi.fn()
    const onReplicated = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)

    mocks.replicateOrgCommander.mockResolvedValue({ id: 'cmd-2' })

    await renderDialog({
      onClose,
      onReplicated,
      queryClient,
    })

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Display name already exists.')
      expect(document.body.textContent).toContain('Create a new commander with the same runtime defaults as Atlas.')
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="replicate-submit-button"]')?.disabled).toBe(true)
    })

    const input = document.body.querySelector<HTMLInputElement>('[data-testid="replicate-displayname-input"]')
    if (!input) {
      throw new Error('Missing replicate display name input')
    }

    await act(async () => {
      setElementValue(input, 'Atlas Mirror')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="replicate-submit-button"]')?.disabled).toBe(false)
    })

    await click('[data-testid="replicate-submit-button"]')

    expect(mocks.replicateOrgCommander).toHaveBeenCalledTimes(1)
    expect(mocks.replicateOrgCommander).toHaveBeenCalledWith('cmd-1', 'Atlas Mirror')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ORG_QUERY_KEY })
    expect(onReplicated).toHaveBeenCalledWith('cmd-2', 'Atlas Mirror')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

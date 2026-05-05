// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'

const mocks = vi.hoisted(() => ({
  archiveOrgCommander: vi.fn(),
  deleteOrgCommander: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgActions', () => ({
  archiveOrgCommander: mocks.archiveOrgCommander,
  deleteOrgCommander: mocks.deleteOrgCommander,
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

import { ConfirmDelete } from '../ConfirmDelete'

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

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

async function click(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`)
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushReact()
  })
}

async function doubleClick(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`)
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushReact()
  })
}

async function advanceToArchiveOffer() {
  await click('[data-testid="delete-commander-continue-button"]')
  expect(document.body.textContent).toContain('Are you absolutely sure?')

  await click('[data-testid="delete-commander-continue-button"]')
  expect(document.body.textContent).toContain('Final warning. Type the commander name to confirm.')

  const input = document.body.querySelector<HTMLInputElement>('[data-testid="delete-commander-confirm-input"]')
  if (!input) {
    throw new Error('Missing delete confirmation input')
  }

  await act(async () => {
    setElementValue(input, 'Atlas')
    await flushReact()
  })

  await click('[data-testid="delete-commander-continue-button"]')
  expect(document.body.textContent).toContain('Or archive instead?')
}

async function renderDialog(props: {
  onClose?: () => void
  onDeleted?: () => void
  onArchived?: () => void
  onOpenCommandRoom?: () => void
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
        <ConfirmDelete
          open
          commanderId="cmd-1"
          commanderDisplayName="Atlas"
          onClose={props.onClose ?? vi.fn()}
          onDeleted={props.onDeleted ?? vi.fn()}
          onArchived={props.onArchived ?? vi.fn()}
          onOpenCommandRoom={props.onOpenCommandRoom ?? vi.fn()}
        />
      </QueryClientProvider>,
    )
  })
  await flushReact()
  await flushReact()

  return { queryClient }
}

describe('ConfirmDelete', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.archiveOrgCommander.mockReset()
    mocks.deleteOrgCommander.mockReset()
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

  it('walks the triple-confirm flow and archives by default from the final offer', async () => {
    const onClose = vi.fn()
    const onArchived = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    mocks.archiveOrgCommander.mockResolvedValue(undefined)

    await renderDialog({
      onClose,
      onArchived,
      queryClient,
    })

    expect(document.body.textContent).toContain('Delete Atlas permanently?')
    await advanceToArchiveOffer()

    const archiveButton = document.body.querySelector<HTMLButtonElement>('[data-testid="delete-commander-archive-button"]')
    expect(archiveButton).toBe(document.activeElement)

    await click('[data-testid="delete-commander-archive-button"]')

    expect(mocks.archiveOrgCommander).toHaveBeenCalledWith('cmd-1')
    expect(mocks.deleteOrgCommander).not.toHaveBeenCalled()
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ORG_QUERY_KEY })
    expect(onArchived).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('only hard-deletes from the permanent branch after all confirmations', async () => {
    const onClose = vi.fn()
    const onDeleted = vi.fn()
    mocks.deleteOrgCommander.mockResolvedValue(undefined)

    await renderDialog({
      onClose,
      onDeleted,
    })

    await advanceToArchiveOffer()
    await click('[data-testid="delete-commander-permanent-button"]')

    expect(mocks.deleteOrgCommander).toHaveBeenCalledWith('cmd-1')
    expect(mocks.archiveOrgCommander).not.toHaveBeenCalled()
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('handleDelete bails if isPending is already true (double-tap protection)', async () => {
    const deferred = createDeferred()
    mocks.deleteOrgCommander.mockReturnValue(deferred.promise)

    await renderDialog({})
    await advanceToArchiveOffer()
    await doubleClick('[data-testid="delete-commander-permanent-button"]')

    expect(mocks.deleteOrgCommander).toHaveBeenCalledTimes(1)

    deferred.resolve()
    await act(async () => {
      await flushReact()
    })
  })

  it('handleArchive bails if isPending is already true', async () => {
    const deferred = createDeferred()
    mocks.archiveOrgCommander.mockReturnValue(deferred.promise)

    await renderDialog({})
    await advanceToArchiveOffer()
    await doubleClick('[data-testid="delete-commander-archive-button"]')

    expect(mocks.archiveOrgCommander).toHaveBeenCalledTimes(1)

    deferred.resolve()
    await act(async () => {
      await flushReact()
    })
  })

  it('swaps to the refuse variant on 409 and opens the command room via callback', async () => {
    const onClose = vi.fn()
    const onArchived = vi.fn()
    const onOpenCommandRoom = vi.fn()
    mocks.archiveOrgCommander.mockRejectedValue(
      new Error('Request failed (409): Commander "cmd-1" has a live worker session. Stop it before archiving.'),
    )

    await renderDialog({
      onClose,
      onArchived,
      onOpenCommandRoom,
    })

    await advanceToArchiveOffer()
    await click('[data-testid="delete-commander-archive-button"]')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="delete-commander-refuse-modal"]')).not.toBeNull()
      expect(document.body.textContent).toContain('Open /command-room')
    })

    await click('[data-testid="delete-commander-open-room-button"]')

    expect(onOpenCommandRoom).toHaveBeenCalledTimes(1)
    expect(onArchived).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

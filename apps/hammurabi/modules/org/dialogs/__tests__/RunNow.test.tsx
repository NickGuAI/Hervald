// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runOrgCommanderNow: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgActions', () => ({
  runOrgCommanderNow: mocks.runOrgCommanderNow,
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

import { RunNow } from '../RunNow'

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

function setElementValue(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
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
  onSuccess?: () => void
  onError?: (message: string) => void
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <RunNow
        open
        commanderId="cmd-1"
        commanderDisplayName="Atlas"
        onClose={props.onClose ?? vi.fn()}
        onSuccess={props.onSuccess}
        onError={props.onError}
      />,
    )
  })
  await flushReact()
  await flushReact()
}

describe('RunNow', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.runOrgCommanderNow.mockReset()
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

  it('requires a task message and posts it to the run-now route', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    mocks.runOrgCommanderNow.mockResolvedValue(undefined)

    await renderDialog({
      onClose,
      onSuccess,
    })

    expect(document.body.textContent).toContain('Send a task message to Atlas.')
    expect(document.body.querySelector<HTMLButtonElement>('[data-testid="run-now-submit-button"]')?.disabled).toBe(true)

    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-testid="run-now-message-input"]')
    if (!textarea) {
      throw new Error('Missing run-now message input')
    }

    await act(async () => {
      setElementValue(textarea, 'Review issue #1307 before lunch.')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="run-now-submit-button"]')?.disabled).toBe(false)
    })

    await click('[data-testid="run-now-submit-button"]')

    expect(mocks.runOrgCommanderNow).toHaveBeenCalledTimes(1)
    expect(mocks.runOrgCommanderNow).toHaveBeenCalledWith('cmd-1', 'Review issue #1307 before lunch.')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('surfaces request failures through the error callback and inline copy', async () => {
    const onError = vi.fn()

    mocks.runOrgCommanderNow.mockRejectedValue(new Error('Request failed (500): boom'))

    await renderDialog({
      onError,
    })

    expect(document.body.querySelector<HTMLButtonElement>('[data-testid="run-now-submit-button"]')?.disabled).toBe(true)

    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-testid="run-now-message-input"]')
    if (!textarea) {
      throw new Error('Missing run-now message input')
    }

    await act(async () => {
      setElementValue(textarea, 'Investigate the blocked run.')
    })
    await flushReact()

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="run-now-submit-button"]')?.disabled).toBe(false)
    })

    await click('[data-testid="run-now-submit-button"]')

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Request failed (500): boom')
      expect(document.body.querySelector('[data-testid="run-now-error"]')?.textContent).toContain('Request failed (500): boom')
    })
  })
})

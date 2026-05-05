// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useOrgIdentity: vi.fn(),
}))

vi.mock('../../hooks/useOrgIdentity', () => ({
  useOrgIdentity: mocks.useOrgIdentity,
  useUpdateOrgIdentity: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}))

import { OrgIdentityCard } from '../OrgIdentityCard'

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

async function renderCard() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<OrgIdentityCard />)
    await flushReact()
  })
  await flushReact()
}

async function submitWithName(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('[data-testid="org-identity-name-input"]')
  const button = document.body.querySelector<HTMLButtonElement>('[data-testid="org-identity-save-button"]')
  if (!input || !button) {
    throw new Error('Missing org identity form controls')
  }

  await act(async () => {
    setElementValue(input, value)
    await flushReact()
  })
  await act(async () => {
    button.click()
    await flushReact()
  })
}

describe('OrgIdentityCard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.mutateAsync.mockReset()
    mocks.useOrgIdentity.mockReturnValue({
      data: {
        name: 'Organization',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      error: null,
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
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('trims and saves the org name', async () => {
    mocks.mutateAsync.mockResolvedValue({
      name: 'Gehirn Inc.',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    })

    await renderCard()
    await submitWithName('  Gehirn Inc.  ')

    expect(mocks.mutateAsync).toHaveBeenCalledWith({ name: 'Gehirn Inc.' })
  })

  it('validates name length before saving', async () => {
    await renderCard()
    await submitWithName('x'.repeat(81))

    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Org name must be 80 characters or fewer.')
  })
})

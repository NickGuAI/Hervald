// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '@modules/org/types'

const mocks = vi.hoisted(() => ({
  createOrgCommander: vi.fn(),
  useHireCommanderWizardForm: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgActions', () => ({
  createOrgCommander: mocks.createOrgCommander,
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

vi.mock('@modules/org/forms', async () => {
  const actual = await vi.importActual<typeof import('@modules/org/forms')>('@modules/org/forms')
  return {
    ...actual,
    useHireCommanderWizardForm: mocks.useHireCommanderWizardForm,
  }
})

import { HireCommanderWizard } from '../HireCommanderWizard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderWizard(props: {
  commanders?: ReadonlyArray<OrgNode>
  onClose?: () => void
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <HireCommanderWizard
        open
        commanders={props.commanders ?? []}
        onClose={props.onClose ?? vi.fn()}
      />,
    )
    await Promise.resolve()
  })
}

async function click(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`)
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('HireCommanderWizard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.createOrgCommander.mockReset()
    mocks.useHireCommanderWizardForm.mockReset()
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

  it('submits the review state through POST /api/commanders', async () => {
    const onClose = vi.fn()
    const reset = vi.fn()
    const setGlobalError = vi.fn()
    const buildCreateRequestBody = vi.fn((_: string) => ({
      host: 'atlas-hidden',
      displayName: 'Atlas',
      roleKey: 'engineering',
      persona: '',
      agentType: 'claude',
      effort: 'max',
    }))

    mocks.createOrgCommander.mockResolvedValue({ id: 'cmd-1' })
    mocks.useHireCommanderWizardForm.mockReturnValue({
      step: 'review',
      values: {
        displayName: 'Atlas',
        roleKey: 'engineering',
        persona: '',
        agentType: 'claude',
        effort: 'max',
      },
      errors: {
        global: null,
        displayName: null,
        roleKey: null,
      },
      dirty: true,
      updateField: vi.fn(),
      goBack: vi.fn(),
      goNext: vi.fn(),
      reset,
      buildCreateRequestBody,
      setGlobalError,
    })

    await renderWizard({
      commanders: [],
      onClose,
    })

    await click('[data-testid="hire-submit-button"]')

    expect(buildCreateRequestBody).toHaveBeenCalledTimes(1)
    expect(String(buildCreateRequestBody.mock.calls[0]?.[0])).toMatch(/^atlas-/)
    expect(mocks.createOrgCommander).toHaveBeenCalledTimes(1)
    expect(mocks.createOrgCommander).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Atlas',
      roleKey: 'engineering',
      agentType: 'claude',
    }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '@modules/org/types'

const mocks = vi.hoisted(() => ({
  createOrgAutomation: vi.fn(),
  useNewAutomationWizardForm: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgActions', () => ({
  createOrgAutomation: mocks.createOrgAutomation,
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
    useNewAutomationWizardForm: mocks.useNewAutomationWizardForm,
  }
})

import { NewAutomationWizard } from '../NewAutomationWizard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderWizard(props: {
  commanders: ReadonlyArray<OrgNode>
  automations?: ReadonlyArray<OrgNode>
  onClose?: () => void
  onCreated?: (automationId: string) => void
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <NewAutomationWizard
        open
        owner={{ kind: 'commander', id: 'cmd-1', displayName: 'Atlas', roleLabel: 'Engineering' }}
        commanders={props.commanders}
        automations={props.automations ?? []}
        onClose={props.onClose ?? vi.fn()}
        onCreated={props.onCreated}
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

describe('NewAutomationWizard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.createOrgAutomation.mockReset()
    mocks.useNewAutomationWizardForm.mockReset()
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

  it('submits the review state through POST /api/automations', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()
    const reset = vi.fn()
    const setGlobalError = vi.fn()
    const buildCreateRequestBody = vi.fn(() => ({
      name: 'Daily digest',
      parentCommanderId: 'cmd-1',
      trigger: 'schedule',
      schedule: '*/5 * * * *',
      instruction: 'Summarize the backlog.',
      agentType: 'claude',
      status: 'active',
    }))

    mocks.createOrgAutomation.mockResolvedValue({ id: 'auto-1' })
    mocks.useNewAutomationWizardForm.mockReturnValue({
      step: 'review',
      values: {
        trigger: 'schedule',
        cadencePreset: 'every-5-minutes',
        customCron: '',
        questCommanderId: 'cmd-1',
        name: 'Daily digest',
        instruction: 'Summarize the backlog.',
        agentType: 'claude',
      },
      errors: {
        global: null,
        trigger: null,
        cron: null,
        name: null,
        instruction: null,
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
      commanders: [{
        id: 'cmd-1',
        kind: 'commander',
        parentId: 'founder-1',
        displayName: 'Atlas',
        status: 'active',
        costUsd: 0,
      }],
      onClose,
      onCreated,
    })

    await click('[data-testid="new-automation-submit-button"]')

    expect(buildCreateRequestBody).toHaveBeenCalledTimes(1)
    expect(buildCreateRequestBody).toHaveBeenCalledWith({
      kind: 'commander',
      id: 'cmd-1',
      displayName: 'Atlas',
      roleLabel: 'Engineering',
    })
    expect(mocks.createOrgAutomation).toHaveBeenCalledTimes(1)
    expect(mocks.createOrgAutomation).toHaveBeenCalledWith({
      name: 'Daily digest',
      parentCommanderId: 'cmd-1',
      trigger: 'schedule',
      schedule: '*/5 * * * *',
      instruction: 'Summarize the backlog.',
      agentType: 'claude',
      status: 'active',
    })
    expect(onCreated).toHaveBeenCalledWith('auto-1')
    expect(reset).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

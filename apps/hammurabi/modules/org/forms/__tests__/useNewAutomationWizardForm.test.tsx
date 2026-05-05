// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNewAutomationWizardForm } from '../useNewAutomationWizardForm'

const mockUseProviderRegistry = vi.fn()

vi.mock('@/hooks/use-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-providers')>()
  return {
    ...actual,
    useProviderRegistry: () => mockUseProviderRegistry(),
  }
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null
let latestForm: ReturnType<typeof useNewAutomationWizardForm> | null = null

function HookHarness() {
  latestForm = useNewAutomationWizardForm({
    existingAutomationNames: ['context-hygiene'],
    commanders: [{ id: 'cmd-1', displayName: 'Atlas' }],
    defaultQuestCommanderId: 'cmd-1',
  })
  return null
}

async function flushReact(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function renderHook() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<HookHarness />)
    await flushReact()
  })
}

describe('useNewAutomationWizardForm', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockUseProviderRegistry.mockReturnValue({
      data: [
        {
          id: 'claude',
          label: 'Claude',
          capabilities: {
            supportsAutomation: true,
            supportsCommanderConversation: true,
            supportsWorkerDispatch: true,
          },
        },
        {
          id: 'gemini',
          label: 'Gemini',
          capabilities: {
            supportsAutomation: true,
            supportsCommanderConversation: true,
            supportsWorkerDispatch: true,
          },
        },
      ],
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
    latestForm = null
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('moves from trigger to details when the trigger is valid', async () => {
    await renderHook()

    let advanced = false
    await act(async () => {
      advanced = latestForm!.goNext()
      await flushReact()
    })

    expect(advanced).toBe(true)
    expect(latestForm?.step).toBe('details')
  })

  it('validates details before review and builds a request body when valid', async () => {
    await renderHook()

    await act(async () => {
      latestForm?.goNext()
      await flushReact()
    })

    await act(async () => {
      latestForm?.updateField('name', 'Daily Briefing')
      latestForm?.updateField('instruction', 'Summarize updates.')
      latestForm?.updateField('agentType', 'gemini')
      await flushReact()
    })

    let advanced = false
    await act(async () => {
      advanced = latestForm!.goNext()
      await flushReact()
    })

    expect(advanced).toBe(true)
    expect(latestForm?.step).toBe('review')

    let payload = null
    await act(async () => {
      payload = latestForm!.buildCreateRequestBody({
        kind: 'commander',
        id: 'cmd-1',
        displayName: 'Atlas',
        roleLabel: 'Engineering',
      })
      await flushReact()
    })

    expect(payload).toEqual({
      name: 'Daily Briefing',
      parentCommanderId: 'cmd-1',
      trigger: 'schedule',
      schedule: '*/5 * * * *',
      instruction: 'Summarize updates.',
      agentType: 'gemini',
      status: 'active',
    })
  })

  it('rejects invalid custom cron expressions', async () => {
    await renderHook()

    await act(async () => {
      latestForm?.goNext()
      await flushReact()
    })

    await act(async () => {
      latestForm?.updateField('cadencePreset', 'custom')
      latestForm?.updateField('customCron', 'bad cron')
      latestForm?.updateField('name', 'Daily Briefing')
      latestForm?.updateField('instruction', 'Summarize updates.')
      await flushReact()
    })

    let advanced = true
    await act(async () => {
      advanced = latestForm!.goNext()
      await flushReact()
    })

    expect(advanced).toBe(false)
    expect(latestForm?.step).toBe('details')
    expect(latestForm?.errors.cron).toBe('Cron expression must contain exactly five fields.')
  })
})

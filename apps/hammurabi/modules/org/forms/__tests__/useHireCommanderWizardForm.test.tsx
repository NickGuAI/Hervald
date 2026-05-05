// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHireCommanderWizardForm } from '../useHireCommanderWizardForm'

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
let latestForm: ReturnType<typeof useHireCommanderWizardForm> | null = null

function HookHarness() {
  latestForm = useHireCommanderWizardForm({
    existingCommanderNames: ['Atlas'],
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

describe('useHireCommanderWizardForm', () => {
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
          id: 'codex',
          label: 'Codex',
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

  it('stays on details until required fields are valid', async () => {
    await renderHook()

    let advanced = true
    await act(async () => {
      advanced = latestForm!.goNext()
      await flushReact()
    })

    expect(advanced).toBe(false)
    expect(latestForm?.step).toBe('details')
    expect(latestForm?.errors.displayName).toBe('Display name is required.')
    expect(latestForm?.errors.roleKey).toBe('Select a valid role.')
  })

  it('advances to review and builds the request body once valid', async () => {
    await renderHook()

    await act(async () => {
      latestForm?.updateField('displayName', 'Nyx')
      latestForm?.updateField('roleKey', 'engineering')
      latestForm?.updateField('agentType', 'codex')
      latestForm?.updateField('effort', 'high')
      latestForm?.updateField('persona', 'Builds production systems.')
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
      payload = latestForm!.buildCreateRequestBody('nyx-hidden')
      await flushReact()
    })

    expect(payload).toEqual({
      host: 'nyx-hidden',
      displayName: 'Nyx',
      roleKey: 'engineering',
      persona: 'Builds production systems.',
      agentType: 'codex',
      effort: 'high',
    })
  })
})

// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateAutomationTaskForm } from '../CreateAutomationTaskForm'

const mocks = vi.hoisted(() => ({
  useSkills: vi.fn(),
  useProviderRegistry: vi.fn(),
}))

vi.mock('@/hooks/use-skills', () => ({
  useSkills: mocks.useSkills,
}))

vi.mock('@/hooks/use-providers', () => ({
  useProviderRegistry: mocks.useProviderRegistry,
}))

vi.mock('../../../agents/components/NewSessionForm', () => ({
  NewSessionForm: ({
    beforeTaskField,
  }: {
    beforeTaskField?: ReactNode
  }) => (
    <div data-testid="new-session-form">
      {beforeTaskField}
    </div>
  ),
}))

vi.mock('../ProviderModelSelect', () => ({
  ProviderModelSelect: () => <select aria-label="Model" />,
  resolveProviderModelOptions: () => [],
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderForm() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <CreateAutomationTaskForm
        onCreate={vi.fn()}
        onClose={vi.fn()}
        machines={[]}
        createPending={false}
      />,
    )
    await Promise.resolve()
  })
}

beforeEach(() => {
  mocks.useProviderRegistry.mockReturnValue({
    data: [
      {
        id: 'codex',
        label: 'Codex',
        uiCapabilities: { supportsSkills: true },
      },
      {
        id: 'claude',
        label: 'Claude',
        uiCapabilities: { supportsSkills: true },
      },
    ],
  })
  mocks.useSkills.mockReturnValue({
    data: undefined,
    error: new Error('Request failed (401): Unauthorized'),
    isError: true,
    isLoading: false,
    refetch: vi.fn(),
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('CreateAutomationTaskForm', () => {
  it('shows skills auth failures instead of the empty skills copy', async () => {
    await renderForm()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Request failed (401): Unauthorized')
    })
    expect(document.body.textContent).toContain('Retry')
    expect(document.body.textContent).not.toContain('No user-invocable skills installed')
  })
})

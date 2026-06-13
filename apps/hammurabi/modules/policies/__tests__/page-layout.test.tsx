// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useActionPolicies: vi.fn(),
  usePolicySettings: vi.fn(),
  usePolicyCommanders: vi.fn(),
  useUpdateActionPolicy: vi.fn(),
  useUpdatePolicySettings: vi.fn(),
  useSkills: vi.fn(),
}))

vi.mock('@/hooks/use-action-policies', () => ({
  useActionPolicies: mocks.useActionPolicies,
  usePolicySettings: mocks.usePolicySettings,
  usePolicyCommanders: mocks.usePolicyCommanders,
  useUpdateActionPolicy: mocks.useUpdateActionPolicy,
  useUpdatePolicySettings: mocks.useUpdatePolicySettings,
}))

vi.mock('@/hooks/use-skills', () => ({
  useSkills: mocks.useSkills,
}))

import PoliciesPage from '../page'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

function createQueryResult<T>(data: T) {
  return {
    data,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }
}

async function renderPoliciesPage(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<PoliciesPage />)
    await Promise.resolve()
  })
}

describe('PoliciesPage layout', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

    mocks.usePolicyCommanders.mockReturnValue(createQueryResult([
      {
        id: 'cmd-atlas',
        displayName: 'Atlas',
        host: 'mac-mini',
      },
    ]))
    mocks.useActionPolicies.mockReturnValue(createQueryResult([
      {
        actionId: 'send-email',
        id: 'send-email',
        name: 'Send Email',
        kind: 'action',
        policy: 'review',
        allowlist: ['*@gehirn.ai'],
        blocklist: ['*@blocked.example'],
        sourceScope: 'global',
        scope: 'global',
      },
    ]))
    mocks.usePolicySettings.mockReturnValue(createQueryResult({
      timeoutMinutes: 15,
      timeoutAction: 'block',
      standingApprovalExpiryDays: 30,
    }))
    mocks.useSkills.mockReturnValue(createQueryResult([
      {
        name: 'audit-pr',
        description: 'Review a pull request.',
        userInvocable: true,
      },
    ]))
    mocks.useUpdateActionPolicy.mockReturnValue({
      mutate: vi.fn(),
      error: null,
      isPending: false,
      variables: null,
    })
    mocks.useUpdatePolicySettings.mockReturnValue({
      mutate: vi.fn(),
      error: null,
      isPending: false,
      variables: null,
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
        await Promise.resolve()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    vi.clearAllMocks()
  })

  it('lets the Shell own vertical page scrolling', async () => {
    await renderPoliciesPage()

    const page = document.body.querySelector('[data-testid="policies-page"]') as HTMLElement | null
    expect(page).not.toBeNull()
    expect(page?.tagName).toBe('SECTION')
    const pageClasses = page?.className.split(/\s+/) ?? []
    expect(pageClasses).toContain('w-full')
    expect(pageClasses).toContain('min-w-0')
    expect(pageClasses).not.toContain('h-full')
    expect(pageClasses).not.toContain('overflow-y-auto')

    const content = document.body.querySelector('[data-testid="policies-page-content"]') as HTMLElement | null
    expect(content).not.toBeNull()
    const contentClasses = content?.className.split(/\s+/) ?? []
    expect(contentClasses).toContain('w-full')
    expect(contentClasses).toContain('max-w-full')
    expect(contentClasses).not.toContain('flex-1')
    expect(contentClasses).not.toContain('min-h-0')
    expect(contentClasses).not.toContain('overflow-y-auto')

    const routeOwnedVerticalScrollers = Array.from(page?.querySelectorAll('*') ?? []).filter((element) =>
      String((element as HTMLElement).className).includes('overflow-y-auto')
    )
    expect(routeOwnedVerticalScrollers).toHaveLength(0)

    const tableScroll = document.body.querySelector('[data-testid="policies-table-scroll"]') as HTMLElement | null
    expect(tableScroll).not.toBeNull()
    expect(tableScroll?.className).toContain('overflow-x-auto')
  })
})

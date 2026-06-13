// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import { useComposerAbilities } from '@/hooks/use-composer-abilities'

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null
let latestAbilities: ReturnType<typeof useComposerAbilities> | null = null

function Harness() {
  latestAbilities = useComposerAbilities()
  return createElement('span', null, latestAbilities.abilities.length)
}

async function renderHookHarness(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Harness),
    ))
  })
}

async function unmountHarness(): Promise<void> {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  queryClient?.clear()
  queryClient = null
  container?.remove()
  container = null
}

beforeEach(() => {
  latestAbilities = null
})

afterEach(async () => {
  await unmountHarness()
  latestAbilities = null
  vi.clearAllMocks()
})

describe('useComposerAbilities', () => {
  it('exposes settings auth failures while keeping local defaults available', async () => {
    mocks.fetchJson.mockRejectedValueOnce(new Error('Request failed (401): Unauthorized'))

    await renderHookHarness()

    await vi.waitFor(() => {
      expect(latestAbilities?.loadError?.message).toContain('401')
    })
    expect(latestAbilities?.abilities.map((ability) => ability.id)).toContain('think-hard')
  })
})

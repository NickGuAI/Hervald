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

import { useFontScale } from '@/hooks/use-font-scale'

let root: Root | null = null
let container: HTMLDivElement | null = null
let latestFontScale: ReturnType<typeof useFontScale> | null = null

function createSettings(fontScale: number) {
  return {
    settings: {
      theme: 'light',
      fontScale,
      updatedAt: '2026-05-03T00:00:00.000Z',
    },
  }
}

function Harness() {
  latestFontScale = useFontScale({ applyToDocument: true })
  return createElement(
    'button',
    {
      type: 'button',
      onClick: () => latestFontScale?.adjustFontScale(0.1),
    },
    latestFontScale.fontScale,
  )
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderHookHarness(): Promise<QueryClient> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
    )
  })

  return queryClient
}

beforeEach(() => {
  latestFontScale = null
  document.documentElement.style.removeProperty('--hv-font-scale')
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
  latestFontScale = null
  document.documentElement.style.removeProperty('--hv-font-scale')
  vi.clearAllMocks()
})

describe('useFontScale', () => {
  it('loads fontScale from backend settings and applies it to html', async () => {
    mocks.fetchJson.mockResolvedValueOnce(createSettings(1.2))

    await renderHookHarness()
    await flushMicrotasks()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/settings')
      expect(latestFontScale?.fontScale).toBe(1.2)
      expect(document.documentElement.style.getPropertyValue('--hv-font-scale')).toBe('1.2')
    })
  })

  it('persists fontScale changes through backend settings', async () => {
    mocks.fetchJson
      .mockResolvedValueOnce(createSettings(1))
      .mockResolvedValueOnce(createSettings(1.1))
      .mockResolvedValueOnce(createSettings(1.1))

    await renderHookHarness()
    await flushMicrotasks()

    await act(async () => {
      latestFontScale?.adjustFontScale(0.1)
    })
    await flushMicrotasks()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenNthCalledWith(2, '/api/settings', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ fontScale: 1.1 }),
      })
      expect(latestFontScale?.fontScale).toBe(1.1)
      expect(document.documentElement.style.getPropertyValue('--hv-font-scale')).toBe('1.1')
    })
  })

  it('does not seed the settings cache before backend settings have loaded', async () => {
    mocks.fetchJson
      .mockRejectedValueOnce(new Error('settings load failed'))
      .mockImplementationOnce(() => new Promise(() => {}))

    const queryClient = await renderHookHarness()
    await flushMicrotasks()

    await act(async () => {
      latestFontScale?.setFontScale(1.1)
    })
    await flushMicrotasks()

    expect(queryClient.getQueryData(['settings'])).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--hv-font-scale')).toBe('1.1')
  })

  it('keeps the newest fontScale when mutations resolve out of order', async () => {
    let latestServerScale = 1
    let resolveFirstPatch: ((value: unknown) => void) | null = null
    let resolveSecondPatch: ((value: unknown) => void) | null = null

    mocks.fetchJson.mockImplementation((_url, init?: RequestInit) => {
      if (!init) {
        return Promise.resolve(createSettings(latestServerScale))
      }

      const body = JSON.parse(String(init.body)) as { fontScale: number }
      if (body.fontScale === 1.1) {
        return new Promise((resolve) => {
          resolveFirstPatch = resolve
        })
      }
      if (body.fontScale === 1.2) {
        return new Promise((resolve) => {
          resolveSecondPatch = resolve
        })
      }

      return Promise.reject(new Error(`Unexpected font scale ${body.fontScale}`))
    })

    await renderHookHarness()
    await flushMicrotasks()
    await vi.waitFor(() => {
      expect(latestFontScale?.fontScale).toBe(1)
    })

    await act(async () => {
      latestFontScale?.setFontScale(1.1)
    })
    await flushMicrotasks()
    await vi.waitFor(() => {
      expect(resolveFirstPatch).not.toBeNull()
    })

    await act(async () => {
      latestFontScale?.setFontScale(1.2)
    })
    await flushMicrotasks()
    await vi.waitFor(() => {
      expect(resolveSecondPatch).not.toBeNull()
    })

    await act(async () => {
      latestServerScale = 1.2
      resolveSecondPatch?.(createSettings(1.2))
    })
    await flushMicrotasks()

    await vi.waitFor(() => {
      expect(latestFontScale?.fontScale).toBe(1.2)
      expect(document.documentElement.style.getPropertyValue('--hv-font-scale')).toBe('1.2')
    })

    await act(async () => {
      resolveFirstPatch?.(createSettings(1.1))
    })
    await flushMicrotasks()

    await vi.waitFor(() => {
      expect(latestFontScale?.fontScale).toBe(1.2)
      expect(document.documentElement.style.getPropertyValue('--hv-font-scale')).toBe('1.2')
    })
  })
})

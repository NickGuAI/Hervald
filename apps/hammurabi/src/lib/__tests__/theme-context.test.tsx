// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme, type AppTheme } from '@/lib/theme-context'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let latestTheme: ReturnType<typeof useTheme> | null = null

function Harness() {
  latestTheme = useTheme()
  return createElement(
    'button',
    {
      type: 'button',
      onClick: () => latestTheme?.toggleTheme(),
    },
    latestTheme.theme,
  )
}

function createSettings(theme: AppTheme) {
  return {
    settings: {
      theme,
      updatedAt: '2026-05-03T00:00:00.000Z',
    },
  }
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderThemeProvider(): Promise<void> {
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
      createElement(QueryClientProvider, { client: queryClient },
        createElement(ThemeProvider, null, createElement(Harness)),
      ),
    )
  })
}

beforeEach(() => {
  document.documentElement.className = 'hv-light'
  latestTheme = null
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
  latestTheme = null
  document.documentElement.className = ''
  vi.clearAllMocks()
})

describe('ThemeProvider', () => {
  it('loads the theme from backend settings and applies it to html', async () => {
    mocks.fetchJson.mockResolvedValueOnce(createSettings('dark'))

    await renderThemeProvider()
    await flushMicrotasks()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/settings')
      expect(latestTheme?.theme).toBe('dark')
      expect(document.documentElement.classList.contains('hv-dark')).toBe(true)
      expect(document.documentElement.classList.contains('hv-light')).toBe(false)
    })
  })

  it('persists theme changes through backend settings', async () => {
    mocks.fetchJson
      .mockResolvedValueOnce(createSettings('light'))
      .mockResolvedValueOnce(createSettings('dark'))
      .mockResolvedValueOnce(createSettings('dark'))

    await renderThemeProvider()
    await flushMicrotasks()

    await act(async () => {
      latestTheme?.setTheme('dark')
    })
    await flushMicrotasks()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenNthCalledWith(2, '/api/settings', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ theme: 'dark' }),
      })
      expect(latestTheme?.theme).toBe('dark')
      expect(document.documentElement.classList.contains('hv-dark')).toBe(true)
    })
  })

  it('does not write theme to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    mocks.fetchJson.mockResolvedValueOnce(createSettings('light'))

    await renderThemeProvider()
    await flushMicrotasks()

    expect(setItem).not.toHaveBeenCalledWith(
      expect.stringContaining('theme'),
      expect.any(String),
    )
    setItem.mockRestore()
  })
})

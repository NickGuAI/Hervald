// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsMobile } from '@/hooks/use-is-mobile'

const NARROW_QUERY = '(max-width: 767px)'
const COARSE_PHONE_QUERY = '(pointer: coarse) and (max-width: 932px)'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalActEnvironment: boolean | undefined

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function buildMatchMedia(queryMatches: Record<string, boolean>) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: Boolean(queryMatches[query]),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function HookHarness() {
  const isMobile = useIsMobile()
  return createElement('div', { 'data-testid': 'is-mobile' }, isMobile ? 'mobile' : 'desktop')
}

async function renderHook() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    flushSync(() => {
      root?.render(createElement(HookHarness))
    })
  })
}

function readIsMobileText(): string {
  const node = document.body.querySelector('[data-testid="is-mobile"]')
  expect(node).not.toBeNull()
  return node?.textContent ?? ''
}

describe('useIsMobile coarse pointer handling', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    if (root) {
      act(() => {
        flushSync(() => {
          root?.unmount()
        })
      })
    }

    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
    vi.clearAllMocks()
  })

  it('treats a coarse-pointer 844px phone as mobile', async () => {
    window.matchMedia = buildMatchMedia({
      [NARROW_QUERY]: false,
      [COARSE_PHONE_QUERY]: true,
    })

    await renderHook()

    expect(readIsMobileText()).toBe('mobile')
  })

  it('treats a fine-pointer 844px viewport as desktop', async () => {
    window.matchMedia = buildMatchMedia({
      [NARROW_QUERY]: false,
      [COARSE_PHONE_QUERY]: false,
    })

    await renderHook()

    expect(readIsMobileText()).toBe('desktop')
  })
})

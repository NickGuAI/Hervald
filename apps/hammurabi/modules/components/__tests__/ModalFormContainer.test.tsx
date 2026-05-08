// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  theme: 'light' as 'light' | 'dark',
}))

vi.mock('@/lib/theme-context', () => ({
  useTheme: () => ({
    theme: mocks.theme,
    setTheme: () => undefined,
    toggleTheme: () => undefined,
    isLoading: false,
    isSaving: false,
  }),
}))

import { ModalFormContainer } from '../ModalFormContainer'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let styleElement: HTMLStyleElement | null = null

function setDocumentTheme(themeClassName: 'hv-light' | 'hv-dark'): void {
  document.documentElement.classList.remove('hv-light', 'hv-dark')
  document.documentElement.classList.add(themeClassName)
}

async function renderModal(themeClassName: 'hv-light' | 'hv-dark'): Promise<void> {
  mocks.theme = themeClassName === 'hv-dark' ? 'dark' : 'light'
  setDocumentTheme(themeClassName)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <ModalFormContainer key={themeClassName} open title="Edit Commander" onClose={() => undefined}>
        <div
          data-testid="modal-theme-swatch"
          className="rounded-lg border border-ink-border bg-washi-white px-3 py-2 text-sumi-black"
        >
          Theme swatch
        </div>
      </ModalFormContainer>,
    )
    await Promise.resolve()
  })
}

describe('ModalFormContainer', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    styleElement = document.createElement('style')
    styleElement.textContent = `
      .hv-light {
        --hv-bg: #FAF8F5;
        --hv-fg: #1C1C1C;
        --hv-border-hair: rgba(28, 28, 28, 0.08);
      }
      .hv-dark {
        --hv-bg: #151515;
        --hv-fg: #f2eee7;
        --hv-border-hair: rgba(250, 248, 245, 0.08);
      }
      .bg-washi-white { background-color: var(--hv-bg); }
      .text-sumi-black { color: var(--hv-fg); }
      .border { border-style: solid; border-width: 1px; }
      .border-ink-border { border-color: var(--hv-border-hair); }
      .sheet { background-color: var(--hv-bg); }
      .card-sumi { background-color: var(--hv-bg); }
    `
    document.head.appendChild(styleElement)
    window.matchMedia = ((query: string) => ({
      matches: query === '(min-width: 768px)',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    })) as typeof window.matchMedia
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
    styleElement?.remove()
    styleElement = null
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    document.documentElement.classList.remove('hv-light', 'hv-dark')
  })

  it('propagates the active theme to both mobile and desktop dialog roots', async () => {
    await renderModal('hv-light')

    let swatches = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-testid="modal-theme-swatch"]'),
    )
    expect(swatches).toHaveLength(2)
    expect(document.body.querySelectorAll('.hv-light')).toHaveLength(2)
    for (const swatch of swatches) {
      const themedRoot = swatch.closest('.hv-light')
      expect(themedRoot).not.toBeNull()
      expect(window.getComputedStyle(themedRoot as HTMLElement).getPropertyValue('--hv-bg').trim()).toBe('#FAF8F5')
    }

    await act(async () => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    await renderModal('hv-dark')

    swatches = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-testid="modal-theme-swatch"]'),
    )
    expect(swatches).toHaveLength(2)
    expect(document.body.querySelectorAll('.hv-dark')).toHaveLength(2)
    for (const swatch of swatches) {
      const themedRoot = swatch.closest('.hv-dark')
      expect(themedRoot).not.toBeNull()
      expect(window.getComputedStyle(themedRoot as HTMLElement).getPropertyValue('--hv-bg').trim()).toBe('#151515')
    }
  })
})

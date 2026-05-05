// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileAutomations } from '../MobileAutomations'

vi.mock('@modules/commanders/components/AutomationPanel', () => ({
  AutomationPanel: ({
    scope,
    filter,
  }: {
    scope: { kind: 'global' } | { kind: 'commander'; commander: { id: string } }
    filter: string
  }) => (
    <div
      data-testid="mobile-automation-panel"
      data-filter={filter}
      data-scope={scope.kind}
      data-commander={scope.kind === 'commander' ? scope.commander.id : 'global'}
    />
  ),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined

const commander = {
  id: 'cmd-1',
  host: 'atlas',
  displayName: 'Test Commander',
} as const

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <BrowserRouter>
        <MobileAutomations
          commanders={[commander as never]}
          selectedCommanderId="cmd-1"
          onSelectCommanderId={vi.fn()}
        />
      </BrowserRouter>,
    )
  })
}

describe('MobileAutomations', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
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
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
  })

  it('reads canonical trigger and commander filters from the query string', async () => {
    await renderAt('/command-room/automations?surface=mobile&trigger=schedule&commander=global')
    await flushEffects()

    const panel = document.body.querySelector('[data-testid="mobile-automation-panel"]')
    expect(panel?.getAttribute('data-filter')).toBe('schedule')
    expect(panel?.getAttribute('data-scope')).toBe('global')

    const commanderButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('test commander'),
    )
    if (!(commanderButton instanceof HTMLButtonElement)) {
      throw new Error('expected commander filter button')
    }

    await act(async () => {
      commanderButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushEffects()

    const scopedPanel = document.body.querySelector('[data-testid="mobile-automation-panel"]')
    expect(scopedPanel?.getAttribute('data-scope')).toBe('commander')
    expect(scopedPanel?.getAttribute('data-commander')).toBe('cmd-1')
  })
})

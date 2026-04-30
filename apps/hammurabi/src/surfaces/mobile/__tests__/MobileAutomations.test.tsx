// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileAutomations } from '../MobileAutomations'

vi.mock('@modules/commanders/components/CommanderCronTab', () => ({
  CommanderCronTab: () => <div data-testid="mobile-automation-cron">CommanderCronTab</div>,
}))

vi.mock('@modules/sentinels/components/SentinelPanel', () => ({
  SentinelPanel: () => <div data-testid="mobile-automation-sentinels">SentinelPanel</div>,
}))

vi.mock('@modules/commanders/components/QuestBoard', () => ({
  QuestBoard: () => <div data-testid="mobile-automation-quests">QuestBoard</div>,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined

const commander = {
  id: 'cmd-1',
  host: 'athena',
  displayName: 'Test Commander',
} as const

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
          crons={[]}
          cronsLoading={false}
          cronsError={null}
          addCron={vi.fn(async () => undefined)}
          addCronPending={false}
          toggleCron={vi.fn(async () => undefined)}
          toggleCronPending={false}
          updateCron={vi.fn(async () => undefined)}
          updateCronPending={false}
          triggerCron={vi.fn(async () => undefined)}
          triggerCronPending={false}
          deleteCron={vi.fn(async () => undefined)}
          deleteCronPending={false}
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

  it('renders canonical panels as the segment changes', async () => {
    await renderAt('/command-room/automations?surface=mobile&segment=cron')

    expect(document.body.querySelector('[data-testid="mobile-automation-cron"]')).not.toBeNull()

    await act(async () => {
      document.body.querySelectorAll('button').item(1)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-automation-sentinels"]')).not.toBeNull()
    })

    await act(async () => {
      document.body.querySelectorAll('button').item(2)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-automation-quests"]')).not.toBeNull()
    })
  })
})

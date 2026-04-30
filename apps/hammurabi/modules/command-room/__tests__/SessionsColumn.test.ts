// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_COLOR } from '@/surfaces/hervald'
import { SessionsColumn } from '../../../src/surfaces/hervald/SessionsColumn'

describe('Hervald SessionsColumn', () => {
  beforeEach(() => {
    window.localStorage.removeItem('hervald-sessions-collapsed')
    window.localStorage.removeItem('hervald-sessions-font-scale')
    window.localStorage.removeItem('hervald-sessions-show-exited')
  })

  it('opens the commander and session launchers from their respective header buttons', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onCreateCommander = vi.fn()
    const onCreateSession = vi.fn()

    flushSync(() => {
      root.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'cmdr-1',
          onSelectCommander: vi.fn(),
          onCreateCommander,
          onCreateSession,
          selectedChatId: null,
          onSelectChat: vi.fn(),
          commanders: [],
          workers: [],
          approvals: [],
          workerSessions: [],
          cronSessions: [],
        }),
      )
    })

    const launchCommanderButton = container.querySelector('button[aria-label="New commander"]')
    if (!(launchCommanderButton instanceof HTMLButtonElement)) {
      throw new Error('expected new commander launcher button to render')
    }

    const launchButton = container.querySelector('button[aria-label="New session"]')
    if (!(launchButton instanceof HTMLButtonElement)) {
      throw new Error('expected new session launcher button to render')
    }

    flushSync(() => {
      launchCommanderButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onCreateCommander).toHaveBeenCalledTimes(1)
    expect(onCreateSession).toHaveBeenCalledTimes(1)

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('lets standalone chat rows select a chat session', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelectChat = vi.fn()

    flushSync(() => {
      root.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'cmdr-1',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateSession: vi.fn(),
          selectedChatId: null,
          onSelectChat,
          commanders: [
            {
              id: 'cmdr-1',
              name: 'Athena',
              status: 'running',
              description: 'Primary commander',
            },
          ],
          workers: [],
          approvals: [],
          workerSessions: [
            {
              id: 'session-42',
              name: 'session-42',
              age: '2h',
              status: 'idle',
            },
          ],
          cronSessions: [],
        }),
      )
    })

    const chatButton = Array.from(container.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('session-42')
    ))

    if (!chatButton) {
      throw new Error('expected standalone chat button to render')
    }

    flushSync(() => {
      chatButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectChat).toHaveBeenCalledWith('session-42')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders the Global pseudo-commander at the top of the list and lets users select it', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelectCommander = vi.fn()

    flushSync(() => {
      root.render(
        createElement(SessionsColumn, {
          selectedCommanderId: '__global__',
          onSelectCommander,
          onCreateCommander: vi.fn(),
          onCreateSession: vi.fn(),
          selectedChatId: null,
          onSelectChat: vi.fn(),
          commanders: [
            {
              id: '__global__',
              name: 'Global',
              status: 'idle',
              description: 'unattached automations',
              iconName: 'globe',
              isVirtual: true,
            },
            {
              id: 'cmdr-1',
              name: 'Athena',
              status: 'running',
            },
          ],
          workers: [],
          approvals: [],
          workerSessions: [],
          cronSessions: [],
          sentinelSessions: [],
        }),
      )
    })

    const globalIndex = container.textContent?.indexOf('Global') ?? -1
    const athenaIndex = container.textContent?.indexOf('Athena') ?? -1
    expect(globalIndex).toBeGreaterThanOrEqual(0)
    expect(athenaIndex).toBeGreaterThan(globalIndex)

    const globalButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Global'),
    )
    if (!globalButton) {
      throw new Error('expected Global row button to render')
    }

    flushSync(() => {
      globalButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectCommander).toHaveBeenCalledWith('__global__')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders separate Workers, Cron, and Sentinel section headers with cron/sentinel collapsed by default', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'cmdr-1',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateSession: vi.fn(),
          selectedChatId: null,
          onSelectChat: vi.fn(),
          commanders: [],
          workers: [],
          approvals: [],
          workerSessions: [
            {
              id: 'worker-1',
              name: 'swe-mbp',
              age: '1h',
            },
          ],
          cronSessions: [
            {
              id: 'cron-1',
              name: 'command-room-nightly',
              age: '2h',
            },
          ],
          sentinelSessions: [
            {
              id: 'sentinel-1',
              name: 'sentinel-bug-scrub',
              age: '30m',
            },
          ],
        }),
      )
    })

    expect(container.textContent).toContain('Workers')
    expect(container.textContent).toContain('Cron')
    expect(container.textContent).toContain('Sentinels')

    // Workers section is expanded by default.
    expect(container.textContent).toContain('swe-mbp')

    // Cron and sentinels are collapsed by default — session rows are hidden.
    expect(container.textContent).not.toContain('command-room-nightly')
    expect(container.textContent).not.toContain('sentinel-bug-scrub')

    // Expanding Cron reveals its rows.
    const cronHeader = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cron'),
    )
    if (!cronHeader) throw new Error('expected Cron section header')
    flushSync(() => {
      cronHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('command-room-nightly')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('hides exited sessions by default, persists per-section visibility, and keeps the row dot/ellipsis treatment', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root = createRoot(container)
    const longName = 'worker-yolo-1060-hervald-with-an-extremely-long-name'

    const renderColumn = () =>
      createElement(SessionsColumn, {
        selectedCommanderId: 'cmdr-1',
        onSelectCommander: vi.fn(),
        onCreateCommander: vi.fn(),
        onCreateSession: vi.fn(),
        selectedChatId: null,
        onSelectChat: vi.fn(),
        commanders: [],
        workers: [],
        approvals: [],
        workerSessions: [
          {
            id: 'worker-active',
            name: longName,
            age: '1h',
            status: 'active',
          },
          {
            id: 'worker-exited',
            name: 'worker-exited',
            age: '2h',
            status: 'exited',
          },
        ],
        cronSessions: [],
        sentinelSessions: [],
      })

    flushSync(() => {
      root.render(renderColumn())
    })

    const workersHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Workers'),
    )
    if (!workersHeader) throw new Error('expected Workers header')
    expect(workersHeader.textContent).toContain('· 1')
    expect(container.textContent).toContain(longName)
    expect(container.textContent).not.toContain('worker-exited')

    const activeRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(longName),
    )
    if (!activeRow) throw new Error('expected active worker row')

    const statusDot = activeRow.querySelector('span[aria-hidden="true"]')
    if (!(statusDot instanceof HTMLSpanElement)) {
      throw new Error('expected status dot')
    }
    expect(statusDot.style.width).toBe('6px')
    expect(statusDot.style.height).toBe('6px')
    expect(statusDot.style.borderRadius).toBe('50%')
    expect(STATE_COLOR.active).toBe('var(--moss-stone)')
    expect(STATE_COLOR.exited).toBe('var(--diluted-ink)')
    expect(STATE_COLOR.completed).toBe('var(--diluted-ink)')
    expect(STATE_COLOR.stale).toBe('var(--ink-mist)')
    expect(STATE_COLOR.failed).toBe('var(--vermillion-seal)')

    const truncatedName = activeRow.querySelector(`span[title="${longName}"]`)
    if (!(truncatedName instanceof HTMLSpanElement)) {
      throw new Error('expected truncated name span')
    }
    expect(truncatedName.style.overflow).toBe('hidden')
    expect(truncatedName.style.textOverflow).toBe('ellipsis')
    expect(truncatedName.style.whiteSpace).toBe('nowrap')

    const showExitedButton = container.querySelector(
      'button[aria-label="Show exited workers sessions"]',
    )
    if (!(showExitedButton instanceof HTMLButtonElement)) {
      throw new Error('expected show exited toggle')
    }

    flushSync(() => {
      showExitedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('worker-exited')
    expect(workersHeader.textContent).toContain('· 2')
    expect(JSON.parse(window.localStorage.getItem('hervald-sessions-show-exited') as string))
      .toMatchObject({ workers: true })

    flushSync(() => {
      root.unmount()
    })
    root = createRoot(container)

    flushSync(() => {
      root.render(renderColumn())
    })

    expect(container.textContent).toContain('worker-exited')
    expect(
      container.querySelector('button[aria-label="Hide exited workers sessions"]'),
    ).toBeTruthy()

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('persists collapse state and font scale to localStorage', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'cmdr-1',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateSession: vi.fn(),
          selectedChatId: null,
          onSelectChat: vi.fn(),
          commanders: [],
          workers: [],
          approvals: [],
          workerSessions: [{ id: 'w1', name: 'w1' }],
          cronSessions: [],
          sentinelSessions: [],
        }),
      )
    })

    const increase = container.querySelector('button[aria-label="Increase text size"]')
    if (!(increase instanceof HTMLButtonElement)) {
      throw new Error('expected A+ button')
    }
    flushSync(() => {
      increase.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const storedScale = Number(window.localStorage.getItem('hervald-sessions-font-scale'))
    expect(storedScale).toBeGreaterThan(1)

    const workersHeader = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Workers'),
    )
    if (!workersHeader) throw new Error('expected Workers header')
    flushSync(() => {
      workersHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const stored = window.localStorage.getItem('hervald-sessions-collapsed')
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored as string)).toMatchObject({ workers: true })

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

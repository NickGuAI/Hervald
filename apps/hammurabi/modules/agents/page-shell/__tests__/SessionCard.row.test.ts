// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@/types'
import { SessionCard } from '../SessionCard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let previousActEnvironment: boolean | undefined

function buildSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    name: 'worker-compact',
    created: '2026-04-20T12:00:00.000Z',
    pid: 4242,
    sessionType: 'stream',
    agentType: 'codex',
    host: 'home-mac',
    status: 'stale',
    resumeAvailable: true,
    processAlive: true,
    resumedFrom: 'worker-previous',
    ...overrides,
  }
}

afterEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  document.body.innerHTML = ''
})

describe('SessionCard row variant', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('keeps a single-line collapsed row and reveals lifecycle controls when expanded', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelect = vi.fn()
    const onKill = vi.fn()
    const onResume = vi.fn()

    await act(async () => {
      root.render(
        createElement(SessionCard, {
          session: buildSession(),
          selected: false,
          variant: 'row',
          onSelect,
          onKill,
          onResume,
          onNavigateToSession: vi.fn(),
        }),
      )
    })

    const collapsedButton = container.querySelector('button[aria-expanded="false"]')
    if (!(collapsedButton instanceof HTMLButtonElement)) {
      throw new Error('expected compact row button to render')
    }

    const rowContent = container.querySelector('[data-session-card-row-content]')
    if (!(rowContent instanceof HTMLDivElement)) {
      throw new Error('expected compact row content')
    }

    expect(rowContent.className).toContain('whitespace-nowrap')
    expect(collapsedButton.textContent).toContain('worker-compact')
    expect(collapsedButton.textContent).toContain('Codex')
    expect(collapsedButton.textContent).toContain('home-mac')
    expect(collapsedButton.textContent).toContain('stale')
    expect(container.textContent).not.toContain('Kill')
    expect(container.textContent).not.toContain('PID 4242')
    expect(container.querySelector('[role="region"]')).toBeNull()

    await act(async () => {
      collapsedButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    expect(onSelect).toHaveBeenCalledTimes(1)

    const expandedButton = container.querySelector('button[aria-expanded="true"]')
    if (!(expandedButton instanceof HTMLButtonElement)) {
      throw new Error('expected compact row to expand')
    }

    expect(container.textContent).toContain('Resume')
    expect(container.textContent).toContain('Kill')
    expect(container.textContent).toContain('PID 4242')
    expect(container.textContent).toContain('Resume-from-previous')

    const killButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Kill',
    )
    if (!(killButton instanceof HTMLButtonElement)) {
      throw new Error('expected kill button inside expanded controls')
    }

    killButton.focus()

    await act(async () => {
      killButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(container.textContent).not.toContain('Kill')
    expect(container.textContent).not.toContain('PID 4242')
    expect(container.querySelector('button[aria-expanded="false"]')).toBeTruthy()
    expect(document.activeElement).toBe(container.querySelector('button[aria-expanded="false"]'))

    await act(async () => {
      root.unmount()
    })
  })
})

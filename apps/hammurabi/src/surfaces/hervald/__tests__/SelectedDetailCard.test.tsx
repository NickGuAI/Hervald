// @vitest-environment jsdom

import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectedDetailCard } from '../SelectedDetailCard'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  flushSync(() => {
    root?.render(element)
  })
}

describe('SelectedDetailCard', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) {
      flushSync(() => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('shows Dismiss for exited workers and fires the cleanup callback', async () => {
    const onDismiss = vi.fn()

    await render(
      <SelectedDetailCard
        worker={{
          id: 'worker-exited',
          name: 'worker-exited',
          label: 'Research',
          kind: 'worker',
          state: 'exited',
          processAlive: false,
          resumeAvailable: true,
        }}
        onOpenWorkspace={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    const button = document.querySelector('[data-testid="dismiss-worker-button"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(document.body.textContent).toContain('Dismiss removes this exited worker from the team list')
    expect(document.body.textContent).toContain('resume handle')

    flushSync(() => {
      button?.click()
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

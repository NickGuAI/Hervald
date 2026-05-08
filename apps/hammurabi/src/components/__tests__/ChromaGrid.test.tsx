// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gsapMocks = vi.hoisted(() => ({
  quickSetter: vi.fn(() => vi.fn()),
  to: vi.fn(),
}))

vi.mock('gsap', () => ({
  gsap: gsapMocks,
}))

import { ChromaGrid } from '../ChromaGrid'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

describe('ChromaGrid', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    gsapMocks.quickSetter.mockClear()
    gsapMocks.to.mockClear()
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('passes through item button props and fires the in-app click handler', async () => {
    const onClick = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ChromaGrid
          items={[
            {
              id: 'cmd-1',
              image: 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',
              title: 'Atlas',
              subtitle: 'Engineering',
              onClick,
              cardClassName: 'opacity-60',
              cardProps: {
                'aria-pressed': true,
                'data-testid': 'commander-tile',
                'data-commander-card': 'cmd-1',
              },
            },
          ]}
          className="justify-start"
        />,
      )
    })

    const tile = document.body.querySelector<HTMLButtonElement>('[data-testid="commander-tile"]')
    expect(tile).not.toBeNull()
    expect(tile?.getAttribute('data-commander-card')).toBe('cmd-1')
    expect(tile?.getAttribute('aria-pressed')).toBe('true')
    expect(tile?.className).toContain('opacity-60')
    expect(tile?.className).not.toContain('bg-washi-white')
    expect(tile?.className).not.toContain('card-sumi')

    await act(async () => {
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not apply section-wide backdrop filters to the spotlight overlays', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ChromaGrid
          items={[
            {
              id: 'cmd-1',
              image: 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',
              title: 'Atlas',
              subtitle: 'Engineering',
            },
            {
              id: 'cmd-2',
              image: 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',
              title: 'Borealis',
              subtitle: 'Research',
            },
          ]}
        />,
      )
    })

    const overlays = Array.from(document.body.querySelectorAll<HTMLDivElement>('div'))
      .filter((node) => node.getAttribute('style')?.includes('mask-image'))

    expect(overlays.length).toBeGreaterThan(0)
    overlays.forEach((overlay) => {
      expect(overlay.style.backdropFilter ?? '').toBe('')
      expect(overlay.style.getPropertyValue('-webkit-backdrop-filter')).toBe('')
    })
  })
})

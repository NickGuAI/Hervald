// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MagicBento, MagicBentoCard } from '../MagicBento'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(element)
    await Promise.resolve()
  })
}

describe('MagicBento', () => {
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
  })

  it('renders child-driven bento cards with declared spans', async () => {
    await render(
      <MagicBento data-testid="bento">
        <MagicBentoCard span={6} data-testid="card-a">A</MagicBentoCard>
        <MagicBentoCard span={3} data-testid="card-b">B</MagicBentoCard>
      </MagicBento>,
    )

    const bento = await vi.waitFor(() => {
      const element = document.querySelector('[data-testid="bento"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })

    expect(bento.classList.contains('hv-magic-bento')).toBe(true)
    expect(document.querySelector('[data-testid="card-a"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="card-b"]')?.getAttribute('data-bento-span')).toBe('3')
  })
})

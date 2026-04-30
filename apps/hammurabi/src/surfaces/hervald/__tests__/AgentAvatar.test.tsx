// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentAvatar } from '@/surfaces/hervald/primitives'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(element)
  })
}

describe('AgentAvatar — live commander shape', () => {
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

  it('renders the uploaded avatar image when avatarUrl is provided', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'athena-id',
          displayName: 'Test Commander',
          host: 'athena',
          avatarUrl: '/commander-assets/athena-id/avatar',
          ui: { accentColor: '#C23B22' },
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]')
    expect(avatar).not.toBeNull()

    const img = avatar?.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('/commander-assets/athena-id/avatar')
    expect(img?.getAttribute('alt')).toBe('Test Commander')
  })

  it('renders the initial letter when avatarUrl is absent, colored by ui.accentColor', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'zendude-id',
          displayName: 'Demo User',
          host: 'zendude',
          avatarUrl: null,
          ui: { accentColor: '#D4763A' },
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.querySelector('img')).toBeNull()
    expect(avatar?.textContent).toBe('Z')
    // Accent color flows through to the letter color + border.
    expect(avatar?.style.color.toLowerCase()).toContain('212') // rgb(212, 118, 58) from #D4763A
  })

  it('falls back to a deterministic accent when ui.accentColor is missing', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'some-stable-id',
          displayName: 'Stable',
          host: 'stable',
          avatarUrl: null,
          ui: null,
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    expect(avatar?.textContent).toBe('S')
    // Some non-empty color is applied (deterministic palette entry).
    expect(avatar?.style.color).not.toBe('')
  })

  it('derives the initial from host when displayName is empty', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'host-only',
          displayName: '',
          host: 'jarvis',
          avatarUrl: null,
          ui: null,
        }}
        size={32}
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]')
    expect(avatar?.textContent).toBe('J')
  })

  it('raises border weight when active is true', async () => {
    await render(
      <AgentAvatar
        commander={{
          id: 'active-cmd',
          displayName: 'Active',
          host: 'active',
          avatarUrl: null,
          ui: { accentColor: '#6B7B5E' },
        }}
        size={32}
        active
      />,
    )

    const avatar = document.querySelector('[data-testid="agent-avatar"]') as HTMLElement | null
    expect(avatar).not.toBeNull()
    // Active border is `1.5px solid {accent}`; inactive is a faded
    // `{accent}33` 1px. We just assert the width pumped up.
    expect(avatar?.style.border.startsWith('1.5px')).toBe(true)
  })
})

// @vitest-environment jsdom

import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillsPicker } from '../SkillsPicker'

vi.mock('@/hooks/use-skills', () => ({
  useSkills: () => ({
    data: [
      {
        name: 'deploy',
        description: 'Ship the current branch',
        userInvocable: true,
        argumentHint: '--prod',
      },
    ],
    isLoading: false,
  }),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderPicker() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      <SkillsPicker
        visible
        onSelectSkill={vi.fn()}
        onClose={vi.fn()}
        variant="hervald"
      />,
    )
  })
}

function findSkillButton(name: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(`/${name}`),
  )

  expect(button, `Expected skill button /${name}`).not.toBeNull()
  return button as HTMLButtonElement
}

afterEach(() => {
  if (root) {
    flushSync(() => {
      root?.unmount()
    })
  }

  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('SkillsPicker', () => {
  it('renders skill rows with touch-safe highlight and hover classes', () => {
    renderPicker()

    const button = findSkillButton('deploy')

    expect(button.className).toContain('[-webkit-tap-highlight-color:transparent]')
    expect(button.className).toContain('[@media(hover:hover)]:hover:bg-ink-wash')
    expect(button.className).toContain('sheet-skill--hervald')
    expect(button.className).not.toContain(' hover:bg-ink-wash ')
  })
})

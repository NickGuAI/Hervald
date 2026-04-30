// @vitest-environment jsdom

import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddToChatSheet } from '../AddToChatSheet'

let root: Root | null = null
let container: HTMLDivElement | null = null

function SheetHarness({
  onPickImage,
  onPickSkill,
  onPickFile,
}: {
  onPickImage: () => void
  onPickSkill: () => void
  onPickFile: () => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <AddToChatSheet
      open={open}
      onClose={() => setOpen(false)}
      onPickImage={onPickImage}
      onPickSkill={onPickSkill}
      onPickFile={onPickFile}
    />
  )
}

function renderSheetHarness(props: {
  onPickImage: () => void
  onPickSkill: () => void
  onPickFile: () => void
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(<SheetHarness {...props} />)
  })
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector(`button[aria-label="${label}"]`)
  expect(button, `Expected button with aria-label ${label}`).not.toBeNull()
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

describe('AddToChatSheet', () => {
  it.each([
    ['Photos', 'Add photos', 'onPickImage'],
    ['Skills', 'Add skills', 'onPickSkill'],
    ['Files', 'Add files', 'onPickFile'],
  ] as const)('invokes %s and closes the sheet', async (_title, ariaLabel, key) => {
    const handlers = {
      onPickImage: vi.fn(),
      onPickSkill: vi.fn(),
      onPickFile: vi.fn(),
    }

    renderSheetHarness(handlers)
    expect(document.body.querySelector('[data-testid="add-to-chat-sheet"]')).not.toBeNull()

    flushSync(() => {
      findButtonByLabel(ariaLabel).click()
    })

    expect(handlers[key]).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[data-testid="add-to-chat-sheet"]')).toBeNull()
  })
})

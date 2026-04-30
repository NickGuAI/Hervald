// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@modules/workspace/components/WorkspacePanel', () => ({
  WorkspacePanel: ({
    onInsertPath,
  }: {
    onInsertPath?: (path: string) => void
  }) => (
    <button
      type="button"
      data-testid="insert-path"
      onClick={() => onInsertPath?.('docs/spec.md')}
    >
      Insert Path
    </button>
  ),
}))

import { WorkspaceModal } from '../WorkspaceModal'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderModal(onInsertPath: (path: string) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <WorkspaceModal
        open
        onClose={vi.fn()}
        source={{ kind: 'commander', commanderId: 'cmd-1', readOnly: false }}
        onInsertPath={onInsertPath}
      />,
    )
  })
}

describe('WorkspaceModal context wiring', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('forwards Insert Path selections to the caller', async () => {
    const onInsertPath = vi.fn()

    await renderModal(onInsertPath)

    await act(async () => {
      ;(document.body.querySelector('[data-testid="insert-path"]') as HTMLButtonElement).click()
    })

    expect(onInsertPath).toHaveBeenCalledWith('docs/spec.md')
  })
})

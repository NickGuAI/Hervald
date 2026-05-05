// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSource } from '../../../workspace/use-workspace'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceTree: vi.fn(),
  fetchWorkspaceExpandedTree: vi.fn(),
  useWorkspaceFilePreview: vi.fn(),
  useWorkspaceGitStatus: vi.fn(),
  useWorkspaceGitLog: vi.fn(),
}))

vi.mock('../../../workspace/use-workspace', () => ({
  fetchWorkspaceTree: mocks.fetchWorkspaceTree,
  fetchWorkspaceExpandedTree: mocks.fetchWorkspaceExpandedTree,
  getWorkspaceSourceKey: (source: WorkspaceSource) =>
    source.kind === 'agent-session'
      ? `agent:${source.sessionName}`
      : `commander:${source.commanderId}`,
  useWorkspaceFilePreview: mocks.useWorkspaceFilePreview,
  useWorkspaceGitStatus: mocks.useWorkspaceGitStatus,
  useWorkspaceGitLog: mocks.useWorkspaceGitLog,
}))

vi.mock('../../../workspace/components/WorkspaceTree', () => ({
  WorkspaceTree: ({
    selectedPath,
    onSelectPath,
    onToggleDirectory,
    onAddPath,
  }: {
    selectedPath: string | null
    onSelectPath: (path: string) => void
    onToggleDirectory: (path: string) => void
    onAddPath?: (path: string) => void
  }) => createElement(
    'div',
    undefined,
    createElement('div', undefined, `Tree selection: ${selectedPath ?? 'none'}`),
    createElement(
      'button',
      { type: 'button', onClick: () => onSelectPath('src/index.ts') },
      'Preview src/index.ts',
    ),
    createElement(
      'button',
      { type: 'button', onClick: () => onToggleDirectory('src') },
      'Toggle src',
    ),
    createElement(
      'button',
      { type: 'button', onClick: () => onAddPath?.('src/index.ts') },
      'Add src/index.ts',
    ),
  ),
}))

vi.mock('../../../workspace/components/WorkspaceFilePreview', () => ({
  WorkspaceFilePreview: ({ selectedPath }: { selectedPath: string }) =>
    createElement('div', undefined, `Previewing ${selectedPath}`),
}))

import { WorkspaceOverlay } from '../WorkspaceOverlay'

const SOURCE: WorkspaceSource = {
  kind: 'agent-session',
  sessionName: 'alpha-session',
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let previousActEnvironment: boolean | undefined

function createWorkspaceTreeResponse(parentPath: string, nodes: Array<{ name: string; path: string; type: 'file' | 'directory' }>) {
  return {
    workspace: {
      source: {
        kind: 'agent-session' as const,
        id: 'alpha-session',
        label: 'alpha-session',
      },
      rootPath: '/tmp/alpha-session',
      rootName: 'alpha-session',
      gitRoot: '/tmp/alpha-session',
      readOnly: false,
      isRemote: false,
    },
    parentPath,
    nodes,
  }
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderOverlay(
  root: ReturnType<typeof createRoot>,
  onClose: ReturnType<typeof vi.fn>,
) {
  await act(async () => {
    root.render(
      createElement(WorkspaceOverlay, {
        open: true,
        onClose,
        onSelectFile: () => undefined,
        source: SOURCE,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function dispatchEventAndFlush(
  target: EventTarget,
  event: Event,
) {
  await act(async () => {
    target.dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function waitForCondition(
  check: () => boolean,
  message: string,
  attempts = 10,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) {
      return
    }
    await flushAsync()
  }

  throw new Error(message)
}

describe('WorkspaceOverlay', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchWorkspaceTree.mockResolvedValue(
      createWorkspaceTreeResponse('', [
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
      ]),
    )
    mocks.fetchWorkspaceExpandedTree.mockResolvedValue(
      createWorkspaceTreeResponse('src', [
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
      ]),
    )
    mocks.useWorkspaceFilePreview.mockImplementation((_source, selectedPath) => ({
      data: selectedPath
        ? {
            workspace: createWorkspaceTreeResponse('', []).workspace,
            path: selectedPath,
            name: selectedPath.split('/').at(-1) ?? selectedPath,
            kind: 'text' as const,
            size: 12,
            content: `preview:${selectedPath}`,
            writable: false,
          }
        : null,
      isLoading: false,
      isFetching: false,
      error: null,
    }))
    mocks.useWorkspaceGitStatus.mockReturnValue({
      data: {
        workspace: createWorkspaceTreeResponse('', []).workspace,
        enabled: true,
        branch: 'main',
        ahead: 1,
        behind: 0,
        entries: [{ path: 'src/index.ts', code: 'M ' }],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useWorkspaceGitLog.mockReturnValue({
      data: {
        workspace: createWorkspaceTreeResponse('', []).workspace,
        enabled: true,
        commits: [
          {
            hash: 'abc123',
            shortHash: 'abc123',
            author: 'Nick',
            authoredAt: '2026-04-15T00:00:00Z',
            subject: 'Extract workspace overlay tabs',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    })
  })

  afterEach(() => {
    mocks.fetchWorkspaceTree.mockReset()
    mocks.fetchWorkspaceExpandedTree.mockReset()
    mocks.useWorkspaceFilePreview.mockReset()
    mocks.useWorkspaceGitStatus.mockReset()
    mocks.useWorkspaceGitLog.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    document.body.innerHTML = ''
  })

  it('switches tabs and closes when the backdrop is clicked', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClose = vi.fn()

    await renderOverlay(root, onClose)

    await waitForCondition(
      () => document.body.textContent?.includes('Tree selection: none') ?? false,
      'expected workspace tree to load',
    )
    expect(document.body.textContent).toContain('Tree selection: none')

    const changesButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Changes'),
    )
    if (!changesButton) {
      throw new Error('expected changes tab button')
    }

    await dispatchEventAndFlush(changesButton, new MouseEvent('click', { bubbles: true }))
    expect(document.body.textContent).toContain('main')
    expect(document.body.textContent).toContain('src/index.ts')

    const logButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Git Log'),
    )
    if (!logButton) {
      throw new Error('expected git log tab button')
    }

    await dispatchEventAndFlush(logButton, new MouseEvent('click', { bubbles: true }))
    expect(document.body.textContent).toContain('Extract workspace overlay tabs')

    const backdrop = Array.from(document.body.querySelectorAll('div')).find((element) =>
      typeof element.className === 'string' && element.className.includes('z-[9998]'),
    )
    if (!backdrop) {
      throw new Error('expected workspace backdrop')
    }

    await dispatchEventAndFlush(backdrop, new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('closes preview before closing the overlay for outside clicks and escape', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClose = vi.fn()

    await renderOverlay(root, onClose)

    await waitForCondition(
      () =>
        Array.from(document.body.querySelectorAll('button')).some((button) =>
          button.textContent?.includes('Preview src/index.ts'),
        ),
      'expected preview button',
    )
    const previewButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Preview src/index.ts'),
    )
    if (!previewButton) {
      throw new Error('expected preview button')
    }

    await dispatchEventAndFlush(previewButton, new MouseEvent('click', { bubbles: true }))
    await waitForCondition(
      () => document.body.textContent?.includes('Previewing src/index.ts') ?? false,
      'expected preview content',
    )
    expect(document.body.textContent).toContain('Previewing src/index.ts')

    await dispatchEventAndFlush(document.body, new MouseEvent('mousedown', { bubbles: true }))
    expect(document.body.textContent).not.toContain('Previewing src/index.ts')
    expect(onClose).not.toHaveBeenCalled()

    await dispatchEventAndFlush(previewButton, new MouseEvent('click', { bubbles: true }))
    expect(document.body.textContent).toContain('Previewing src/index.ts')

    await dispatchEventAndFlush(
      document,
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(document.body.textContent).not.toContain('Previewing src/index.ts')
    expect(onClose).not.toHaveBeenCalled()

    await dispatchEventAndFlush(
      document,
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})

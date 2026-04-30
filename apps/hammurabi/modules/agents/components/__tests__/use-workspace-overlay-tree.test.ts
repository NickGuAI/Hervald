// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSource } from '../../../workspace/use-workspace'
import { useWorkspaceOverlayTree } from '../workspace-overlay/use-workspace-overlay-tree'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceTree: vi.fn(),
  fetchWorkspaceExpandedTree: vi.fn(),
  useWorkspaceFilePreview: vi.fn(),
}))

vi.mock('../../../workspace/use-workspace', () => ({
  fetchWorkspaceTree: mocks.fetchWorkspaceTree,
  fetchWorkspaceExpandedTree: mocks.fetchWorkspaceExpandedTree,
  getWorkspaceSourceKey: (source: WorkspaceSource) =>
    source.kind === 'agent-session'
      ? `agent:${source.sessionName}`
      : `commander:${source.commanderId}`,
  useWorkspaceFilePreview: mocks.useWorkspaceFilePreview,
}))

type HarnessProps = {
  open: boolean
  source: WorkspaceSource
  query: string
  filesTabActive: boolean
  onSelectFile: ReturnType<typeof vi.fn>
}

type HookState = ReturnType<typeof useWorkspaceOverlayTree>

type Harness = {
  cleanup: () => Promise<void>
  getState: () => HookState
  onSelectFile: ReturnType<typeof vi.fn>
  rerender: (nextProps: Partial<HarnessProps>) => Promise<void>
}

const AGENT_SOURCE: WorkspaceSource = {
  kind: 'agent-session',
  sessionName: 'alpha-session',
}

const COMMANDER_SOURCE: WorkspaceSource = {
  kind: 'commander',
  commanderId: 'cmd-7',
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let previousActEnvironment: boolean | undefined

function createWorkspaceTreeResponse(
  parentPath: string,
  nodes: Array<{ name: string; path: string; type: 'file' | 'directory' }>,
) {
  return {
    workspace: {
      source: {
        kind: 'agent-session' as const,
        id: 'alpha-session',
        label: 'alpha-session',
      },
      rootPath: '/tmp/workspace',
      rootName: 'workspace',
      gitRoot: '/tmp/workspace',
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

async function runInAct<T>(callback: () => T | Promise<T>): Promise<T> {
  let result!: T

  await act(async () => {
    result = await callback()
    await Promise.resolve()
    await Promise.resolve()
  })

  return result
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

async function createHarness(overrides: Partial<HarnessProps> = {}): Promise<Harness> {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root: Root = createRoot(container)
  let latestState: HookState | null = null
  const onSelectFile = vi.fn()
  let props: HarnessProps = {
    open: true,
    source: AGENT_SOURCE,
    query: '',
    filesTabActive: true,
    onSelectFile,
    ...overrides,
  }

  function HarnessComponent(currentProps: HarnessProps) {
    latestState = useWorkspaceOverlayTree(currentProps)
    return createElement('div')
  }

  await runInAct(() => {
    root.render(createElement(HarnessComponent, props))
  })

  return {
    async cleanup() {
      await runInAct(() => {
        root.unmount()
      })
      container.remove()
    },
    getState() {
      if (!latestState) {
        throw new Error('expected hook state')
      }
      return latestState
    },
    onSelectFile,
    async rerender(nextProps) {
      props = { ...props, ...nextProps }
      await runInAct(() => {
        root.render(createElement(HarnessComponent, props))
      })
    },
  }
}

describe('useWorkspaceOverlayTree', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchWorkspaceTree.mockImplementation(async (source: WorkspaceSource, parentPath = '') => {
      if (source.kind === 'commander') {
        return createWorkspaceTreeResponse(parentPath, [
          { name: 'notes', path: 'notes', type: 'directory' },
        ])
      }

      return createWorkspaceTreeResponse(parentPath, [
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ])
    })
    mocks.fetchWorkspaceExpandedTree.mockImplementation(async (_source: WorkspaceSource, parentPath: string) =>
      createWorkspaceTreeResponse(parentPath, [
        { name: 'app.ts', path: 'src/app.ts', type: 'file' },
      ]),
    )
    mocks.useWorkspaceFilePreview.mockImplementation((_source: WorkspaceSource, path: string | null, enabled = true) => ({
      data: enabled && path
        ? {
            workspace: createWorkspaceTreeResponse('', []).workspace,
            path,
            name: path.split('/').at(-1) ?? path,
            kind: 'text' as const,
            size: 10,
            content: `preview:${path}`,
            writable: false,
          }
        : null,
      isLoading: false,
      isFetching: false,
      error: null,
    }))
  })

  afterEach(() => {
    mocks.fetchWorkspaceTree.mockReset()
    mocks.fetchWorkspaceExpandedTree.mockReset()
    mocks.useWorkspaceFilePreview.mockReset()
    vi.useRealTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    document.body.innerHTML = ''
  })

  it('loads the root tree, expands directories, filters nodes, previews files, and clears add feedback', async () => {
    vi.useFakeTimers()
    const harness = await createHarness()

    expect(mocks.fetchWorkspaceTree).toHaveBeenCalledWith(AGENT_SOURCE, '')
    await waitForCondition(
      () => Boolean(harness.getState().filteredNodesByParent['']?.length),
      'expected root tree nodes',
    )
    expect(harness.getState().filteredNodesByParent['']?.map((node) => node.name)).toEqual([
      'src',
      'README.md',
    ])

    await runInAct(() => harness.getState().handleToggleDirectory('src'))

    expect(mocks.fetchWorkspaceExpandedTree).toHaveBeenCalledWith(AGENT_SOURCE, 'src')
    expect(harness.getState().expandedPaths.has('src')).toBe(true)
    await waitForCondition(
      () => Boolean(harness.getState().filteredNodesByParent.src?.length),
      'expected expanded directory nodes',
    )
    expect(harness.getState().filteredNodesByParent.src?.map((node) => node.name)).toEqual(['app.ts'])

    await harness.rerender({ query: 'app' })
    expect(harness.getState().filteredNodesByParent['']?.map((node) => node.name)).toEqual(['src'])
    expect(harness.getState().filteredNodesByParent.src?.map((node) => node.name)).toEqual(['app.ts'])

    await runInAct(() => {
      harness.getState().handlePreviewPath('src/app.ts')
    })
    expect(harness.getState().selectedPreviewPath).toBe('src/app.ts')

    await runInAct(() => {
      harness.getState().handleAddPath('src/app.ts', 'file')
    })
    expect(harness.onSelectFile).toHaveBeenCalledWith('src/app.ts')
    expect(harness.getState().addedPaths.has('src/app.ts')).toBe(true)

    await runInAct(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(harness.getState().addedPaths.has('src/app.ts')).toBe(false)

    await harness.cleanup()
  })

  it('resets selection and tree state when the overlay closes or the source changes', async () => {
    const harness = await createHarness()

    await runInAct(() => harness.getState().handleToggleDirectory('src'))
    await runInAct(() => {
      harness.getState().handlePreviewPath('src/app.ts')
      harness.getState().handleAddPath('src/app.ts', 'file')
    })

    expect(harness.getState().selectedPath).toBe('src/app.ts')
    expect(harness.getState().addedPaths.has('src/app.ts')).toBe(true)
    expect(harness.getState().expandedPaths.has('src')).toBe(true)

    await harness.rerender({ open: false })
    await waitForCondition(
      () => harness.getState().selectedPath === null,
      'expected closed overlay to clear selected path',
    )
    expect(harness.getState().selectedPath).toBeNull()
    expect(harness.getState().addedPaths.size).toBe(0)

    await harness.rerender({ open: true, source: COMMANDER_SOURCE })
    await waitForCondition(
      () => Boolean(harness.getState().filteredNodesByParent['']?.length),
      'expected commander tree nodes',
    )
    expect(harness.getState().selectedPath).toBeNull()
    expect(harness.getState().expandedPaths.size).toBe(0)
    expect(harness.getState().filteredNodesByParent['']?.map((node) => node.name)).toEqual(['notes'])

    await harness.cleanup()
  })
})

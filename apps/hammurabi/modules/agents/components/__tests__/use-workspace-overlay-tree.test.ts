// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSource, WorkspaceSourceRecovery } from '../../../workspace/use-workspace'
import { useWorkspaceOverlayTree } from '../workspace-overlay/use-workspace-overlay-tree'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceTree: vi.fn(),
  fetchWorkspaceExpandedTree: vi.fn(),
  fetchWorkspacePathResolution: vi.fn(),
  useWorkspaceFilePreview: vi.fn(),
}))

vi.mock('../../../workspace/use-workspace', () => ({
  fetchWorkspaceTree: mocks.fetchWorkspaceTree,
  fetchWorkspaceExpandedTree: mocks.fetchWorkspaceExpandedTree,
  fetchWorkspacePathResolution: mocks.fetchWorkspacePathResolution,
  getWorkspaceSourceKey: (source: WorkspaceSource) => `target:${source.targetId}`,
  isWorkspaceTargetNotFoundError: (error: unknown) =>
    error instanceof Error && error.message.includes('Workspace target not found'),
  useWorkspaceFilePreview: mocks.useWorkspaceFilePreview,
}))

type HarnessProps = {
  open: boolean
  source: WorkspaceSource
  query: string
  filesTabActive: boolean
  onSelectFile: ReturnType<typeof vi.fn>
  requestedPath?: string | null
  requestedPathToken?: number
  onRequestedPathConsumed?: (token: number) => void
  onRecoverStaleTarget?: WorkspaceSourceRecovery
}

type HookState = ReturnType<typeof useWorkspaceOverlayTree>

type Harness = {
  cleanup: () => Promise<void>
  getState: () => HookState
  onSelectFile: ReturnType<typeof vi.fn>
  rerender: (nextProps: Partial<HarnessProps>) => Promise<void>
}

const AGENT_SOURCE: WorkspaceSource = {
  kind: 'target',
  targetId: 'wt-alpha-session',
}

const COMMANDER_SOURCE: WorkspaceSource = {
  kind: 'target',
  targetId: 'wt-cmd-7',
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
        kind: 'target' as const,
        id: 'wt-alpha-session',
        label: 'alpha-session',
      },
      rootPath: '/tmp/workspace',
      rootName: 'workspace',
      gitRoot: '/tmp/workspace',
      readOnly: false,
      isRemote: false,
    },
    parentPath,
    nodes: nodes.map((node) => ({ ...node, parentPath })),
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
      if (source.targetId === 'wt-cmd-7') {
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
    mocks.fetchWorkspacePathResolution.mockImplementation(async (_source: WorkspaceSource, requestedPath: string) => ({
      workspace: createWorkspaceTreeResponse('', []).workspace,
      requestedPath,
      path: requestedPath,
      type: requestedPath === 'src' ? 'directory' : 'file',
      treePath: requestedPath === 'src' ? 'src' : requestedPath.split('/').slice(0, -1).join('/'),
    }))
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
    mocks.fetchWorkspacePathResolution.mockReset()
    mocks.useWorkspaceFilePreview.mockReset()
    vi.useRealTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    document.body.innerHTML = ''
  })

  it('loads the root tree, expands directories, filters nodes, previews files, and clears add feedback', async () => {
    vi.useFakeTimers()
    const harness = await createHarness()

    await waitForCondition(
      () => mocks.fetchWorkspaceTree.mock.calls.length > 0,
      'expected root tree request',
    )
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

    await waitForCondition(
      () => harness.getState().expandedPaths.has('src'),
      'expected src directory to expand',
    )
    expect(mocks.fetchWorkspaceExpandedTree).toHaveBeenCalledWith(AGENT_SOURCE, 'src')
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
    expect(harness.onSelectFile).toHaveBeenCalledWith('src/app.ts', 'file')
    expect(harness.getState().addedPaths.has('src/app.ts')).toBe(true)

    await runInAct(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(harness.getState().addedPaths.has('src/app.ts')).toBe(false)

    await harness.cleanup()
  })

  it('resets selection and tree state when the overlay closes or the source changes', async () => {
    const harness = await createHarness()
    await waitForCondition(
      () => Boolean(harness.getState().filteredNodesByParent['']?.length),
      'expected root tree nodes before toggling',
    )

    await runInAct(() => harness.getState().handleToggleDirectory('src'))
    await waitForCondition(
      () => harness.getState().expandedPaths.has('src'),
      'expected src directory to expand',
    )
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
      () => harness.getState().filteredNodesByParent['']?.some((node) => node.name === 'notes') === true,
      'expected commander tree nodes',
    )
    expect(harness.getState().selectedPath).toBeNull()
    expect(harness.getState().expandedPaths.size).toBe(0)
    expect(harness.getState().filteredNodesByParent['']?.map((node) => node.name)).toEqual(['notes'])

    await harness.cleanup()
  })

  it('resolves requested absolute SVG paths to the rendered SVG before expanding parent directories', async () => {
    mocks.fetchWorkspaceExpandedTree.mockImplementation(async (_source: WorkspaceSource, parentPath: string) =>
      createWorkspaceTreeResponse(parentPath, [
        {
          name: 'ui-to-backend-logic-flow.svg',
          path: 'apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg',
          type: 'file',
        },
      ]),
    )
    mocks.fetchWorkspacePathResolution.mockImplementation(async (_source: WorkspaceSource, requestedPath: string) => ({
      workspace: createWorkspaceTreeResponse('', []).workspace,
      requestedPath,
      path: 'apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg',
      type: 'file',
      treePath: 'apps/hammurabi/docs/diagrams',
    }))

    const harness = await createHarness({
      requestedPath: '/home/builder/App/apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg',
      requestedPathToken: 1,
    })

    await waitForCondition(
      () => harness.getState().selectedPath === 'apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg',
      'expected requested absolute path to resolve to workspace-relative rendered SVG',
    )
    expect(mocks.fetchWorkspaceExpandedTree).toHaveBeenCalledWith(
      AGENT_SOURCE,
      'apps/hammurabi/docs/diagrams',
    )
    expect(mocks.fetchWorkspaceExpandedTree).not.toHaveBeenCalledWith(
      AGENT_SOURCE,
      'home/builder/App/apps/hammurabi/docs/diagrams',
    )

    await harness.cleanup()
  })

  it('consumes requested paths once instead of replaying them when the mobile workspace source changes', async () => {
    const onRequestedPathConsumed = vi.fn()
    const harness = await createHarness({
      requestedPath: 'README.md',
      requestedPathToken: 1,
      onRequestedPathConsumed,
    })

    await waitForCondition(
      () => mocks.fetchWorkspacePathResolution.mock.calls.some(([source]) => (
        (source as WorkspaceSource).targetId === AGENT_SOURCE.targetId
      )),
      'expected requested path to resolve against the first source',
    )
    await waitForCondition(
      () => onRequestedPathConsumed.mock.calls.some(([token]) => token === 1),
      'expected requested path to be consumed',
    )

    await harness.rerender({ source: COMMANDER_SOURCE })

    expect(mocks.fetchWorkspacePathResolution.mock.calls.some(([source]) => (
      (source as WorkspaceSource).targetId === COMMANDER_SOURCE.targetId
    ))).toBe(false)

    await harness.rerender({ requestedPathToken: 2 })

    await waitForCondition(
      () => mocks.fetchWorkspacePathResolution.mock.calls.some(([source]) => (
        (source as WorkspaceSource).targetId === COMMANDER_SOURCE.targetId
      )),
      'expected a new requested-path token to resolve against the new source',
    )
    expect(onRequestedPathConsumed).toHaveBeenCalledWith(2)

    await harness.cleanup()
  })
})

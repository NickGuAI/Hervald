// @vitest-environment jsdom

import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSource } from '../../use-workspace'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceTree: vi.fn(),
  fetchWorkspaceExpandedTree: vi.fn(),
}))

vi.mock('../../use-workspace', () => ({
  fetchWorkspaceTree: mocks.fetchWorkspaceTree,
  fetchWorkspaceExpandedTree: mocks.fetchWorkspaceExpandedTree,
  getWorkspaceSourceKey: (source: WorkspaceSource) =>
    source.kind === 'commander'
      ? `commander:${source.commanderId}`
      : `agent:${source.sessionName}`,
  useWorkspaceActions: () => ({
    createFile: vi.fn(async () => undefined),
    createFolder: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => undefined),
    renamePath: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    uploadFiles: vi.fn(async () => undefined),
    initGit: vi.fn(async () => undefined),
  }),
  useWorkspaceFilePreview: () => ({
    data: null,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
  useWorkspaceGitStatus: () => ({
    data: null,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
  useWorkspaceGitLog: () => ({
    data: null,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
}))

vi.mock('../WorkspaceToolbar', () => ({
  WorkspaceToolbar: () => null,
}))

vi.mock('../WorkspaceFilePreview', () => ({
  WorkspaceFilePreview: () => null,
}))

vi.mock('../WorkspaceGitPanel', () => ({
  WorkspaceGitPanel: () => null,
}))

import { WorkspacePanel } from '../WorkspacePanel'

const SOURCE: WorkspaceSource = {
  kind: 'commander',
  commanderId: 'cmd-1',
  readOnly: false,
}

function createWorkspaceTreeResponse(
  parentPath: string,
  nodes: Array<{ name: string; path: string; type: 'file' | 'directory' }>,
) {
  return {
    workspace: {
      source: {
        kind: 'commander' as const,
        id: 'cmd-1',
        label: 'Test Commander',
      },
      rootPath: '/tmp/cmd-1',
      rootName: 'cmd-1',
      gitRoot: '/tmp/cmd-1',
      readOnly: false,
      isRemote: false,
    },
    parentPath,
    nodes,
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderPanel(onInsertPath: (path: string) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <WorkspacePanel
        source={SOURCE}
        position="embedded"
        variant="dark"
        onInsertPath={onInsertPath}
      />,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('WorkspacePanel add-to-context actions', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.fetchWorkspaceTree.mockResolvedValue(
      createWorkspaceTreeResponse('', [
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ]),
    )
    mocks.fetchWorkspaceExpandedTree.mockResolvedValue(
      createWorkspaceTreeResponse('src', [
        { name: 'app.ts', path: 'src/app.ts', type: 'file' },
      ]),
    )
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
    mocks.fetchWorkspaceTree.mockReset()
    mocks.fetchWorkspaceExpandedTree.mockReset()
    vi.clearAllMocks()
  })

  it('adds file and directory tree nodes using the same path semantics as mobile', async () => {
    const onInsertPath = vi.fn()

    await renderPanel(onInsertPath)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Add src to context"]')).not.toBeNull()
      expect(document.body.querySelector('[aria-label="Add README.md to context"]')).not.toBeNull()
    })

    await act(async () => {
      ;(document.body.querySelector('[aria-label="Add src to context"]') as HTMLButtonElement).click()
    })
    expect(onInsertPath).toHaveBeenCalledWith('src/')

    await act(async () => {
      ;(document.body.querySelector('[aria-label="Add README.md to context"]') as HTMLButtonElement).click()
    })
    expect(onInsertPath).toHaveBeenCalledWith('README.md')
  })
})

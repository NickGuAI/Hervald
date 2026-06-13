// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSource } from '../../use-workspace'

const mocks = vi.hoisted(() => ({
  fetchWorkspaceTree: vi.fn(),
  fetchWorkspaceExpandedTree: vi.fn(),
  fetchWorkspacePathResolution: vi.fn(),
  downloadWorkspaceFile: vi.fn(),
  saveFile: vi.fn(),
  deletePath: vi.fn(),
  previewData: null as null | {
    kind: 'text'
    path: string
    name: string
    content: string
    size: number
    truncated: boolean
    workspace: {
      source: {
        kind: 'target'
        id: string
        label: string
      }
      rootPath: string
      rootName: string
      gitRoot: string | null
      readOnly: boolean
      isRemote: boolean
    }
  },
}))

vi.mock('../../use-workspace', () => ({
  downloadWorkspaceFile: mocks.downloadWorkspaceFile,
  fetchWorkspaceTree: mocks.fetchWorkspaceTree,
  fetchWorkspaceExpandedTree: mocks.fetchWorkspaceExpandedTree,
  fetchWorkspacePathResolution: mocks.fetchWorkspacePathResolution,
  getWorkspaceSourceKey: (source: WorkspaceSource) =>
    `target:${source.targetId}`,
  isWorkspaceTargetNotFoundError: (error: unknown) =>
    error instanceof Error && error.message.includes('Workspace target not found'),
  useWorkspaceActions: () => ({
    createFile: vi.fn(async () => undefined),
    createFolder: vi.fn(async () => undefined),
    saveFile: mocks.saveFile,
    renamePath: vi.fn(async () => undefined),
    deletePath: mocks.deletePath,
    uploadFiles: vi.fn(async () => undefined),
    initGit: vi.fn(async () => undefined),
  }),
  useWorkspaceFilePreview: () => ({
    data: mocks.previewData,
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
  WorkspaceFilePreview: ({
    selectedPath,
    draftContent,
    readOnly,
    onDraftChange,
    onSave,
    onDelete,
  }: {
    selectedPath: string | null
    draftContent?: string
    readOnly?: boolean
    onDraftChange?: (value: string) => void
    onSave?: () => void
    onDelete?: () => void
  }) => (
    <>
      <div data-testid="workspace-preview-path">{selectedPath ?? 'none'}</div>
      {!readOnly && selectedPath && (
        <>
          <textarea
            data-testid="workspace-preview-editor"
            value={draftContent ?? ''}
            onChange={(event) => onDraftChange?.(event.target.value)}
          />
          <button type="button" onClick={onSave}>Save file</button>
          <button type="button" onClick={onDelete}>Delete file</button>
        </>
      )}
    </>
  ),
}))

vi.mock('../WorkspaceGitPanel', () => ({
  WorkspaceGitPanel: () => null,
}))

import { WorkspacePanel } from '../WorkspacePanel'

const SOURCE: WorkspaceSource = {
  kind: 'target',
  targetId: 'wt-cmd-1',
  readOnly: false,
}
const LOCATION_SOURCE: WorkspaceSource = {
  kind: 'target',
  targetId: 'wt-location-1',
  readOnly: false,
}

function createWorkspaceTreeResponse(
  parentPath: string,
  nodes: Array<{ name: string; path: string; type: 'file' | 'directory' }>,
) {
  return {
    workspace: {
      source: {
        kind: 'target' as const,
        id: 'wt-cmd-1',
        label: 'Test Commander',
      },
      rootPath: '/tmp/cmd-1',
      rootName: 'cmd-1',
      gitRoot: '/tmp/cmd-1',
      readOnly: false,
      isRemote: false,
    },
    parentPath,
    nodes: nodes.map((node) => ({ ...node, parentPath })),
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
        { name: '.config', path: '.config', type: 'directory' },
        { name: 'README.md', path: 'README.md', type: 'file' },
        { name: '.env', path: '.env', type: 'file' },
      ]),
    )
    mocks.fetchWorkspaceExpandedTree.mockImplementation(async (_source: WorkspaceSource, parentPath: string) => {
      if (parentPath === 'docs') {
        return createWorkspaceTreeResponse('docs', [
          { name: 'spec.md', path: 'docs/spec.md', type: 'file' },
        ])
      }
      if (parentPath === 'apps/hammurabi/docs/diagrams') {
        return createWorkspaceTreeResponse('apps/hammurabi/docs/diagrams', [
          { name: 'ui-to-backend-logic-flow.dot', path: 'apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.dot', type: 'file' },
          { name: 'ui-to-backend-logic-flow.svg', path: 'apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg', type: 'file' },
        ])
      }

      return createWorkspaceTreeResponse('src', [
        { name: 'app.ts', path: 'src/app.ts', type: 'file' },
      ])
    })
    mocks.fetchWorkspacePathResolution.mockImplementation(async (_source: WorkspaceSource, requestedPath: string) => {
      let relativePath = requestedPath
      if (relativePath.startsWith('/home/builder/App/')) {
        relativePath = relativePath.slice('/home/builder/App/'.length)
      }
      if (relativePath === '/home/builder/App') {
        relativePath = ''
      }
      return {
        workspace: createWorkspaceTreeResponse('', []).workspace,
        requestedPath,
        path: relativePath,
        type: relativePath === 'src' ? 'directory' : 'file',
        treePath: relativePath === 'src' ? 'src' : relativePath.split('/').slice(0, -1).join('/'),
      }
    })
    mocks.saveFile.mockResolvedValue(undefined)
    mocks.deletePath.mockResolvedValue(undefined)
    mocks.previewData = null
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
    mocks.fetchWorkspacePathResolution.mockReset()
    mocks.downloadWorkspaceFile.mockReset()
    mocks.saveFile.mockReset()
    mocks.deletePath.mockReset()
    mocks.previewData = null
    vi.clearAllMocks()
  })

  it('adds file and directory tree nodes with explicit backend context types', async () => {
    const onInsertPath = vi.fn()

    await renderPanel(onInsertPath)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Add src to context"]')).not.toBeNull()
      expect(document.body.querySelector('[aria-label="Add README.md to context"]')).not.toBeNull()
    })

    await act(async () => {
      ;(document.body.querySelector('[aria-label="Add src to context"]') as HTMLButtonElement).click()
    })
    expect(onInsertPath).toHaveBeenCalledWith('src', 'directory')

    await act(async () => {
      ;(document.body.querySelector('[aria-label="Add README.md to context"]') as HTMLButtonElement).click()
    })
    expect(onInsertPath).toHaveBeenCalledWith('README.md', 'file')
  })

  it('downloads file tree rows and disables directory row downloads', async () => {
    const onInsertPath = vi.fn()
    mocks.downloadWorkspaceFile.mockResolvedValue(undefined)

    await renderPanel(onInsertPath)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Download README.md"]')).not.toBeNull()
      expect(document.body.querySelector('[aria-label="Download src"]')).not.toBeNull()
    })

    const directoryDownload = document.body.querySelector('[aria-label="Download src"]') as HTMLButtonElement
    expect(directoryDownload.disabled).toBe(true)

    await act(async () => {
      ;(document.body.querySelector('[aria-label="Download README.md"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.downloadWorkspaceFile).toHaveBeenCalledWith(SOURCE, 'README.md', undefined)
  })

  it('shows shared feedback for save and confirms before deleting a selected file', async () => {
    const onInsertPath = vi.fn()

    await renderPanel(onInsertPath)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Add README.md to context"]')).not.toBeNull()
    })

    await act(async () => {
      const readmeButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('README.md')) as HTMLButtonElement | undefined
      readmeButton?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toContain('README.md')
    })

    await act(async () => {
      const saveButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Save file') as HTMLButtonElement | undefined
      saveButton?.click()
      await Promise.resolve()
    })

    expect(mocks.saveFile).toHaveBeenCalledWith('README.md', '')
    expect(document.body.textContent).toContain('Saved README.md.')

    await act(async () => {
      const deleteButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Delete file') as HTMLButtonElement | undefined
      deleteButton?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Delete workspace path?')
    expect(mocks.deletePath).not.toHaveBeenCalled()

    await act(async () => {
      const cancelButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Cancel') as HTMLButtonElement | undefined
      cancelButton?.click()
      await Promise.resolve()
    })
    expect(mocks.deletePath).not.toHaveBeenCalled()

    await act(async () => {
      const deleteButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Delete file') as HTMLButtonElement | undefined
      deleteButton?.click()
      await Promise.resolve()
    })
    await act(async () => {
      const confirmButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Delete') as HTMLButtonElement | undefined
      confirmButton?.click()
      await Promise.resolve()
    })

    expect(mocks.deletePath).toHaveBeenCalledWith('README.md')
    expect(document.body.textContent).toContain('Deleted README.md.')
  })

  it('surfaces workspace download failures in the panel', async () => {
    const onInsertPath = vi.fn()
    mocks.downloadWorkspaceFile.mockRejectedValueOnce(new Error('Request failed (404): Workspace path not found'))

    await renderPanel(onInsertPath)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Download README.md"]')).not.toBeNull()
    })

    await act(async () => {
      ;(document.body.querySelector('[aria-label="Download README.md"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Request failed (404): Workspace path not found')
    })
  })

  it('hides hidden workspace entries by default until toggled on', async () => {
    const onInsertPath = vi.fn()

    await renderPanel(onInsertPath)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Add README.md to context"]')).not.toBeNull()
    })

    expect(document.body.querySelector('[aria-label="Add .config to context"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="Add .env to context"]')).toBeNull()

    await act(async () => {
      ;(document.body.querySelector('[data-testid="workspace-hidden-toggle"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Add .config to context"]')).not.toBeNull()
      expect(document.body.querySelector('[aria-label="Add .env to context"]')).not.toBeNull()
    })
  })

  it('opens a requested file path in the large side-preview modal', async () => {
    const onInsertPath = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="docs/spec.md"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toBe('docs/spec.md')
    })
  })

  it('exposes the same download action in the side-preview modal header', async () => {
    const onInsertPath = vi.fn()
    mocks.downloadWorkspaceFile.mockResolvedValue(undefined)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="README.md"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toBe('README.md')
    })

    const dialog = document.body.querySelector('div[role="dialog"]')
    if (!dialog) {
      throw new Error('expected side preview modal dialog')
    }
    const downloadButton = dialog.querySelector('[aria-label="Download README.md"]') as HTMLButtonElement | null
    expect(downloadButton).not.toBeNull()

    await act(async () => {
      downloadButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.downloadWorkspaceFile).toHaveBeenCalledWith(SOURCE, 'README.md', undefined)
  })

  it('resolves absolute SVG chat file links to the rendered SVG before expanding the parent directory', async () => {
    const onInsertPath = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="/home/builder/App/apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.fetchWorkspacePathResolution).toHaveBeenCalledWith(
        SOURCE,
        '/home/builder/App/apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg',
      )
      expect(mocks.fetchWorkspaceExpandedTree).toHaveBeenCalledWith(
        SOURCE,
        'apps/hammurabi/docs/diagrams',
      )
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toBe(
        'apps/hammurabi/docs/diagrams/ui-to-backend-logic-flow.svg',
      )
    })
    expect(mocks.fetchWorkspaceExpandedTree).not.toHaveBeenCalledWith(
      SOURCE,
      'home/builder/App/apps/hammurabi/docs/diagrams',
    )
  })

  it('selects requested directory paths without opening a file preview modal', async () => {
    const onInsertPath = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="src"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.fetchWorkspaceExpandedTree).toHaveBeenCalledWith(SOURCE, 'src')
    })
    expect(document.body.querySelector('[data-testid="workspace-preview-path"]')).toBeNull()
  })

  it('consumes requested paths once instead of replaying them when the workspace source changes', async () => {
    const onInsertPath = vi.fn()
    const onRequestedPathConsumed = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="src/app.ts"
          requestedPathToken={1}
          onRequestedPathConsumed={onRequestedPathConsumed}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.fetchWorkspacePathResolution).toHaveBeenCalledWith(SOURCE, 'src/app.ts')
      expect(mocks.fetchWorkspaceExpandedTree).toHaveBeenCalledWith(SOURCE, 'src')
      expect(onRequestedPathConsumed).toHaveBeenCalledWith(1)
    })

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={LOCATION_SOURCE}
          position="side"
          variant="dark"
          requestedPath="src/app.ts"
          requestedPathToken={1}
          onRequestedPathConsumed={onRequestedPathConsumed}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.fetchWorkspacePathResolution).not.toHaveBeenCalledWith(LOCATION_SOURCE, 'src/app.ts')

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={LOCATION_SOURCE}
          position="side"
          variant="dark"
          requestedPath="src/app.ts"
          requestedPathToken={2}
          onRequestedPathConsumed={onRequestedPathConsumed}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.fetchWorkspacePathResolution).toHaveBeenCalledWith(LOCATION_SOURCE, 'src/app.ts')
      expect(onRequestedPathConsumed).toHaveBeenCalledWith(2)
    })
  })

  it('cancels stale requested-path resolutions when the source changes', async () => {
    const onInsertPath = vi.fn()
    let resolveStalePath!: (value: Awaited<ReturnType<typeof mocks.fetchWorkspacePathResolution>>) => void
    const stalePathResolution = new Promise<Awaited<ReturnType<typeof mocks.fetchWorkspacePathResolution>>>((resolve) => {
      resolveStalePath = resolve
    })

    mocks.fetchWorkspacePathResolution.mockImplementation(async (source: WorkspaceSource, requestedPath: string) => {
      if (source.targetId === SOURCE.targetId) {
        return stalePathResolution
      }
      return {
        workspace: createWorkspaceTreeResponse('', []).workspace,
        requestedPath,
        path: 'README.md',
        type: 'file',
        treePath: '',
      }
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="README.md"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={LOCATION_SOURCE}
          position="side"
          variant="dark"
          requestedPath="README.md"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toBe('README.md')
    })

    await act(async () => {
      resolveStalePath({
        workspace: createWorkspaceTreeResponse('', []).workspace,
        requestedPath: 'README.md',
        path: 'src/app.ts',
        type: 'file',
        treePath: 'src',
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toBe('README.md')
    })
  })

  it('reopens a stale target and retries root tree reads once before showing an error', async () => {
    const onInsertPath = vi.fn()
    const recoverStaleTarget = vi.fn(async () => LOCATION_SOURCE)
    mocks.fetchWorkspaceTree
      .mockRejectedValueOnce(new Error('Request failed (404): {"error":"Workspace target not found"}'))
      .mockImplementation(async (source: WorkspaceSource, parentPath = '') =>
        createWorkspaceTreeResponse(parentPath, [
          { name: `${source.targetId}.md`, path: `${source.targetId}.md`, type: 'file' },
        ]),
      )

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
          onRecoverStaleTarget={recoverStaleTarget}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(recoverStaleTarget).toHaveBeenCalledWith(SOURCE)
      expect(mocks.fetchWorkspaceTree).toHaveBeenCalledWith(LOCATION_SOURCE, '')
      expect(document.body.textContent).toContain('wt-location-1.md')
    })
    expect(document.body.textContent).not.toContain('Workspace target not found')
  })

  it('keeps the side directory tree scrollable while opening clicked files in a modal', async () => {
    const onInsertPath = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[aria-label="Add README.md to context"]')).not.toBeNull()
    })

    await act(async () => {
      const readmeButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('README.md')) as HTMLButtonElement | undefined
      readmeButton?.click()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-preview-path"]')?.textContent).toBe('README.md')
    })
    expect(document.body.querySelector('[aria-label="Add README.md to context"]')).not.toBeNull()
  })

  it('keeps modal edits in draft state instead of resetting to preview content', async () => {
    const onInsertPath = vi.fn()
    mocks.previewData = {
      kind: 'text',
      path: 'README.md',
      name: 'README.md',
      content: 'Original',
      size: 8,
      truncated: false,
      workspace: {
        source: {
          kind: 'target',
          id: 'wt-cmd-1',
          label: 'Test Commander',
        },
        rootPath: '/tmp/cmd-1',
        rootName: 'cmd-1',
        gitRoot: '/tmp/cmd-1',
        readOnly: false,
        isRemote: false,
      },
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <WorkspacePanel
          source={SOURCE}
          position="side"
          variant="dark"
          requestedPath="README.md"
          requestedPathToken={1}
          onInsertPath={onInsertPath}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('button')?.textContent).toBeDefined()
      expect(Array.from(document.body.querySelectorAll('button')).some((button) => button.textContent === 'Edit')).toBe(true)
    })

    await act(async () => {
      const editButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Edit') as HTMLButtonElement | undefined
      editButton?.click()
    })

    await vi.waitFor(() => {
      const editorCandidate = Array.from(document.body.querySelectorAll<HTMLTextAreaElement>('div[role="dialog"] textarea'))
        .find((textarea) => textarea.value === 'Original')
      expect(editorCandidate).toBeDefined()
    })
    const editor = Array.from(document.body.querySelectorAll<HTMLTextAreaElement>('div[role="dialog"] textarea'))
      .find((textarea) => textarea.value === 'Original')
    if (!editor) {
      throw new Error('expected workspace preview editor')
    }

    await act(async () => {
      editor.value = 'Changed'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const changedEditor = Array.from(document.body.querySelectorAll<HTMLTextAreaElement>('div[role="dialog"] textarea'))
      .find((textarea) => textarea.value === 'Changed')
    expect(changedEditor?.value).toBe('Changed')
  })
})

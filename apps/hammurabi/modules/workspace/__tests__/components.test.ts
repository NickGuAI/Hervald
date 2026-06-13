// @vitest-environment jsdom

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceGitPanel } from '../components/WorkspaceGitPanel'
import { buildWorkspaceRawUrl } from '../components/WorkspaceFilePreview'
import { WorkspaceToolbar } from '../components/WorkspaceToolbar'
import { WorkspaceTree } from '../components/WorkspaceTree'
import { downloadWorkspaceFile } from '../use-workspace'

const workspace = {
  source: {
    kind: 'target' as const,
    id: 'session-1',
    label: 'session-1',
  },
  rootPath: '/tmp/workspace',
  rootName: 'workspace',
  gitRoot: null,
  readOnly: true,
  isRemote: false,
}

const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

describe('workspace components', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    })
    document.body.innerHTML = ''
  })

  it('renders an empty workspace tree state', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceTree, {
        nodesByParent: { '': [] },
        expandedPaths: new Set<string>(),
        loadingPaths: new Set<string>(),
        selectedPath: null,
        onSelectPath: () => undefined,
        onToggleDirectory: () => undefined,
      }),
    )

    expect(html).toContain('Workspace is empty')
  })

  it('renders file-row downloads while disabling directory single-file downloads', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceTree, {
        nodesByParent: {
          '': [
            {
              name: 'src',
              path: 'src',
              parentPath: '',
              type: 'directory',
            },
            {
              name: 'README.md',
              path: 'README.md',
              parentPath: '',
              type: 'file',
            },
          ],
        },
        expandedPaths: new Set<string>(),
        loadingPaths: new Set<string>(),
        selectedPath: null,
        onSelectPath: () => undefined,
        onToggleDirectory: () => undefined,
        onDownloadPath: () => undefined,
      }),
    )

    expect(html).toContain('aria-label="Download README.md"')
    expect(html).toContain('title="Download README.md"')
    expect(html).toContain('aria-label="Download src"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Directories cannot be downloaded as single files')
  })

  it('enables selected-toolbar downloads only for selected files', () => {
    const fileHtml = renderToStaticMarkup(
      createElement(WorkspaceToolbar, {
        currentDirectoryPath: '',
        selectedPath: 'README.md',
        selectedType: 'file',
        onRefresh: () => undefined,
        onUpload: () => undefined,
        onNewFile: () => undefined,
        onNewFolder: () => undefined,
        onDownloadSelected: () => undefined,
      }),
    )
    const directoryHtml = renderToStaticMarkup(
      createElement(WorkspaceToolbar, {
        currentDirectoryPath: 'src',
        selectedPath: 'src',
        selectedType: 'directory',
        onRefresh: () => undefined,
        onUpload: () => undefined,
        onNewFile: () => undefined,
        onNewFolder: () => undefined,
        onDownloadSelected: () => undefined,
      }),
    )

    expect(fileHtml).toContain('aria-label="Download README.md"')
    expect(fileHtml).not.toContain('disabled=""')
    expect(directoryHtml).toContain('aria-label="Download src"')
    expect(directoryHtml).toContain('disabled=""')
    expect(directoryHtml).toContain('Directories cannot be downloaded as single files')
  })

  it('renders the non-git empty state', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, {
        status: {
          workspace,
          enabled: false,
          branch: null,
          ahead: 0,
          behind: 0,
          entries: [],
        },
        log: {
          workspace,
          enabled: false,
          commits: [],
        },
      }),
    )

    expect(html).toContain('Git is not initialized for this workspace')
  })

  it('renders pending changes above recent commits in a vertical scrollable layout', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, {
        status: {
          workspace,
          enabled: true,
          branch: 'dev',
          ahead: 2,
          behind: 1,
          entries: [
            { code: 'M', path: 'apps/hammurabi/modules/workspace/components/WorkspaceGitPanel.tsx' },
          ],
        },
        log: {
          workspace,
          enabled: true,
          commits: [
            {
              hash: 'a7c066a76b1d4f0d',
              shortHash: 'a7c066a',
              subject: 'Auto-commit workspace changes',
              author: 'Atlas',
              authoredAt: '2026-06-03T14:00:00.000Z',
            },
          ],
        },
      }),
    )

    expect(html.indexOf('Pending Changes')).toBeGreaterThan(-1)
    expect(html.indexOf('Recent Commits')).toBeGreaterThan(-1)
    expect(html.indexOf('Pending Changes')).toBeLessThan(html.indexOf('Recent Commits'))
    expect(html).toContain('flex h-full min-h-0 flex-col gap-3')
    expect(html).not.toContain('xl:grid-cols')
    expect(html).not.toContain('grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')
    expect(html.match(/min-h-0 flex-1 overflow-auto/g)?.length).toBe(2)
    expect(html).toContain('dev • +2 / -1')
    expect(html).toContain('WorkspaceGitPanel.tsx')
    expect(html).toContain('Auto-commit workspace changes')
  })

  it('preserves empty states for enabled git sections', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, {
        status: {
          workspace,
          enabled: true,
          branch: 'dev',
          ahead: 0,
          behind: 0,
          entries: [],
        },
        log: {
          workspace,
          enabled: true,
          commits: [],
        },
      }),
    )

    expect(html.indexOf('Working tree is clean.')).toBeGreaterThan(-1)
    expect(html.indexOf('No commits yet.')).toBeGreaterThan(-1)
    expect(html.indexOf('Working tree is clean.')).toBeLessThan(html.indexOf('No commits yet.'))
  })

  it('builds a ticketed raw URL for target workspaces', () => {
    expect(
      buildWorkspaceRawUrl({
        kind: 'target',
        id: 'wt-1',
        label: 'local:/tmp/workspace',
      }, 'docs/report.pdf', 'ticket-123'),
    ).toBe(
      '/api/workspace/raw?path=docs%2Freport.pdf&ticket=ticket-123&targetId=wt-1',
    )
  })

  it('omits the raw token query parameter when no token is available', () => {
    expect(
      buildWorkspaceRawUrl({
        kind: 'target',
        id: 'wt-1',
        label: 'local:/tmp/workspace',
      }, 'docs/report.pdf'),
    ).toBe(
      '/api/workspace/raw?path=docs%2Freport.pdf&targetId=wt-1',
    )
  })

  it('builds ticketed download URLs without changing inline raw URLs', () => {
    expect(
      buildWorkspaceRawUrl({
        kind: 'target',
        id: 'wt-1',
        label: 'local:/tmp/workspace',
      }, 'docs/report.pdf', 'ticket-123', { download: true }),
    ).toBe(
      '/api/workspace/raw?path=docs%2Freport.pdf&ticket=ticket-123&targetId=wt-1&download=1',
    )
  })

  it('downloads selected files through the raw workspace endpoint', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const createObjectUrl = vi.fn(() => 'blob:workspace-download')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    })
    const fetchMock = vi.fn(async () => new Response(new Blob(['Unified workspace\n']), {
      status: 200,
      headers: {
        'content-disposition': 'attachment; filename="README.md"',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await downloadWorkspaceFile({
      kind: 'target',
      targetId: 'wt-1',
    }, 'README.md')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/raw?path=README.md&targetId=wt-1&download=1',
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).not.toHaveBeenCalled()
  })

  it('surfaces raw workspace download errors from the handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Workspace path not found' }),
      {
        status: 404,
        headers: { 'content-type': 'application/json' },
      },
    )))

    await expect(downloadWorkspaceFile({
      kind: 'target',
      targetId: 'wt-1',
    }, 'missing.txt')).rejects.toThrow('Request failed (404): Workspace path not found')
  })
})

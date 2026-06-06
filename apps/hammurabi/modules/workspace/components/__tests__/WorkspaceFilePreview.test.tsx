// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStoredInstanceUrl, setStoredInstanceUrl } from '@/lib/api-base'
import { WorkspaceFilePreview } from '../WorkspaceFilePreview'
import type {
  WorkspaceFilePreview as WorkspaceFilePreviewData,
  WorkspaceSourceDescriptor,
} from '../../types'

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  buildRequestHeaders: vi.fn(async () => new Headers()),
  fetchJson: vi.fn(),
  getAccessToken: mocks.getAccessToken,
  isAuthRecoveryRequiredError: () => false,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function createPdfPreview(source: WorkspaceSourceDescriptor): WorkspaceFilePreviewData {
  return {
    workspace: {
      source,
      rootPath: '/tmp/workspace',
      rootName: 'workspace',
      gitRoot: null,
      readOnly: true,
      isRemote: false,
    },
    path: 'docs/report.pdf',
    name: 'report.pdf',
    kind: 'pdf',
    size: 1024,
    mimeType: 'application/pdf',
    writable: false,
  }
}

function createTextPreview(
  source: WorkspaceSourceDescriptor,
  path: string,
  content: string,
  options: { truncated?: boolean } = {},
): WorkspaceFilePreviewData {
  const name = path.split('/').at(-1) ?? path
  return {
    workspace: {
      source,
      rootPath: '/tmp/workspace',
      rootName: 'workspace',
      gitRoot: null,
      readOnly: false,
      isRemote: false,
    },
    path,
    name,
    kind: 'text',
    size: content.length,
    mimeType: path.endsWith('.html') ? 'text/html' : 'text/plain',
    content,
    truncated: options.truncated,
    writable: true,
  }
}

async function renderNode(node: ReactNode) {
  await act(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(node)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('WorkspaceFilePreview', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.getAccessToken.mockResolvedValue('token-123')
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
    clearStoredInstanceUrl()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    mocks.getAccessToken.mockReset()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('renders a Download anchor with download=1 without changing inline preview URLs', async () => {
    const source: WorkspaceSourceDescriptor = {
      kind: 'target',
      id: 'wt-1',
      label: 'local:/tmp/workspace',
    }
    const inlineUrl = '/api/workspace/raw?path=docs%2Freport.pdf&access_token=token-123&targetId=wt-1'
    const downloadUrl = `${inlineUrl}&download=1`

    await renderNode(
      <WorkspaceFilePreview
        selectedPath="docs/report.pdf"
        preview={createPdfPreview(source)}
        draftContent=""
        readOnly
      />,
    )

    await act(async () => {
      await vi.waitFor(() => {
        const downloadAnchor = document.body.querySelector('a[download][aria-label="Download report.pdf"]')
        expect(downloadAnchor?.getAttribute('href')).toBe(downloadUrl)
      })
    })

    const downloadAnchor = document.body.querySelector('a[download][aria-label="Download report.pdf"]')
    const inlineObject = document.body.querySelector('object[type="application/pdf"]')
    const inlineEmbed = inlineObject?.querySelector('embed[type="application/pdf"]')

    expect(downloadAnchor?.hasAttribute('download')).toBe(true)
    expect(downloadAnchor?.getAttribute('href')).toContain('download=1')
    expect(inlineObject?.getAttribute('data')).toBe(inlineUrl)
    expect(inlineEmbed?.getAttribute('src')).toBe(inlineUrl)
    expect(inlineObject?.getAttribute('data')).not.toContain('download=1')
  })

  it('renders native download anchors against the selected instance URL', async () => {
    const source: WorkspaceSourceDescriptor = {
      kind: 'target',
      id: 'wt-1',
      label: 'local:/tmp/workspace',
    }
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    setStoredInstanceUrl('https://hervald.example.com/')

    await renderNode(
      <WorkspaceFilePreview
        selectedPath="docs/report.pdf"
        preview={createPdfPreview(source)}
        draftContent=""
        readOnly
      />,
    )

    await act(async () => {
      await vi.waitFor(() => {
        const downloadAnchor = document.body.querySelector('a[download][aria-label="Download report.pdf"]')
        expect(downloadAnchor?.getAttribute('href')).toBe(
          'https://hervald.example.com/api/workspace/raw?path=docs%2Freport.pdf&access_token=token-123&targetId=wt-1&download=1',
        )
      })
    })
  })

  it('renders HTML text files in a sandboxed iframe when preview mode is selected', async () => {
    const source: WorkspaceSourceDescriptor = {
      kind: 'target',
      id: 'wt-1',
      label: 'local:/tmp/workspace',
    }
    const html = '<!doctype html><html><body><h1>Recommendation</h1><script>window.rendered = true</script></body></html>'

    await renderNode(
      <WorkspaceFilePreview
        selectedPath="PMAI-NYTW26/recommendation.html"
        preview={createTextPreview(source, 'PMAI-NYTW26/recommendation.html', html)}
        draftContent={html}
        displayMode="preview"
      />,
    )

    const iframe = document.body.querySelector('iframe[title="Rendered HTML preview of recommendation.html"]')
    expect(document.body.textContent).toContain('Rendered HTML preview')
    expect(iframe?.getAttribute('srcdoc')).toBe(html)
    expect(iframe?.getAttribute('sandbox')).toBe('allow-forms allow-popups allow-scripts')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('keeps non-HTML text files on the text preview path', async () => {
    const source: WorkspaceSourceDescriptor = {
      kind: 'target',
      id: 'wt-1',
      label: 'local:/tmp/workspace',
    }

    await renderNode(
      <WorkspaceFilePreview
        selectedPath="notes.txt"
        preview={createTextPreview(source, 'notes.txt', 'plain notes')}
        draftContent="plain notes"
        displayMode="preview"
      />,
    )

    expect(document.body.querySelector('iframe')).toBeNull()
    expect(document.body.querySelector('pre')?.textContent).toBe('plain notes')
    expect(document.body.textContent).toContain('Text preview')
  })

  it('does not render truncated HTML in an iframe', async () => {
    const source: WorkspaceSourceDescriptor = {
      kind: 'target',
      id: 'wt-1',
      label: 'local:/tmp/workspace',
    }
    const html = '<!doctype html><html><body>truncated</body></html>'

    await renderNode(
      <WorkspaceFilePreview
        selectedPath="truncated.html"
        preview={createTextPreview(source, 'truncated.html', html, { truncated: true })}
        draftContent={html}
        displayMode="preview"
      />,
    )

    expect(document.body.querySelector('iframe')).toBeNull()
    expect(document.body.querySelector('pre')?.textContent).toBe(html)
    expect(document.body.textContent).toContain('Preview truncated to 256KB')
  })
})

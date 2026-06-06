// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewPopup } from '../../modules/agents/components/workspace-overlay/PreviewPopup'
import { WorkspaceFilePreview } from '../../modules/workspace/components/WorkspaceFilePreview'
import type {
  WorkspaceFilePreview as WorkspaceFilePreviewData,
  WorkspaceSourceDescriptor,
} from '../../modules/workspace/types'

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

async function renderNode(node: ReactNode) {
  await act(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    root?.render(node)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('workspace mobile preview fixes', () => {
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
    mocks.getAccessToken.mockReset()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('keeps the desktop and mobile preview body wrappers as flex columns', async () => {
    await renderNode(
      <PreviewPopup
        open
        selectedPath="README.md"
        preview={null}
        draftContent=""
        loading={false}
        error={null}
        onClose={() => undefined}
      />,
    )

    await vi.waitFor(() => {
      const desktopBody = document.body.querySelector('[data-testid="workspace-preview-desktop-body"]')
      const mobileBody = document.body.querySelector('[data-testid="workspace-preview-mobile-body"]')

      expect(desktopBody?.classList.contains('min-h-0')).toBe(true)
      expect(desktopBody?.classList.contains('flex-1')).toBe(true)
      expect(desktopBody?.classList.contains('p-3')).toBe(true)
      expect(desktopBody?.classList.contains('flex')).toBe(true)
      expect(desktopBody?.classList.contains('flex-col')).toBe(true)
      expect(mobileBody?.classList.contains('min-h-0')).toBe(true)
      expect(mobileBody?.classList.contains('flex-1')).toBe(true)
      expect(mobileBody?.classList.contains('p-2')).toBe(true)
      expect(mobileBody?.classList.contains('flex')).toBe(true)
      expect(mobileBody?.classList.contains('flex-col')).toBe(true)
    })
  })

  it('renders PDF previews inline for target workspaces', async () => {
    const source: WorkspaceSourceDescriptor = {
      kind: 'target',
      id: 'wt-1',
      label: 'local:/tmp/workspace',
    }
    const expectedUrl = '/api/workspace/raw?path=docs%2Freport.pdf&access_token=token-123&targetId=wt-1'

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
        expect(
          document.body.querySelector('object[type="application/pdf"]')?.getAttribute('data'),
        ).toBe(expectedUrl)
      })
    })

    const object = document.body.querySelector('object[type="application/pdf"]')
    const embed = object?.querySelector('embed[type="application/pdf"]')
    const link = object?.querySelector('a')

    expect(object?.getAttribute('data')).toBe(expectedUrl)
    expect(embed?.getAttribute('src')).toBe(expectedUrl)
    expect(link?.getAttribute('href')).toBe(expectedUrl)
  })

})

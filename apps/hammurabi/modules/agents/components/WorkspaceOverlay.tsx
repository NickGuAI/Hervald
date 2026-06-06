import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Search, X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { cn } from '@/lib/utils'
import {
  downloadWorkspaceFile,
  getWorkspaceSourceKey,
  useWorkspaceGitLog,
  useWorkspaceGitStatus,
  type WorkspaceSource,
  type WorkspaceSourceRecovery,
} from '../../workspace/use-workspace'
import type { WorkspaceTreeNode } from '../../workspace/types'
import { PreviewPopup } from './workspace-overlay/PreviewPopup'
import { useWorkspaceOverlayTree } from './workspace-overlay/use-workspace-overlay-tree'
import { WorkspaceChangesTab } from './workspace-overlay/WorkspaceChangesTab'
import { WorkspaceFilesTab } from './workspace-overlay/WorkspaceFilesTab'
import { WorkspaceLogTab } from './workspace-overlay/WorkspaceLogTab'

export interface WorkspaceOverlayProps {
  open: boolean
  onClose: () => void
  onSelectFile: (filePath: string, type: WorkspaceTreeNode['type']) => void
  source: WorkspaceSource
  requestedPath?: string | null
  requestedPathToken?: number
  onRequestedPathConsumed?: (token: number) => void
  onRecoverStaleTarget?: WorkspaceSourceRecovery
}

type OverlayTab = 'files' | 'changes' | 'log'

const OVERLAY_TABS = [
  { key: 'files', label: 'Files' },
  { key: 'changes', label: 'Changes' },
  { key: 'log', label: 'Git Log' },
] as const satisfies readonly { key: OverlayTab; label: string }[]

export function WorkspaceOverlay({
  open,
  onClose,
  onSelectFile,
  source,
  requestedPath,
  requestedPathToken = 0,
  onRequestedPathConsumed,
  onRecoverStaleTarget,
}: WorkspaceOverlayProps) {
  const sourceKey = getWorkspaceSourceKey(source)
  const [activeTab, setActiveTab] = useState<OverlayTab>('files')
  const [query, setQuery] = useState('')
  const [downloadError, setDownloadError] = useState<{ path: string; message: string } | null>(null)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const {
    filteredNodesByParent,
    expandedPaths,
    loadingPaths,
    addedPaths,
    selectedPath,
    selectedPreviewPath,
    previewQuery,
    handlePreviewPath,
    handleToggleDirectory,
    handleAddPath,
    closePreview,
  } = useWorkspaceOverlayTree({
    open,
    source,
    query,
    filesTabActive: activeTab === 'files',
    onSelectFile,
    requestedPath,
    requestedPathToken,
    onRequestedPathConsumed,
    onRecoverStaleTarget,
  })

  const gitStatusQuery = useWorkspaceGitStatus(
    source,
    open && activeTab === 'changes',
    onRecoverStaleTarget,
  )
  const gitLogQuery = useWorkspaceGitLog(
    source,
    open && activeTab === 'log',
    15,
    onRecoverStaleTarget,
  )

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus())
      return
    }
    setQuery('')
  }, [open])

  useEffect(() => {
    setActiveTab('files')
    setDownloadError(null)
    setDownloadingPath(null)
  }, [sourceKey])

  async function handleDownloadPath(
    path: string,
    knownType?: WorkspaceTreeNode['type'],
  ): Promise<void> {
    if (knownType !== 'file') {
      setDownloadError({
        path,
        message: 'Directories cannot be downloaded as single files',
      })
      return
    }

    setDownloadError(null)
    setDownloadingPath(path)
    try {
      await downloadWorkspaceFile(source, path, onRecoverStaleTarget)
    } catch (error) {
      setDownloadError({
        path,
        message: error instanceof Error ? error.message : 'Failed to download workspace file',
      })
    } finally {
      setDownloadingPath(null)
    }
  }

  if (!open) {
    return null
  }

  const preview = previewQuery?.data ?? null
  const previewError =
    previewQuery?.error instanceof Error ? previewQuery.error.message : null
  const previewDraftContent =
    preview?.kind === 'text' ? preview.content ?? '' : ''

  return (
    <>
      <DismissibleOverlay
        open={open}
        onClose={selectedPreviewPath ? closePreview : onClose}
        title="Workspace"
        position="bottom-sheet"
        contentClassName={cn(
          'flex w-full flex-col overflow-hidden bg-[var(--hv-surface-card)]',
          'max-h-[85dvh] rounded-t-2xl md:max-w-2xl md:rounded-xl',
        )}
      >
          <div className="flex justify-center pb-1 pt-2 md:hidden">
            <div className="h-1 w-8 rounded-full bg-ink-border" />
          </div>

          <div className="border-b border-[color:var(--hv-border-hair)] px-4 pb-3 pt-2">
            <div className="mb-3 flex items-center gap-2">
              <FolderOpen size={14} className="shrink-0 text-[color:var(--hv-fg-subtle)]" />
              <span className="flex-1 truncate font-mono text-xs text-[color:var(--hv-fg-muted)]">
                Workspace
              </span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 transition-colors hover:bg-[var(--hv-surface-hover)]"
                aria-label="Close workspace"
              >
                <X size={14} className="text-[color:var(--hv-fg-subtle)]" />
              </button>
            </div>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--hv-fg-faint)]"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] py-2 pl-8 pr-3 text-[16px] focus:border-[color:var(--hv-border-soft)] focus:outline-none md:text-sm"
                placeholder="Search files..."
                aria-label="Search workspace files"
              />
            </div>
            <div className="mt-2 flex gap-1">
              {OVERLAY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition-colors',
                    activeTab === tab.key
                      ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]'
                      : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]',
                  )}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {downloadError && (
              <div className="mt-2 rounded-md border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
                {downloadError.message}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === 'files' && (
              <WorkspaceFilesTab
                filteredNodesByParent={filteredNodesByParent}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                addedPaths={addedPaths}
                selectedPath={selectedPath}
                downloadingPath={downloadingPath}
                onSelectPath={handlePreviewPath}
                onToggleDirectory={(path) => void handleToggleDirectory(path)}
                onAddPath={handleAddPath}
                onDownloadPath={(path, knownType) => void handleDownloadPath(path, knownType)}
              />
            )}

            {activeTab === 'changes' && (
              <WorkspaceChangesTab
                gitStatus={gitStatusQuery.data}
                error={gitStatusQuery.error}
                isLoading={gitStatusQuery.isLoading || gitStatusQuery.isFetching}
                addedPaths={addedPaths}
                onAddPath={handleAddPath}
              />
            )}

            {activeTab === 'log' && (
              <WorkspaceLogTab
                gitLog={gitLogQuery.data}
                error={gitLogQuery.error}
                isLoading={gitLogQuery.isLoading || gitLogQuery.isFetching}
              />
            )}
          </div>
      </DismissibleOverlay>

      <PreviewPopup
        open={activeTab === 'files' && Boolean(selectedPreviewPath)}
        selectedPath={selectedPreviewPath}
        preview={preview}
        draftContent={previewDraftContent}
        loading={Boolean(previewQuery?.isLoading || previewQuery?.isFetching)}
        error={previewError}
        downloading={Boolean(selectedPreviewPath && downloadingPath === selectedPreviewPath)}
        downloadError={selectedPreviewPath && downloadError?.path === selectedPreviewPath ? downloadError.message : null}
        onDownload={selectedPreviewPath ? () => void handleDownloadPath(selectedPreviewPath, 'file') : undefined}
        onClose={closePreview}
      />
    </>
  )
}

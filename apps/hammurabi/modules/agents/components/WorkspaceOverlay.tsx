import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getWorkspaceSourceKey,
  useWorkspaceGitLog,
  useWorkspaceGitStatus,
  type WorkspaceSource,
} from '../../workspace/use-workspace'
import { PreviewPopup } from './workspace-overlay/PreviewPopup'
import { useWorkspaceOverlayTree } from './workspace-overlay/use-workspace-overlay-tree'
import { WorkspaceChangesTab } from './workspace-overlay/WorkspaceChangesTab'
import { WorkspaceFilesTab } from './workspace-overlay/WorkspaceFilesTab'
import { WorkspaceLogTab } from './workspace-overlay/WorkspaceLogTab'

export interface WorkspaceOverlayProps {
  open: boolean
  onClose: () => void
  onSelectFile: (filePath: string) => void
  source: WorkspaceSource
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
}: WorkspaceOverlayProps) {
  const sourceKey = getWorkspaceSourceKey(source)
  const [activeTab, setActiveTab] = useState<OverlayTab>('files')
  const [query, setQuery] = useState('')
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
  })

  const gitStatusQuery = useWorkspaceGitStatus(source, open && activeTab === 'changes')
  const gitLogQuery = useWorkspaceGitLog(source, open && activeTab === 'log')

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus())
      return
    }
    setQuery('')
  }, [open])

  useEffect(() => {
    setActiveTab('files')
  }, [sourceKey])

  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      if (selectedPreviewPath) {
        closePreview()
        return
      }
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closePreview, onClose, open, selectedPreviewPath])

  if (!open) {
    return null
  }

  const preview = previewQuery?.data ?? null
  const previewError =
    previewQuery?.error instanceof Error ? previewQuery.error.message : null
  const previewDraftContent =
    preview?.kind === 'text' ? preview.content ?? '' : ''

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998] bg-sumi-black/50"
        onClick={onClose}
      />

      <div className="fixed inset-0 z-[9999] flex items-end justify-center md:items-center md:p-5">
        <div
          className={cn(
            'flex w-full flex-col overflow-hidden bg-washi-white',
            'max-h-[85dvh] rounded-t-2xl md:max-w-2xl md:rounded-xl',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex justify-center pb-1 pt-2 md:hidden">
            <div className="h-1 w-8 rounded-full bg-ink-border" />
          </div>

          <div className="border-b border-ink-border px-4 pb-3 pt-2">
            <div className="mb-3 flex items-center gap-2">
              <FolderOpen size={14} className="shrink-0 text-sumi-diluted" />
              <span className="flex-1 truncate font-mono text-xs text-sumi-gray">
                Workspace
              </span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 transition-colors hover:bg-ink-wash"
                aria-label="Close workspace"
              >
                <X size={14} className="text-sumi-diluted" />
              </button>
            </div>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sumi-mist"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-lg border border-ink-border bg-washi-aged py-2 pl-8 pr-3 text-[16px] focus:border-ink-border-hover focus:outline-none md:text-sm"
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
                      ? 'bg-sumi-black text-washi-aged'
                      : 'text-sumi-diluted hover:bg-ink-wash',
                  )}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === 'files' && (
              <WorkspaceFilesTab
                filteredNodesByParent={filteredNodesByParent}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                addedPaths={addedPaths}
                selectedPath={selectedPath}
                onSelectPath={handlePreviewPath}
                onToggleDirectory={(path) => void handleToggleDirectory(path)}
                onAddPath={handleAddPath}
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
        </div>
      </div>

      <PreviewPopup
        open={activeTab === 'files' && Boolean(selectedPreviewPath)}
        selectedPath={selectedPreviewPath}
        preview={preview}
        draftContent={previewDraftContent}
        loading={Boolean(previewQuery?.isLoading || previewQuery?.isFetching)}
        error={previewError}
        onClose={closePreview}
      />
    </>,
    document.body,
  )
}

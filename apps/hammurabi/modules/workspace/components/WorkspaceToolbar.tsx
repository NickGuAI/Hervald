import { Download, FilePlus2, FolderPlus, Loader2, RefreshCw, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceTreeNode } from '../types'

interface WorkspaceToolbarProps {
  readOnly?: boolean
  currentDirectoryPath: string
  selectedPath: string | null
  selectedType?: WorkspaceTreeNode['type'] | null
  busyLabel?: string | null
  downloading?: boolean
  variant?: 'light' | 'dark'
  onRefresh: () => void
  onUpload: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onDownloadSelected?: () => void
}

export function WorkspaceToolbar({
  readOnly = false,
  currentDirectoryPath,
  selectedPath,
  selectedType = null,
  busyLabel,
  downloading = false,
  variant = 'light',
  onRefresh,
  onUpload,
  onNewFile,
  onNewFolder,
  onDownloadSelected,
}: WorkspaceToolbarProps) {
  const dark = variant === 'dark'
  const canDownloadSelected = Boolean(selectedPath) && selectedType === 'file' && !downloading

  return (
    <div className={cn('border-b px-3 py-2', dark ? 'border-[color:var(--hv-border-soft)] bg-[var(--hv-ink-wash-01)]' : 'border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)]')}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-border-hair)] px-2.5 py-1.5 text-xs hover:bg-[var(--hv-surface-hover)]"
          onClick={onRefresh}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
        {onDownloadSelected && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-border-hair)] px-2.5 py-1.5 text-xs hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onDownloadSelected}
            disabled={!canDownloadSelected}
            title={
              selectedPath
                ? (
                    selectedType === 'file'
                      ? `Download ${selectedPath}`
                      : 'Directories cannot be downloaded as single files'
                  )
                : 'Select a file to download'
            }
            aria-label={selectedPath ? `Download ${selectedPath}` : 'Download selected file'}
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Download
          </button>
        )}
        {!readOnly && (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-border-hair)] px-2.5 py-1.5 text-xs hover:bg-[var(--hv-surface-hover)]"
              onClick={onUpload}
            >
              <Upload size={12} />
              Upload
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-border-hair)] px-2.5 py-1.5 text-xs hover:bg-[var(--hv-surface-hover)]"
              onClick={onNewFile}
            >
              <FilePlus2 size={12} />
              New File
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-border-hair)] px-2.5 py-1.5 text-xs hover:bg-[var(--hv-surface-hover)]"
              onClick={onNewFolder}
            >
              <FolderPlus size={12} />
              New Folder
            </button>
          </>
        )}
        {busyLabel && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-[color:var(--hv-fg-subtle)]">
            <Loader2 size={12} className="animate-spin" />
            {busyLabel}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1 text-whisper text-[color:var(--hv-fg-subtle)] md:flex-row md:items-center md:justify-between">
        <span className="font-mono truncate">dir: {currentDirectoryPath || '.'}</span>
        <span className="font-mono truncate">selected: {selectedPath ?? 'none'}</span>
      </div>
    </div>
  )
}

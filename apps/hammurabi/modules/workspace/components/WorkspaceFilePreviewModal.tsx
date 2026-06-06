import { useEffect, useState } from 'react'
import { Download, Loader2, MessageSquarePlus, RefreshCw, Save, X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import type { WorkspaceFilePreview as WorkspaceFilePreviewData } from '../types'
import type { WorkspacePendingFileAnnotation } from '../use-workspace'
import { WorkspaceFilePreview } from './WorkspaceFilePreview'

interface WorkspaceFilePreviewModalProps {
  open: boolean
  selectedPath: string | null
  preview: WorkspaceFilePreviewData | null
  draftContent: string
  loading: boolean
  refreshing?: boolean
  error: string | null
  readOnly?: boolean
  saving?: boolean
  downloading?: boolean
  downloadError?: string | null
  onClose: () => void
  onRefresh?: () => void
  onDownload?: () => void
  onInsertPath?: (path: string, type: 'file') => void
  onAddAnnotationContext?: (annotation: WorkspacePendingFileAnnotation) => void
  onDraftChange?: (value: string) => void
  onSave?: () => void
}

export function WorkspaceFilePreviewModal({
  open,
  selectedPath,
  preview,
  draftContent,
  loading,
  refreshing = false,
  error,
  readOnly = false,
  saving = false,
  downloading = false,
  downloadError = null,
  onClose,
  onRefresh,
  onDownload,
  onInsertPath,
  onAddAnnotationContext,
  onDraftChange,
  onSave,
}: WorkspaceFilePreviewModalProps) {
  const [mode, setMode] = useState<'preview' | 'editor'>('preview')
  const [annotationText, setAnnotationText] = useState('')
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const canEdit = preview?.kind === 'text' && !readOnly
  const annotationPath = preview?.path ?? selectedPath

  useEffect(() => {
    if (open) {
      setMode('preview')
      setAnnotationText('')
      setAnnotationError(null)
    }
  }, [open, selectedPath])

  function handleAddAnnotation(): void {
    const body = annotationText.trim()
    if (!body || !annotationPath) {
      return
    }
    if (!onAddAnnotationContext) {
      setAnnotationError('No active composer is available for this annotation')
      return
    }
    setAnnotationError(null)
    onAddAnnotationContext({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${annotationPath}:${Date.now()}`,
      path: annotationPath,
      body,
      quote: null,
      range: null,
    })
    setAnnotationText('')
  }

  if (!open || !selectedPath) {
    return null
  }

  return (
    <DismissibleOverlay
      open={open}
      onClose={onClose}
      title="Workspace file"
      position="modal"
      contentClassName="contents"
      contentProps={{ role: 'presentation' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Workspace file"
        className="flex h-[92dvh] w-full max-w-[min(1200px,96vw)] flex-col overflow-hidden rounded-xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">
              Current content on disk
            </p>
            <p className="truncate font-mono text-sm text-[color:var(--hv-fg)]">
              {selectedPath}
            </p>
            {preview && (
              <p className="text-whisper text-[color:var(--hv-fg-subtle)]">
                {preview.kind} • {preview.size} bytes
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onDownload && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onDownload}
                disabled={downloading || loading}
                aria-label={`Download ${selectedPath}`}
              >
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download
              </button>
            )}
            {preview && onInsertPath && (
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-xs text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]"
                onClick={() => onInsertPath(preview.path, 'file')}
              >
                Add to context
              </button>
            )}
            {canEdit && (
              <div className="inline-flex rounded-md border border-[color:var(--hv-border-hair)] p-0.5">
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${mode === 'preview' ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]' : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]'}`}
                  onClick={() => setMode('preview')}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${mode === 'editor' ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]' : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]'}`}
                  onClick={() => setMode('editor')}
                >
                  Edit
                </button>
              </div>
            )}
            {canEdit && mode === 'editor' && onSave && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save
              </button>
            )}
            {onRefresh && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1.5 text-xs text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
                onClick={onRefresh}
                disabled={refreshing}
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
                Refresh
              </button>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]"
              onClick={onClose}
              aria-label="Close file preview"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        {downloadError && (
          <div className="border-b border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-4 py-2 text-sm text-[color:var(--hv-accent-danger)]">
            {downloadError}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
          <div className="min-h-0 flex-1">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly={readOnly}
              saving={saving}
              displayMode={mode}
              showHeader={false}
              showTextActions={false}
              onDraftChange={onDraftChange}
              onSave={onSave}
            />
          </div>
          <aside className="flex min-h-[220px] w-full flex-col rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] lg:w-[340px]">
            <div className="border-b border-[color:var(--hv-border-hair)] px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--hv-fg)]">
                <MessageSquarePlus size={14} className="text-[color:var(--hv-fg-subtle)]" />
                Context annotation
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col justify-between p-3">
              <textarea
                className="min-h-[88px] w-full resize-none rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2 text-sm text-[color:var(--hv-fg)] outline-none placeholder:text-[color:var(--hv-fg-faint)] focus:border-[color:var(--hv-border-strong)]"
                placeholder="Annotation..."
                value={annotationText}
                onChange={(event) => setAnnotationText(event.target.value)}
              />
              {annotationError && (
                <p className="mt-2 text-xs text-[color:var(--hv-accent-danger)]">
                  {annotationError}
                </p>
              )}
              <button
                type="button"
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-3 py-2 text-xs font-medium text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!annotationText.trim() || !onAddAnnotationContext}
                onClick={handleAddAnnotation}
              >
                <MessageSquarePlus size={13} />
                Add annotation
              </button>
            </div>
          </aside>
        </div>
      </div>
    </DismissibleOverlay>
  )
}

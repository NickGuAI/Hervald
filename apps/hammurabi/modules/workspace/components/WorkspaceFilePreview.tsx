import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileCode2, FileImage, FileWarning, Loader2, Pencil, Save, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isAuthRecoveryRequiredError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  WorkspaceFilePreview as WorkspaceFilePreviewData,
} from '../types'
import { buildWorkspaceRawUrl, issueWorkspaceRawTicket } from '../use-workspace'

export { buildWorkspaceRawUrl } from '../use-workspace'

function isHtmlPreviewPath(path: string): boolean {
  return /\.html?$/iu.test(path)
}

interface WorkspaceFilePreviewProps {
  selectedPath: string | null
  preview: WorkspaceFilePreviewData | null
  draftContent: string
  error?: string | null
  loading?: boolean
  readOnly?: boolean
  saving?: boolean
  onDraftChange?: (value: string) => void
  onSave?: () => void
  onRename?: () => void
  onDelete?: () => void
  onDownload?: () => void
  downloading?: boolean
  onInsertPath?: (path: string, type: 'file') => void
  variant?: 'light' | 'dark'
  displayMode?: 'editor' | 'preview'
  showHeader?: boolean
  showTextActions?: boolean
}

export function WorkspaceFilePreview({
  selectedPath,
  preview,
  draftContent,
  error,
  loading = false,
  readOnly = false,
  saving = false,
  onDraftChange = () => undefined,
  onSave = () => undefined,
  onRename = () => undefined,
  onDelete = () => undefined,
  onDownload,
  downloading = false,
  onInsertPath,
  displayMode = 'editor',
  showHeader = true,
  showTextActions = true,
}: WorkspaceFilePreviewProps) {
  const isMarkdownPreview = preview?.kind === 'text'
    && (displayMode === 'preview' || readOnly)
    && preview.path.toLowerCase().endsWith('.md')
  const isHtmlPreview = preview?.kind === 'text'
    && !preview.truncated
    && (displayMode === 'preview' || readOnly)
    && isHtmlPreviewPath(preview.path)
  const isReadOnlyTextPreview = preview?.kind === 'text'
    && !isMarkdownPreview
    && !isHtmlPreview
    && (displayMode === 'preview' || readOnly)
  const [rawFileUrl, setRawFileUrl] = useState<string | null>(null)
  const [downloadFileUrl, setDownloadFileUrl] = useState<string | null>(null)
  const rawPreviewKind = preview?.kind === 'pdf' || preview?.kind === 'binary'
  const previewRawSource = preview?.workspace.source.kind === 'target'
    ? preview.workspace.source
    : null
  const previewRawPath = preview ? preview.path : null

  useEffect(() => {
    let cancelled = false

    if (!previewRawSource || !previewRawPath) {
      setRawFileUrl(null)
      setDownloadFileUrl(null)
      return () => {
        cancelled = true
      }
    }

    setRawFileUrl(null)
    setDownloadFileUrl(null)
    void Promise.all([
      rawPreviewKind ? issueWorkspaceRawTicket(previewRawSource, previewRawPath) : Promise.resolve(null),
      issueWorkspaceRawTicket(previewRawSource, previewRawPath),
    ])
      .then(([previewTicket, downloadTicket]) => {
        if (cancelled) {
          return
        }
        setRawFileUrl(rawPreviewKind
          ? buildWorkspaceRawUrl(
              previewRawSource,
              previewRawPath,
              previewTicket,
            )
          : null)
        setDownloadFileUrl(buildWorkspaceRawUrl(
          previewRawSource,
          previewRawPath,
          downloadTicket,
          { download: true },
        ))
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        if (isAuthRecoveryRequiredError(error)) {
          setRawFileUrl(null)
          setDownloadFileUrl(null)
          return
        }
        setRawFileUrl(rawPreviewKind
          ? buildWorkspaceRawUrl(
              previewRawSource,
              previewRawPath,
            )
          : null)
        setDownloadFileUrl(buildWorkspaceRawUrl(
          previewRawSource,
          previewRawPath,
          null,
          { download: true },
        ))
      })

    return () => {
      cancelled = true
    }
  }, [previewRawPath, previewRawSource, rawPreviewKind])

  if (!selectedPath) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center rounded-lg border border-dashed text-sm',
          'border-[color:var(--hv-border-hair)] text-[color:var(--hv-fg-subtle)]',
        )}
      >
        Select a file to preview it
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--hv-fg-subtle)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading preview…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
        {error}
      </div>
    )
  }

  if (!preview) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]">
      {showHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-[color:var(--hv-fg-muted)]">
              {preview.path}
            </p>
            <p className="text-whisper text-[color:var(--hv-fg-subtle)]">
              {preview.kind} • {preview.size} bytes
            </p>
          </div>
          <div className="flex items-center gap-1">
            {onDownload ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1 text-xs hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onDownload}
                disabled={downloading}
                aria-label={`Download ${preview.name}`}
              >
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download
              </button>
            ) : downloadFileUrl && (
              <a
                href={downloadFileUrl}
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1 text-xs hover:bg-[var(--hv-surface-hover)]"
                download
                aria-label={`Download ${preview.name}`}
              >
                <Download size={13} />
                Download
              </a>
            )}
            {onInsertPath && (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs hover:bg-[var(--hv-surface-hover)]"
                onClick={() => onInsertPath(preview.path, 'file')}
              >
                Add to context
              </button>
            )}
            {!readOnly && (
              <>
                <button type="button" className="rounded-md p-1.5 hover:bg-[var(--hv-surface-hover)]" onClick={onRename} aria-label="Rename file">
                  <Pencil size={13} />
                </button>
                <button type="button" className="rounded-md p-1.5 text-[color:var(--hv-accent-danger)] hover:bg-[var(--hv-accent-danger-wash)]" onClick={onDelete} aria-label="Delete file">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {preview.kind === 'image' && preview.content && (
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-[color:var(--hv-fg-subtle)]">
            <FileImage size={15} />
            Image preview
          </div>
          <img src={preview.content} alt={preview.name} className="max-w-full rounded-lg border border-[color:var(--hv-border-hair)]" />
        </div>
      )}

      {preview.kind === 'pdf' && (
        rawFileUrl ? (
          <object data={rawFileUrl} type="application/pdf" className="flex-1 w-full">
            <embed src={rawFileUrl} type="application/pdf" className="w-full h-full" />
            <p className="p-4 text-sm">Your browser doesn't support inline PDF preview. <a href={rawFileUrl} className="underline">Open the PDF</a>.</p>
          </object>
        ) : previewRawSource && previewRawPath ? (
          <div className="flex flex-1 items-center justify-center px-4 text-sm text-[color:var(--hv-fg-subtle)]">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Loading PDF preview…
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-4 text-sm text-[color:var(--hv-fg-subtle)]">
            <FileWarning size={16} className="mr-2" />
            PDF preview is not available for this workspace source
          </div>
        )
      )}

      {preview.kind === 'binary' && (
        <div className="flex flex-1 items-center justify-center overflow-auto px-4 py-8 text-sm text-[color:var(--hv-fg-subtle)]">
          <div className="max-w-xl rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-5">
            <div className="mb-3 flex items-center gap-2 text-[color:var(--hv-fg)]">
              <FileWarning size={16} />
              <span className="font-medium">Inline preview is not available for this file.</span>
            </div>
            <p className="leading-relaxed">
              Office and iWork files such as DOCX, DOC, XLSX, PPTX, and Pages need a conversion step before the browser can render them faithfully.
            </p>
            {rawFileUrl && (
              <a
                href={rawFileUrl}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-3 py-2 text-xs text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-hover)]"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
                Open raw file
              </a>
            )}
          </div>
        </div>
      )}

      {preview.kind === 'text' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 text-whisper text-[color:var(--hv-fg-subtle)]">
            <div className="flex items-center gap-2">
              <FileCode2 size={13} />
              <span>
                {isMarkdownPreview
                  ? (preview.truncated ? 'Markdown preview truncated to 256KB' : 'Rendered markdown preview')
                  : isHtmlPreview
                    ? 'Rendered HTML preview'
                  : (preview.truncated
                    ? 'Preview truncated to 256KB'
                    : (readOnly || displayMode === 'preview' ? 'Text preview' : 'Editable text preview'))}
              </span>
            </div>
            {!readOnly && showTextActions && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--hv-border-hair)] px-2 py-1 text-xs hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save
              </button>
            )}
          </div>
          {isMarkdownPreview ? (
            <div
              className={cn(
                'flex-1 min-h-0 overflow-auto border-t px-6 py-4',
                'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]',
              )}
            >
              <article className="hervald-prose max-w-none break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {draftContent}
                </ReactMarkdown>
              </article>
            </div>
          ) : isHtmlPreview ? (
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden border-t',
                'border-[color:var(--hv-border-hair)] bg-white',
              )}
            >
              <iframe
                className="h-full w-full border-0"
                sandbox="allow-forms allow-popups allow-scripts"
                referrerPolicy="no-referrer"
                title={`Rendered HTML preview of ${preview.name}`}
                srcDoc={draftContent}
              />
            </div>
          ) : isReadOnlyTextPreview ? (
            <pre
              className={cn(
                'flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-words border-t p-4 font-mono text-xs leading-relaxed',
                'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg-muted)]',
              )}
            >
              {draftContent}
            </pre>
          ) : (
            <textarea
              className={cn(
                'flex-1 min-h-[14rem] resize-none border-t p-3 font-mono text-xs outline-none',
                'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg-muted)]',
              )}
              value={draftContent}
              onChange={(event) => onDraftChange(event.target.value)}
              readOnly={readOnly}
            />
          )}
        </div>
      )}
    </div>
  )
}

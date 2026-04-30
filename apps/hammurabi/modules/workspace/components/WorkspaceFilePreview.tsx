import { useEffect, useState } from 'react'
import { FileCode2, FileImage, FileWarning, Loader2, Pencil, Save, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getAccessToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WorkspaceFilePreview as WorkspaceFilePreviewData } from '../types'

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
  onInsertPath?: (path: string) => void
  variant?: 'light' | 'dark'
}

export function buildWorkspacePdfPreviewUrl(
  sessionId: string,
  path: string,
  accessToken?: string | null,
): string {
  const query = new URLSearchParams({ path })
  if (accessToken) {
    query.set('access_token', accessToken)
  }
  return `/api/agents/sessions/${encodeURIComponent(sessionId)}/workspace/raw?${query.toString()}`
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
  onInsertPath,
  variant = 'light',
}: WorkspaceFilePreviewProps) {
  const dark = variant === 'dark'
  const isMarkdownPreview = preview?.kind === 'text' && readOnly && preview.path.toLowerCase().endsWith('.md')
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const pdfPreviewSessionId = preview?.kind === 'pdf' && preview.workspace.source.kind === 'agent-session'
    ? preview.workspace.source.id
    : null
  const pdfPreviewPath = preview?.kind === 'pdf' ? preview.path : null

  useEffect(() => {
    let cancelled = false

    if (!pdfPreviewSessionId || !pdfPreviewPath) {
      setPdfPreviewUrl(null)
      return () => {
        cancelled = true
      }
    }

    setPdfPreviewUrl(null)
    void getAccessToken()
      .then((token) => {
        if (cancelled) {
          return
        }
        setPdfPreviewUrl(buildWorkspacePdfPreviewUrl(
          pdfPreviewSessionId,
          pdfPreviewPath,
          token,
        ))
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setPdfPreviewUrl(buildWorkspacePdfPreviewUrl(
          pdfPreviewSessionId,
          pdfPreviewPath,
        ))
      })

    return () => {
      cancelled = true
    }
  }, [pdfPreviewPath, pdfPreviewSessionId])

  if (!selectedPath) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center rounded-lg border border-dashed text-sm',
          dark
            ? 'border-white/[0.08] text-white/45'
            : 'border-ink-border text-sumi-diluted',
        )}
      >
        Select a file to preview it
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-sumi-diluted">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading preview…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-accent-vermillion/30 bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
        {error}
      </div>
    )
  }

  if (!preview) {
    return null
  }

  return (
    <div className={cn('h-full min-h-0 rounded-lg border flex flex-col overflow-hidden', dark ? 'border-white/[0.08] bg-[#1b1b1b]' : 'border-ink-border bg-washi-white')}>
      <div className={cn('flex items-center justify-between gap-3 border-b px-3 py-2', dark ? 'border-white/[0.08] bg-white/[0.03]' : 'border-ink-border bg-washi-aged/60')}>
        <div className="min-w-0">
          <p className={cn('truncate font-mono text-xs', dark ? 'text-white/75' : 'text-sumi-gray')}>
            {preview.path}
          </p>
          <p className={cn('text-whisper', dark ? 'text-white/45' : 'text-sumi-diluted')}>
            {preview.kind} • {preview.size} bytes
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onInsertPath && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs hover:bg-ink-wash"
              onClick={() => onInsertPath(preview.path)}
            >
              Add to context
            </button>
          )}
          {!readOnly && (
            <>
              <button type="button" className="rounded-md p-1.5 hover:bg-ink-wash" onClick={onRename} aria-label="Rename file">
                <Pencil size={13} />
              </button>
              <button type="button" className="rounded-md p-1.5 text-accent-vermillion hover:bg-accent-vermillion/10" onClick={onDelete} aria-label="Delete file">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {preview.kind === 'image' && preview.content && (
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-sumi-diluted">
            <FileImage size={15} />
            Image preview
          </div>
          <img src={preview.content} alt={preview.name} className="max-w-full rounded-lg border border-ink-border" />
        </div>
      )}

      {preview.kind === 'pdf' && (
        pdfPreviewUrl ? (
          <iframe
            src={pdfPreviewUrl}
            className="flex-1 w-full border-0"
            title={preview.path}
          />
        ) : pdfPreviewSessionId && pdfPreviewPath ? (
          <div className="flex flex-1 items-center justify-center px-4 text-sm text-sumi-diluted">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Loading PDF preview…
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-4 text-sm text-sumi-diluted">
            <FileWarning size={16} className="mr-2" />
            PDF preview is not available for this workspace source
          </div>
        )
      )}

      {preview.kind === 'binary' && (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-sumi-diluted">
          <FileWarning size={16} className="mr-2" />
          Binary file preview is not available
        </div>
      )}

      {preview.kind === 'text' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 text-whisper text-sumi-diluted">
            <div className="flex items-center gap-2">
              <FileCode2 size={13} />
              <span>
                {isMarkdownPreview
                  ? (preview.truncated ? 'Markdown preview truncated to 256KB' : 'Rendered markdown preview')
                  : (preview.truncated ? 'Preview truncated to 256KB' : 'Editable text preview')}
              </span>
            </div>
            {!readOnly && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-border px-2 py-1 text-xs hover:bg-ink-wash disabled:opacity-60"
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
                dark ? 'border-white/[0.08] bg-[#121212]' : 'border-ink-border bg-washi-white',
              )}
            >
              <article className={cn('prose prose-sm max-w-none break-words', dark && 'prose-invert')}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {draftContent}
                </ReactMarkdown>
              </article>
            </div>
          ) : (
            <textarea
              className={cn(
                'flex-1 min-h-[14rem] resize-none border-t p-3 font-mono text-xs outline-none',
                dark
                  ? 'border-white/[0.08] bg-[#121212] text-white/80'
                  : 'border-ink-border bg-washi-white text-sumi-gray',
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

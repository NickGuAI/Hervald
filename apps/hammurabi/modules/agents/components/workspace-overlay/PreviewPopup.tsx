import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { WorkspaceFilePreview as WorkspaceFilePreviewData } from '../../../workspace/types'
import { WorkspaceFilePreview } from '../../../workspace/components/WorkspaceFilePreview'

interface PreviewPopupProps {
  open: boolean
  selectedPath: string | null
  preview: WorkspaceFilePreviewData | null
  draftContent: string
  loading: boolean
  error: string | null
  onClose: () => void
}

export function PreviewPopup({
  open,
  selectedPath,
  preview,
  draftContent,
  loading,
  error,
  onClose,
}: PreviewPopupProps) {
  const desktopPanelRef = useRef<HTMLDivElement>(null)
  const mobilePanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (
        desktopPanelRef.current?.contains(target) ||
        mobilePanelRef.current?.contains(target)
      ) {
        return
      }
      onClose()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open, onClose])

  if (!open || !selectedPath) {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] md:pointer-events-none">
      <div className="absolute inset-0 bg-sumi-black/30 md:bg-sumi-black/15" />

      <div className="absolute inset-0 hidden items-center justify-center p-5 md:flex">
        <div
          ref={desktopPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Workspace file preview"
          className="pointer-events-auto flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-ink-border bg-washi-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
            <span className="font-mono text-xs text-sumi-gray">Preview</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-sumi-diluted transition-colors hover:bg-ink-wash"
              aria-label="Close preview"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly
            />
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 px-2 pb-2 pt-8 md:hidden">
        <div
          ref={mobilePanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Workspace file preview"
          className="flex max-h-[90dvh] min-h-[50dvh] flex-col overflow-hidden rounded-2xl border border-ink-border bg-washi-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
            <span className="font-mono text-xs text-sumi-gray">Preview</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-sumi-diluted transition-colors hover:bg-ink-wash"
              aria-label="Close preview"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 p-2">
            <WorkspaceFilePreview
              selectedPath={selectedPath}
              preview={preview}
              draftContent={draftContent}
              loading={loading}
              error={error}
              readOnly
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

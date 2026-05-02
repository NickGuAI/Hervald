/**
 * Hervald — WorkspaceModal
 *
 * Cmd+K overlay that reuses the shared workspace panel so Hervald reads the
 * same commander-scoped tree, git, and preview routes as the main workspace.
 */
import { useEffect } from 'react'
import { WorkspacePanel } from '@modules/workspace/components/WorkspacePanel'
import type { WorkspaceSource } from '@modules/workspace/use-workspace'

interface WorkspaceModalProps {
  open: boolean
  onClose: () => void
  source: WorkspaceSource | null
  onInsertPath?: (path: string) => void
}

export function WorkspaceModal({ open, onClose, source, onInsertPath }: WorkspaceModalProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div
      onClick={onClose}
      className="hv-dark"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(10,10,12,0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        animation: 'hvFadeIn 0.3s var(--hv-ease-gentle) both',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1240px, 100%)',
          height: 'min(780px, 90vh)',
        }}
      >
        {source ? (
          <WorkspacePanel
            source={source}
            position="embedded"
            variant="dark"
            onClose={onClose}
            onInsertPath={(path) => {
              onInsertPath?.(path)
              onClose()
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#18181b',
              color: '#a1a1aa',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '4px 18px 4px 18px',
              boxShadow: 'var(--hv-shadow-modal)',
              padding: 32,
              textAlign: 'center',
            }}
          >
            Select a commander to inspect its workspace.
          </div>
        )}
      </div>
    </div>
  )
}

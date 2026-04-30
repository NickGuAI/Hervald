import { useEffect, type ReactNode } from 'react'
import { FolderOpen, Image, X, Zap } from 'lucide-react'

export interface AddToChatSheetProps {
  open: boolean
  onClose: () => void
  onPickImage: () => void
  onPickSkill: () => void
  onPickFile: () => void
}

interface AddToChatTileProps {
  label: string
  description: string
  ariaLabel: string
  onClick: () => void
  children: ReactNode
}

function AddToChatTile({
  label,
  description,
  ariaLabel,
  onClick,
  children,
}: AddToChatTileProps) {
  return (
    <button
      type="button"
      className="add-to-chat-sheet-tile"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="add-to-chat-sheet-tile-icon" aria-hidden="true">
        {children}
      </span>
      <span className="add-to-chat-sheet-tile-label">{label}</span>
      <span className="add-to-chat-sheet-tile-description">{description}</span>
    </button>
  )
}

export function AddToChatSheet({
  open,
  onClose,
  onPickImage,
  onPickSkill,
  onPickFile,
}: AddToChatSheetProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <>
      <div
        className="sheet-backdrop visible sheet-backdrop--hervald add-to-chat-sheet-backdrop"
        onClick={onClose}
      />

      <div
        className="sheet visible sheet--hervald add-to-chat-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-chat-sheet-title"
        data-testid="add-to-chat-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle">
          <div className="sheet-handle-bar" />
        </div>

        <div className="add-to-chat-sheet-header">
          <button
            type="button"
            className="add-to-chat-sheet-close"
            onClick={onClose}
            aria-label="Close add to chat"
          >
            <X size={16} />
          </button>

          <h2 id="add-to-chat-sheet-title" className="add-to-chat-sheet-title">
            Add to Chat
          </h2>
        </div>

        <div className="add-to-chat-sheet-grid">
          <AddToChatTile
            label="Photos"
            description="Attach image files"
            ariaLabel="Add photos"
            onClick={() => {
              onClose()
              onPickImage()
            }}
          >
            <Image size={18} />
          </AddToChatTile>

          <AddToChatTile
            label="Skills"
            description="Insert a skill command"
            ariaLabel="Add skills"
            onClick={() => {
              onClose()
              onPickSkill()
            }}
          >
            <Zap size={18} />
          </AddToChatTile>

          <AddToChatTile
            label="Files"
            description="Open workspace picker"
            ariaLabel="Add files"
            onClick={() => {
              onClose()
              onPickFile()
            }}
          >
            <FolderOpen size={18} />
          </AddToChatTile>
        </div>
      </div>
    </>
  )
}

import { ModalFormContainer } from './ModalFormContainer'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  onClose: () => void
  onConfirm: () => void
  confirmLabel?: string
  cancelLabel?: string
  confirmTone?: 'neutral' | 'danger'
  bodyTestId?: string
}

export function ConfirmModal({
  open,
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmTone = 'neutral',
  bodyTestId,
}: ConfirmModalProps) {
  return (
    <ModalFormContainer
      open={open}
      title={title}
      onClose={onClose}
    >
      <div data-testid={bodyTestId} className="space-y-4">
        <p className="text-sm text-[color:var(--hv-fg-subtle)]">{message}</p>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-[color:var(--hv-border-hair)] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={[
            'rounded-full px-4 py-2 text-sm transition-colors',
            confirmTone === 'danger'
              ? 'bg-[var(--hv-accent-danger-wash)] text-[color:var(--hv-fg-inverse)] hover:bg-[var(--hv-accent-danger-wash)]'
              : 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)] hover:bg-[var(--hv-button-primary-bg)]',
          ].join(' ')}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalFormContainer>
  )
}

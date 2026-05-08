import { FormModal } from './FormModal'

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
    <FormModal
      open={open}
      title={title}
      onClose={onClose}
      bodyTestId={bodyTestId}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              'rounded-full px-4 py-2 text-sm transition-colors',
              confirmTone === 'danger'
                ? 'bg-accent-vermillion text-washi-white hover:bg-accent-vermillion/90'
                : 'bg-sumi-black text-washi-white hover:bg-sumi-black/90',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <p className="text-sm text-sumi-diluted">{message}</p>
    </FormModal>
  )
}

interface ToastProps {
  open: boolean
  message: string
  tone?: 'neutral' | 'error'
}

export function Toast({
  open,
  message,
  tone = 'neutral',
}: ToastProps) {
  if (!open) {
    return null
  }

  return (
    <div
      role="status"
      className={[
        'fixed bottom-24 right-4 z-50 max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-lg md:bottom-6',
        tone === 'error'
          ? 'border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] text-[color:var(--hv-accent-danger)]'
          : 'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)]',
      ].join(' ')}
    >
      {message}
    </div>
  )
}

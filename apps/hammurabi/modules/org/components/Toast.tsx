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
          ? 'border-accent-vermillion/40 bg-accent-vermillion/10 text-accent-vermillion'
          : 'border-ink-border bg-washi-white text-sumi-black',
      ].join(' ')}
    >
      {message}
    </div>
  )
}

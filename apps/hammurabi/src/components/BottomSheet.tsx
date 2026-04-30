import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  maxHeight?: string
  position?: 'bottom' | 'top'
  dark?: boolean
}

export default function BottomSheet({
  open,
  onClose,
  children,
  title,
  maxHeight = '85dvh',
  position = 'bottom',
  dark = false,
}: BottomSheetProps) {
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

  if (!open || typeof document === 'undefined') {
    return null
  }

  const anchoredToBottom = position === 'bottom'

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998] bg-sumi-black/50"
        onClick={onClose}
      />

      <div
        className={cn(
          'fixed inset-0 z-[9999] flex justify-center md:p-5',
          anchoredToBottom ? 'items-end md:items-center' : 'items-start md:items-center',
          dark && 'hv-dark',
        )}
      >
        <div
          className={cn(
            'flex w-full flex-col overflow-hidden bg-washi-white',
            anchoredToBottom
              ? 'rounded-t-2xl md:max-w-2xl md:rounded-xl'
              : 'rounded-b-2xl md:max-w-2xl md:rounded-xl',
          )}
          style={{ maxHeight }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex justify-center pb-1 pt-2">
            <div className="h-1 w-8 rounded-full bg-ink-border" />
          </div>

          {title ? (
            <div className="border-b border-ink-border px-4 pb-3 pt-2">
              <h2 className="font-display text-heading text-sumi-black">{title}</h2>
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}

import type { ReactNode } from 'react'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'

interface FormModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  contentClassName?: string
  bodyTestId?: string
}

export function FormModal({
  open,
  title,
  onClose,
  children,
  footer,
  contentClassName,
  bodyTestId,
}: FormModalProps) {
  return (
    <ModalFormContainer
      open={open}
      title={title}
      onClose={onClose}
      contentClassName={contentClassName}
    >
      <div data-testid={bodyTestId} className="space-y-4">
        {children}
      </div>
      {footer ? (
        <div className="flex items-center justify-end gap-3 border-t border-ink-border pt-4">
          {footer}
        </div>
      ) : null}
    </ModalFormContainer>
  )
}

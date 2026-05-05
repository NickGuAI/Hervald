import { useEffect, useState } from 'react'
import { runOrgCommanderNow } from '@modules/org/hooks/useOrgActions'
import { Field, FormModal } from '../components'

const TEXTAREA_CLASS =
  'min-h-28 w-full rounded-2xl border border-ink-border bg-washi-white px-4 py-2 text-sm text-sumi-black outline-none transition-colors focus:border-sumi-black resize-y'
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90 disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-60'

interface RunNowProps {
  open: boolean
  commanderId: string
  commanderDisplayName: string
  onClose: () => void
  onSuccess?: () => void
  onError?: (message: string) => void
}

export function RunNow({
  open,
  commanderId,
  commanderDisplayName,
  onClose,
  onSuccess,
  onError,
}: RunNowProps) {
  const [message, setMessage] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setMessage('')
    setIsPending(false)
    setGlobalError(null)
  }, [open, commanderId])

  function requestClose() {
    setIsPending(false)
    setGlobalError(null)
    onClose()
  }

  const trimmedMessage = message.trim()

  async function handleSubmit(): Promise<void> {
    if (!trimmedMessage) {
      return
    }

    setIsPending(true)
    setGlobalError(null)
    try {
      await runOrgCommanderNow(commanderId, trimmedMessage)
      onSuccess?.()
      requestClose()
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Failed to run commander now.'
      setGlobalError(nextMessage)
      onError?.(nextMessage)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <FormModal
      open={open}
      title="Run Commander Now"
      onClose={requestClose}
      bodyTestId="run-now-dialog"
      footer={(
        <>
          <button
            type="button"
            data-testid="run-now-close-button"
            onClick={requestClose}
            disabled={isPending}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="run-now-submit-button"
            onClick={() => void handleSubmit()}
            disabled={isPending || !trimmedMessage}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isPending ? 'Submitting...' : 'Run now'}
          </button>
        </>
      )}
    >
      {globalError ? (
        <div
          data-testid="run-now-error"
          className="rounded-2xl border border-accent-vermillion/30 bg-accent-vermillion/10 px-4 py-3 text-sm text-accent-vermillion"
        >
          {globalError}
        </div>
      ) : null}

      <p className="text-sm text-sumi-diluted">
        Send a task message to {commanderDisplayName}. The backend will start the commander if it is idle or deliver a follow-up if it is already running.
      </p>

      <Field
        label="Task Message"
        htmlFor="run-now-message-input"
        required
      >
        <textarea
          id="run-now-message-input"
          data-testid="run-now-message-input"
          value={message}
          onInput={(event) => setMessage(event.currentTarget.value)}
          onChange={(event) => setMessage(event.target.value)}
          className={TEXTAREA_CLASS}
        />
      </Field>
    </FormModal>
  )
}

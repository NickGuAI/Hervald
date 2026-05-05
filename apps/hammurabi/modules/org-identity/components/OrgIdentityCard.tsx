import { useEffect, useState, type FormEvent } from 'react'
import { Building2 } from 'lucide-react'
import { useOrgIdentity, useUpdateOrgIdentity } from '../hooks/useOrgIdentity'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-ink-border px-3 py-2 text-[16px] md:text-sm bg-washi-aged focus:outline-none focus:border-ink-border-hover'

function validateOrgName(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) {
    return 'Org name is required.'
  }
  if (normalized.length > 80) {
    return 'Org name must be 80 characters or fewer.'
  }
  if (/[\u0000-\u001f\u007f<>]/.test(normalized)) {
    return 'Org name contains unsupported characters.'
  }
  return null
}

export function OrgIdentityCard() {
  const { data: identity, error } = useOrgIdentity()
  const updateMutation = useUpdateOrgIdentity()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setName(identity?.name ?? '')
  }, [identity?.name])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateOrgName(name)
    if (validationError) {
      setFormError(validationError)
      return
    }

    setFormError(null)
    try {
      await updateMutation.mutateAsync({ name: name.trim() })
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to save org name.')
    }
  }

  const loadError = error instanceof Error ? error.message : null
  const isPending = updateMutation.isPending

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      data-testid="org-identity-card"
      className="card-sumi p-5 space-y-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="section-title">Org Identity</p>
          <p className="mt-2 text-sm leading-relaxed text-sumi-diluted">
            Set the organization name shown at the top of Org.
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-wash text-sumi-black">
          <Building2 size={16} aria-hidden="true" />
        </span>
      </div>

      <label className="block">
        <span className="section-title block">Organization Name</span>
        <input
          data-testid="org-identity-name-input"
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
          onChange={(event) => setName(event.target.value)}
          placeholder="Gehirn Inc."
          className={INPUT_CLASS}
          maxLength={80}
          required
        />
      </label>

      {loadError ? <p className="text-sm text-accent-vermillion">{loadError}</p> : null}
      {formError ? <p className="text-sm text-accent-vermillion">{formError}</p> : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-sumi-diluted">
          Stored locally in Hammurabi org identity.
        </p>
        <button
          type="submit"
          data-testid="org-identity-save-button"
          disabled={isPending}
          className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : 'Save Org'}
        </button>
      </div>
    </form>
  )
}

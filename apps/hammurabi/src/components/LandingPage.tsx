import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  ensureFreshAuthClientBeforeRedirect,
  resolveAuthReturnTo,
} from '@/lib/auth-build-guard'

interface LandingPageProps {
  onApiKeySubmit?: (key: string) => void
}

export function LandingPage({ onApiKeySubmit }: LandingPageProps) {
  const { loginWithRedirect, isLoading } = useAuth0()
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleApiKeySubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed || !onApiKeySubmit) return
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      // Validate key with an auth-required request
      const { getFullUrl } = await import('@/lib/api-base')
      const res = await fetch(getFullUrl('/api/modules'), {
        headers: { 'X-Hammurabi-Api-Key': trimmed },
      })
      if (!res.ok) {
        setSubmitError('Invalid API key or insufficient scopes. Check key and try again.')
        return
      }
      onApiKeySubmit(trimmed)
    } catch {
      setSubmitError('Connection failed. Check network and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (showApiKey && onApiKeySubmit) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--hv-bg-raised)]">
        <div className="card-sumi max-w-md w-full mx-4 p-12 animate-fade-in">
          <h1 className="font-display text-display text-[color:var(--hv-fg)] mb-2 text-center">
            Hervald
          </h1>
          <p className="text-sm font-body text-[color:var(--hv-fg-subtle)] mb-6 text-center">
            Sign in with an API key
          </p>

          <div className="divider-ink mb-6" />

          <form onSubmit={handleApiKeySubmit} className="space-y-4">
            <input
              type="password"
              placeholder="Paste your API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-fg-faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-field-focus-border)]"
              autoComplete="off"
              autoFocus
              disabled={isSubmitting}
            />
            {submitError && (
              <p className="text-sm text-[color:var(--hv-accent-danger)]" role="alert">
                {submitError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!apiKey.trim() || isSubmitting}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Verifying...' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={() => { setShowApiKey(false); setApiKey(''); setSubmitError(null) }}
                className="btn-ghost"
              >
                Back
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--hv-bg-raised)]">
      <div className="card-sumi max-w-md w-full mx-4 p-12 text-center animate-fade-in">
        <h1 className="font-display text-display text-[color:var(--hv-fg)] mb-2">
          Hervald
        </h1>
        <p className="text-sm font-body text-[color:var(--hv-fg-subtle)] mb-10">
          Orchestration shell for your operator team
        </p>

        <div className="divider-ink mb-10" />

        <button
          onClick={() => {
            setSignInError(null)
            const returnTo = resolveAuthReturnTo()
            void ensureFreshAuthClientBeforeRedirect(returnTo).then((isFresh) => {
              if (isFresh) {
                void loginWithRedirect({ appState: { returnTo } })
                return
              }
              setSignInError('Hervald is reconnecting. Try sign-in again after the gateway is healthy.')
            })
          }}
          disabled={isLoading}
          className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading...' : 'Sign in'}
        </button>

        {signInError ? (
          <p className="mt-4 text-sm leading-relaxed text-[color:var(--hv-accent-danger)]" role="status">
            {signInError}
          </p>
        ) : null}

        {onApiKeySubmit && (
          <button
            type="button"
            onClick={() => setShowApiKey(true)}
            className="btn-ghost w-full mt-3 text-sm"
          >
            Or sign in with API key
          </button>
        )}

        <p className="text-whisper text-[color:var(--hv-fg-faint)] mt-8 uppercase">
          Authenticated access only
        </p>
      </div>
    </div>
  )
}

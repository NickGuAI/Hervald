import { FormEvent, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { AlertTriangle, Copy, KeyRound, LogOut, QrCode, Smartphone, Trash2 } from 'lucide-react'
import {
  useApiKeys,
  useClearGeminiImageGenerationKey,
  useClearOpenAITranscriptionKey,
  useCreateApiKey,
  useCreateMobileAccessInvite,
  useGeminiImageGenerationSettings,
  useOpenAITranscriptionSettings,
  useRevokeApiKey,
  useSetGeminiImageGenerationKey,
  useSetOpenAITranscriptionKey,
  type CreatedApiKey,
  type MobileAccessInvite,
} from '@/hooks/use-api-keys'
import { useAuth } from '@/contexts/AuthContext'
import { timeAgo } from '@/lib/utils'
import { MagicBento, MagicBentoCard } from '@/components/MagicBento'
import { AccountProfileCard } from './components/AccountProfileCard'
import { OrgIdentityCard } from '@modules/org-identity/components/OrgIdentityCard'
import { ProviderAuthPanel } from '@modules/agents/components/ProviderAuthPanel'

const AVAILABLE_SCOPES = [
  { value: 'telemetry:read', label: 'Telemetry read' },
  { value: 'telemetry:write', label: 'Telemetry write' },
  { value: 'agents:read', label: 'Agents read' },
  { value: 'agents:write', label: 'Agents write' },
  {
    value: 'agents:admin',
    label: 'Agents admin',
    description: 'Grants elevated agent administration actions.',
  },
  { value: 'commanders:read', label: 'Commanders read' },
  { value: 'commanders:write', label: 'Commanders write' },
  { value: 'commanders:channels:write', label: 'Channel bindings write' },
  { value: 'org:write', label: 'Org write' },
  { value: 'services:read', label: 'Services read' },
  { value: 'services:write', label: 'Services write' },
  { value: 'skills:read', label: 'Skills read' },
  { value: 'skills:write', label: 'Skills write' },
] as const

const ALL_SCOPE_VALUES = AVAILABLE_SCOPES.map((s) => s.value)

const MOBILE_ACCESS_SCOPES = [
  'agents:read',
  'agents:write',
  'commanders:read',
  'commanders:write',
  'services:read',
  'services:write',
  'skills:read',
  'telemetry:read',
] as const

const MOBILE_INVITE_EXPIRY_OPTIONS = [
  { value: '900', label: '15 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '21600', label: '6 hours' },
  { value: '86400', label: '24 hours' },
] as const

type MobileInviteExpiryOption = (typeof MOBILE_INVITE_EXPIRY_OPTIONS)[number]['value']

const FIELD_CLASS =
  'w-full rounded-lg border border-[var(--hv-field-border)] bg-[var(--hv-field-bg)] px-3 py-2 text-[16px] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-field-placeholder)] focus:outline-none focus:border-[var(--hv-field-focus-border)] md:text-sm'

const ERROR_CLASS =
  'flex items-start gap-2 rounded-lg bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]'

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return expiresAt
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function ApiKeysPage() {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    ...AVAILABLE_SCOPES
      .filter((scope) => scope.value !== 'agents:admin')
      .map((scope) => scope.value),
  ])
  const [openAIApiKey, setOpenAIApiKey] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [mobileInviteExpiry, setMobileInviteExpiry] =
    useState<MobileInviteExpiryOption>('3600')
  const [mobileInvite, setMobileInvite] = useState<MobileAccessInvite | null>(null)
  const [mobileInviteQrDataUrl, setMobileInviteQrDataUrl] = useState<string | null>(null)
  const [mobileInviteCopyState, setMobileInviteCopyState] =
    useState<'idle' | 'copied'>('idle')

  const {
    data: keys = [],
    isLoading,
    error,
  } = useApiKeys()
  const createMutation = useCreateApiKey()
  const createMobileInviteMutation = useCreateMobileAccessInvite()
  const revokeMutation = useRevokeApiKey()
  const { data: transcriptionSettings, error: transcriptionSettingsError } =
    useOpenAITranscriptionSettings()
  const { data: geminiImageSettings, error: geminiImageSettingsError } =
    useGeminiImageGenerationSettings()
  const setOpenAIMutation = useSetOpenAITranscriptionKey()
  const clearOpenAIMutation = useClearOpenAITranscriptionKey()
  const setGeminiMutation = useSetGeminiImageGenerationKey()
  const clearGeminiMutation = useClearGeminiImageGenerationKey()

  const sortedKeys = useMemo(
    () =>
      [...keys].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [keys],
  )
  const mobileInvitePayload = mobileInvite?.qrPayload ?? mobileInvite?.invite ?? null
  const mobileScopes = mobileInvite?.scopes.length ? mobileInvite.scopes : MOBILE_ACCESS_SCOPES

  const createError =
    createMutation.error instanceof Error ? createMutation.error.message : null
  const mobileInviteError =
    createMobileInviteMutation.error instanceof Error
      ? createMobileInviteMutation.error.message
      : null
  const revokeError =
    revokeMutation.error instanceof Error ? revokeMutation.error.message : null
  const transcriptionError =
    (setOpenAIMutation.error instanceof Error
      ? setOpenAIMutation.error.message
      : null) ??
    (clearOpenAIMutation.error instanceof Error
      ? clearOpenAIMutation.error.message
      : null) ??
    (transcriptionSettingsError instanceof Error
      ? transcriptionSettingsError.message
      : null)
  const imageGenerationError =
    (setGeminiMutation.error instanceof Error
      ? setGeminiMutation.error.message
      : null) ??
    (clearGeminiMutation.error instanceof Error
      ? clearGeminiMutation.error.message
      : null) ??
    (geminiImageSettingsError instanceof Error
      ? geminiImageSettingsError.message
      : null)
  const listError = error instanceof Error ? error.message : null

  useEffect(() => {
    let cancelled = false
    setMobileInviteQrDataUrl(null)

    if (!mobileInvitePayload) {
      return () => {
        cancelled = true
      }
    }

    void QRCode.toDataURL(mobileInvitePayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 192,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setMobileInviteQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMobileInviteQrDataUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [mobileInvitePayload])

  async function handleCreateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      return
    }

    const created = await createMutation.mutateAsync({
      name: trimmedName,
      scopes: selectedScopes,
    })
    setName('')
    setCreatedKey(created)
    setCopyState('idle')
  }

  async function handleCopyKey() {
    if (!createdKey) {
      return
    }

    await navigator.clipboard.writeText(createdKey.key)
    setCopyState('copied')
  }

  async function handleCreateMobileInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const created = await createMobileInviteMutation.mutateAsync({
      expiresInSeconds: Number(mobileInviteExpiry),
      scopes: [...MOBILE_ACCESS_SCOPES],
    })
    setMobileInvite(created)
    setMobileInviteCopyState('idle')
  }

  async function handleCopyMobileInvite() {
    if (!mobileInvitePayload) {
      return
    }

    await navigator.clipboard.writeText(mobileInvitePayload)
    setMobileInviteCopyState('copied')
  }

  async function handleSaveOpenAIKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedKey = openAIApiKey.trim()
    if (!trimmedKey) {
      return
    }

    await setOpenAIMutation.mutateAsync(trimmedKey)
    setOpenAIApiKey('')
  }

  async function handleClearOpenAIKey() {
    const confirmed = window.confirm('Remove the OpenAI transcription key?')
    if (!confirmed) {
      return
    }

    await clearOpenAIMutation.mutateAsync()
  }

  async function handleSaveGeminiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedKey = geminiApiKey.trim()
    if (!trimmedKey) {
      return
    }

    await setGeminiMutation.mutateAsync(trimmedKey)
    setGeminiApiKey('')
  }

  async function handleClearGeminiKey() {
    const confirmed = window.confirm('Remove the Gemini image generation key?')
    if (!confirmed) {
      return
    }

    await clearGeminiMutation.mutateAsync()
  }

  return (
    <div className="px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto max-w-6xl">
        <div>
          <h2 className="font-display text-display text-[color:var(--hv-fg)]">Settings</h2>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--hv-fg-subtle)] leading-relaxed">
            Configure the founder profile, provider keys, and scoped API access for agents and scripts.
            Keys are shown only once at creation time.
          </p>
        </div>

        <MagicBento className="mt-6 md:mt-8" data-testid="settings-magic-bento">
          <MagicBentoCard span={6} data-testid="settings-bento-org">
            <OrgIdentityCard />
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-account">
            <AccountProfileCard />
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-provider-auth">
            <ProviderAuthPanel />
          </MagicBentoCard>

          <MagicBentoCard span={3} data-testid="settings-bento-transcription">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Transcription (OpenAI Realtime)</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    Mic input uses this key for live transcription.
                  </p>
                </div>
                <span
                  className={`badge-sumi ${
                    transcriptionSettings?.configured ? 'badge-active' : 'badge-idle'
                  }`}
                >
                  {transcriptionSettings?.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <form className="mt-4 space-y-3" onSubmit={handleSaveOpenAIKey}>
                <input
                  type="password"
                  value={openAIApiKey}
                  onChange={(event) => setOpenAIApiKey(event.target.value)}
                  placeholder={transcriptionSettings?.configured ? 'sk-... (stored)' : 'sk-...'}
                  className={FIELD_CLASS}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={setOpenAIMutation.isPending}
                    className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {setOpenAIMutation.isPending ? 'Saving...' : 'Save OpenAI Key'}
                  </button>
                  {transcriptionSettings?.configured && (
                    <button
                      type="button"
                      disabled={clearOpenAIMutation.isPending}
                      className="btn-ghost text-[color:var(--hv-accent-danger)] disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={handleClearOpenAIKey}
                    >
                      {clearOpenAIMutation.isPending ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              </form>

              {transcriptionSettings?.updatedAt && (
                <p className="mt-3 text-whisper text-[color:var(--hv-fg-faint)]">
                  Updated {timeAgo(transcriptionSettings.updatedAt)}
                </p>
              )}

              {transcriptionError && (
                <div className={`${ERROR_CLASS} mt-3`}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{transcriptionError}</span>
                </div>
              )}
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={3} data-testid="settings-bento-image-generation">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Image Generation (Gemini API)</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    Used by avatar generation in the commander edit form.
                  </p>
                  <p className="mt-2 text-sm text-[color:var(--hv-accent-danger)]">
                    This key is for avatar generation only. It is not the Gemini CLI provider key configured per machine.
                  </p>
                </div>
                <span
                  className={`badge-sumi ${
                    geminiImageSettings?.configured ? 'badge-active' : 'badge-idle'
                  }`}
                >
                  {geminiImageSettings?.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <form className="mt-4 space-y-3" onSubmit={handleSaveGeminiKey}>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(event) => setGeminiApiKey(event.target.value)}
                  placeholder={geminiImageSettings?.configured ? 'AIza... (stored)' : 'AIza...'}
                  className={FIELD_CLASS}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={setGeminiMutation.isPending}
                    className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {setGeminiMutation.isPending ? 'Saving...' : 'Save Gemini Key'}
                  </button>
                  {geminiImageSettings?.configured && (
                    <button
                      type="button"
                      disabled={clearGeminiMutation.isPending}
                      className="btn-ghost text-[color:var(--hv-accent-danger)] disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={handleClearGeminiKey}
                    >
                      {clearGeminiMutation.isPending ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              </form>

              {geminiImageSettings?.updatedAt && (
                <p className="mt-3 text-whisper text-[color:var(--hv-fg-faint)]">
                  Updated {timeAgo(geminiImageSettings.updatedAt)}
                </p>
              )}

              {imageGenerationError && (
                <div className={`${ERROR_CLASS} mt-3`}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{imageGenerationError}</span>
                </div>
              )}
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-mobile-access">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Mobile Access</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    Generate an expiring pairing invite for the iOS app.
                  </p>
                </div>
                <Smartphone size={20} className="mt-0.5 text-[color:var(--hv-fg-faint)]" />
              </div>

              <div className="mt-4">
                <p className="text-whisper text-[color:var(--hv-fg-faint)]">Mobile scopes</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {mobileScopes.map((scope) => (
                    <span key={scope} className="badge-sumi badge-active font-mono">
                      {scope}
                    </span>
                  ))}
                </div>
              </div>

              <form
                className="mt-4 space-y-3"
                data-testid="mobile-access-form"
                onSubmit={handleCreateMobileInvite}
              >
                <div>
                  <label htmlFor="mobile-access-expiry" className="section-title block mb-2">
                    Invite Expiry
                  </label>
                  <select
                    id="mobile-access-expiry"
                    name="mobile-access-expiry"
                    value={mobileInviteExpiry}
                    onChange={(event) =>
                      setMobileInviteExpiry(event.target.value as MobileInviteExpiryOption)
                    }
                    className={FIELD_CLASS}
                    data-testid="mobile-access-expiry-select"
                    required
                  >
                    <option value="" disabled>
                      -- Select expiry --
                    </option>
                    {MOBILE_INVITE_EXPIRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={createMobileInviteMutation.isPending}
                  className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <Smartphone size={14} />
                  {createMobileInviteMutation.isPending ? 'Generating...' : 'Generate Invite'}
                </button>

                {mobileInviteError && (
                  <div className={ERROR_CLASS}>
                    <AlertTriangle size={15} className="mt-0.5" />
                    <span>{mobileInviteError}</span>
                  </div>
                )}
              </form>

              {mobileInvite && mobileInvitePayload && (
                <div className="mt-5 rounded-lg border border-[var(--hv-accent-warning)] bg-[var(--hv-accent-warning-wash)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="section-title">Pairing Invite</p>
                      <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                        Expires {formatExpiry(mobileInvite.expiresAt)}
                      </p>
                      {mobileInvite.keyPrefix && (
                        <p className="mt-1 text-whisper font-mono text-[color:var(--hv-fg-faint)]">
                          {mobileInvite.keyPrefix}...
                        </p>
                      )}
                      {mobileInvite.instanceUrl && (
                        <p className="mt-1 text-whisper font-mono text-[color:var(--hv-fg-faint)]">
                          {mobileInvite.instanceUrl}
                        </p>
                      )}
                    </div>
                    {mobileInviteQrDataUrl ? (
                      <img
                        src={mobileInviteQrDataUrl}
                        alt="Mobile access pairing QR"
                        className="h-24 w-24 rounded-md border border-[var(--hv-border-hair)] bg-white p-1"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-md border border-[var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[color:var(--hv-fg-faint)]">
                        <QrCode size={28} />
                      </div>
                    )}
                  </div>
                  <code className="mt-3 block max-h-32 overflow-y-auto rounded-md bg-[var(--hv-bg-raised)] px-3 py-2 text-xs break-all text-[color:var(--hv-fg)]">
                    {mobileInvitePayload}
                  </code>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary inline-flex items-center gap-2"
                      onClick={handleCopyMobileInvite}
                    >
                      <Copy size={14} />
                      {mobileInviteCopyState === 'copied' ? 'Copied' : 'Copy invite'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setMobileInvite(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </MagicBentoCard>

          <MagicBentoCard span={6} data-testid="settings-bento-managed-keys">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-[var(--hv-border-hair)] pb-3">
                <span className="font-mono text-sm text-[color:var(--hv-fg)]">Managed Keys</span>
                <span className="text-whisper text-[color:var(--hv-fg-faint)]">{sortedKeys.length} keys</span>
              </div>

              {isLoading ? (
                <div className="py-5 text-sm text-[color:var(--hv-fg-subtle)]">Loading keys...</div>
              ) : (
                <div className="divide-y divide-[var(--hv-border-hair)]">
                  {sortedKeys.length === 0 ? (
                    <div className="py-5 text-sm text-[color:var(--hv-fg-subtle)]">No API keys yet.</div>
                  ) : (
                    sortedKeys.map((key) => (
                      <div
                        key={key.id}
                        className="py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-[color:var(--hv-fg)] font-medium">{key.name}</p>
                          <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)] font-mono truncate">
                            {key.prefix}...
                          </p>
                          <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
                            Created {timeAgo(key.createdAt)} by {key.createdBy}
                          </p>
                          <p className="text-whisper text-[color:var(--hv-fg-faint)]">
                            Last used {key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'never'}
                          </p>
                          {key.expiresAt && (
                            <p className="text-whisper text-[color:var(--hv-fg-faint)]">
                              Expires {formatExpiry(key.expiresAt)}
                            </p>
                          )}
                          <p className="mt-1 text-whisper text-[color:var(--hv-fg-subtle)]">
                            {key.scopes.length === 0
                              ? 'No scopes'
                              : `Scopes: ${key.scopes.join(', ')}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost inline-flex items-center gap-2 text-[color:var(--hv-accent-danger)] shrink-0 self-start"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(key.id)}
                        >
                          <Trash2 size={14} />
                          Revoke
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {(listError || revokeError) && (
                <div className={`${ERROR_CLASS} mt-3`}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{listError ?? revokeError}</span>
                </div>
              )}
            </div>
          </MagicBentoCard>

          {auth && (
            <MagicBentoCard span={3} data-testid="settings-bento-sign-out">
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <p className="section-title">Session</p>
                  <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                    End the current browser session.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={auth.signOut}
                  className="btn-ghost inline-flex items-center justify-center gap-2"
                >
                  <LogOut size={18} />
                  Sign out
                </button>
              </div>
            </MagicBentoCard>
          )}

          <MagicBentoCard span={9} data-testid="settings-bento-create-key">
            <form onSubmit={handleCreateKey} className="space-y-4">
              <div>
                <label className="section-title block mb-2">Key Name</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Telemetry Ingest Key"
                  className={FIELD_CLASS}
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="section-title block">Scopes</label>
                  <button
                    type="button"
                    className="text-whisper text-sm text-[color:var(--hv-fg-subtle)] hover:text-[color:var(--hv-fg-muted)]"
                    onClick={() => {
                      setSelectedScopes((current) =>
                        current.length === ALL_SCOPE_VALUES.length ? [] : [...ALL_SCOPE_VALUES],
                      )
                    }}
                  >
                    {selectedScopes.length === ALL_SCOPE_VALUES.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {AVAILABLE_SCOPES.map((scope) => {
                    const checked = selectedScopes.includes(scope.value)
                    return (
                      <label
                        key={scope.value}
                        className="flex items-start gap-2 text-sm text-[color:var(--hv-fg-muted)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedScopes((current) => {
                              if (event.target.checked) {
                                return [...new Set([...current, scope.value])]
                              }
                              return current.filter((value) => value !== scope.value)
                            })
                          }}
                        />
                        <span>
                          {scope.label}
                          {'description' in scope ? ` (${scope.description})` : ''}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                <KeyRound size={14} />
                {createMutation.isPending ? 'Creating...' : 'Create Key'}
              </button>

              {createError && (
                <div className={ERROR_CLASS}>
                  <AlertTriangle size={15} className="mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}
            </form>

            {createdKey && (
              <div className="mt-5 rounded-lg border border-[var(--hv-accent-warning)] bg-[var(--hv-accent-warning-wash)] p-4">
                <p className="section-title">Copy this key now</p>
                <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
                  This is the only time the raw key is visible.
                </p>
                <code className="mt-3 block rounded-md bg-[var(--hv-bg-raised)] px-3 py-2 text-xs break-all text-[color:var(--hv-fg)]">
                  {createdKey.key}
                </code>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-2"
                    onClick={handleCopyKey}
                  >
                    <Copy size={14} />
                    {copyState === 'copied' ? 'Copied' : 'Copy key'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setCreatedKey(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </MagicBentoCard>
        </MagicBento>
      </div>
    </div>
  )
}

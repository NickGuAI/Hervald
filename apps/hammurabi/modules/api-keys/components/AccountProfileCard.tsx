import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useFounderProfile,
  useUpdateFounderProfile,
  useUploadFounderAvatar,
} from '@modules/operators/hooks/useFounderProfile'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-ink-border px-3 py-2 text-[16px] md:text-sm bg-washi-aged focus:outline-none focus:border-ink-border-hover'

function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || 'Operator'
  const [first = 'O', second = 'P'] = source.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function isFounderMissingError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Founder operator not found')
}

export function AccountProfileCard() {
  const auth = useAuth()
  const { data: founder, error } = useFounderProfile()
  const updateProfileMutation = useUpdateFounderProfile()
  const uploadAvatarMutation = useUploadFounderAvatar()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [displayName, setDisplayName] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(founder?.displayName ?? auth?.user?.name ?? '')
  }, [auth?.user?.name, founder?.displayName])

  useEffect(() => () => {
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview)
    }
  }, [avatarPreview])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (!nextFile) {
      return
    }

    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview)
    }

    setAvatarFile(nextFile)
    setAvatarPreview(URL.createObjectURL(nextFile))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextDisplayName = displayName.trim()
    if (!nextDisplayName) {
      setFormError('Display name is required.')
      return
    }

    setFormError(null)

    try {
      const updatedFounder = await updateProfileMutation.mutateAsync({
        displayName: nextDisplayName,
      })

      if (avatarFile) {
        await uploadAvatarMutation.mutateAsync({ file: avatarFile })
        setAvatarFile(null)
        if (avatarPreview) {
          URL.revokeObjectURL(avatarPreview)
          setAvatarPreview(null)
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }

      setDisplayName(updatedFounder.displayName)
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to save profile.')
    }
  }

  const liveDisplayName = founder?.displayName ?? auth?.user?.name ?? 'Operator'
  const liveEmail = founder?.email ?? auth?.user?.email ?? 'Signed in with an API key'
  const avatarSrc = avatarPreview ?? founder?.avatarUrl ?? auth?.user?.picture ?? null
  const isPending = updateProfileMutation.isPending || uploadAvatarMutation.isPending
  const loadError = isFounderMissingError(error) ? null : error instanceof Error ? error.message : null

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="card-sumi p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="section-title">Account Profile</p>
          <p className="mt-2 text-sm text-sumi-diluted leading-relaxed">
            Set the founder name and image shown in Org and mobile settings.
          </p>
        </div>
        <span className={`badge-sumi ${founder ? 'badge-active' : 'badge-idle'}`}>
          {founder ? 'Live' : 'Bootstrap'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={liveDisplayName}
            className="h-16 w-16 rounded-full border border-ink-border object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-ink-border bg-washi-aged font-display text-xl italic text-sumi-black">
            {initials(liveDisplayName, liveEmail)}
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-medium text-sumi-black">{liveDisplayName}</p>
          <p className="truncate font-mono text-[11px] text-sumi-diluted">{liveEmail}</p>

          <input
            ref={fileInputRef}
            data-testid="account-profile-avatar-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            data-testid="account-profile-avatar-button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1.5 min-h-[36px]"
          >
            <ImagePlus size={12} />
            {avatarSrc ? 'Change Image' : 'Choose Image'}
          </button>
          {avatarFile ? (
            <p className="text-whisper text-sumi-diluted truncate max-w-[220px]">
              {avatarFile.name}
            </p>
          ) : null}
        </div>
      </div>

      <label className="block">
        <span className="section-title block">Display Name</span>
        <input
          id="account-profile-display-name"
          data-testid="account-profile-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Nick Gu"
          className={INPUT_CLASS}
          required
        />
      </label>

      {loadError ? <p className="text-sm text-accent-vermillion">{loadError}</p> : null}
      {formError ? <p className="text-sm text-accent-vermillion">{formError}</p> : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-sumi-diluted">
          Founder identity persists even when Auth0 returns a synthetic subject.
        </p>
        <button
          type="submit"
          data-testid="account-profile-save-button"
          disabled={isPending}
          className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {isPending ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </form>
  )
}

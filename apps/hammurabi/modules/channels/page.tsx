import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useOrgTree } from '@modules/org/hooks/useOrgTree'
import {
  useChannels,
  useCreateChannelBinding,
  useDeleteChannelBinding,
  useUpdateChannelBinding,
} from './hooks/useChannels'
import type { CommanderChannelProvider } from './types'

const PROVIDERS: Array<{ value: CommanderChannelProvider; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
]

const INPUT_CLASS =
  'w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm'

export default function ChannelsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: orgTree } = useOrgTree()
  const commanders = orgTree?.commanders ?? []
  const requestedCommanderId = searchParams.get('commander')
  const [selectedCommanderId, setSelectedCommanderId] = useState(requestedCommanderId ?? '')
  const [provider, setProvider] = useState<CommanderChannelProvider>('whatsapp')
  const [accountId, setAccountId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (requestedCommanderId) {
      setSelectedCommanderId(requestedCommanderId)
      return
    }
    if (!selectedCommanderId && commanders[0]) {
      setSelectedCommanderId(commanders[0].id)
    }
  }, [commanders, requestedCommanderId, selectedCommanderId])

  const selectedCommander = useMemo(
    () => commanders.find((commander) => commander.id === selectedCommanderId) ?? null,
    [commanders, selectedCommanderId],
  )
  const { data: bindings = [], error } = useChannels(selectedCommanderId || null)
  const createMutation = useCreateChannelBinding()
  const updateMutation = useUpdateChannelBinding()
  const deleteMutation = useDeleteChannelBinding()

  function handleCommanderChange(nextCommanderId: string) {
    setSelectedCommanderId(nextCommanderId)
    const nextParams = new URLSearchParams(searchParams)
    if (nextCommanderId) {
      nextParams.set('commander', nextCommanderId)
    } else {
      nextParams.delete('commander')
    }
    setSearchParams(nextParams, { replace: true })
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCommanderId) {
      setFormError('Select a commander.')
      return
    }
    if (!accountId.trim() || !displayName.trim()) {
      setFormError('Account ID and display name are required.')
      return
    }

    setFormError(null)
    try {
      await createMutation.mutateAsync({
        commanderId: selectedCommanderId,
        provider,
        accountId: accountId.trim(),
        displayName: displayName.trim(),
        enabled: true,
        config: {},
      })
      setAccountId('')
      setDisplayName('')
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'Failed to add channel.')
    }
  }

  const mutationError =
    formError
    ?? (error instanceof Error ? error.message : null)
    ?? (updateMutation.error instanceof Error ? updateMutation.error.message : null)
    ?? (deleteMutation.error instanceof Error ? deleteMutation.error.message : null)

  return (
    <div className="px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <h1 className="font-display text-display text-sumi-black">Channels</h1>
          <p className="mt-2 text-sm leading-relaxed text-sumi-diluted">
            Configure outbound channel bindings per commander.
          </p>
        </div>

        <section className="card-sumi p-5">
          <label className="block">
            <span className="section-title block">Commander</span>
            <select
              value={selectedCommanderId}
              onChange={(event) => handleCommanderChange(event.target.value)}
              className={INPUT_CLASS}
              required
            >
              <option value="">— Select Commander —</option>
              {commanders.map((commander) => (
                <option key={commander.id} value={commander.id}>
                  {commander.displayName}
                </option>
              ))}
            </select>
          </label>
        </section>

        <form onSubmit={(event) => void handleCreate(event)} className="card-sumi grid gap-4 p-5 md:grid-cols-4">
          <label className="block">
            <span className="section-title block">Provider</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as CommanderChannelProvider)}
              className={INPUT_CLASS}
              required
            >
              {PROVIDERS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="section-title block">Account ID</span>
            <input
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="account-main"
              className={INPUT_CLASS}
              required
            />
          </label>

          <label className="block">
            <span className="section-title block">Display Name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Main WhatsApp"
              className={INPUT_CLASS}
              required
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={createMutation.isPending || !selectedCommander}
              className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Channel'}
            </button>
          </div>
        </form>

        {mutationError ? (
          <p className="text-sm text-accent-vermillion">{mutationError}</p>
        ) : null}

        <section className="card-sumi p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Bindings</p>
              <p className="mt-2 text-sm text-sumi-diluted">
                {selectedCommander ? selectedCommander.displayName : 'Select a commander'} channel bindings.
              </p>
            </div>
            <span className="badge-sumi badge-idle">{bindings.length}</span>
          </div>

          <div className="mt-5 space-y-3">
            {bindings.length > 0 ? bindings.map((binding) => (
              <div
                key={binding.id}
                className="flex flex-col gap-3 rounded-2xl border border-ink-border p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-sumi-black">{binding.displayName}</p>
                  <p className="mt-1 font-mono text-xs text-sumi-diluted">
                    {binding.provider} · {binding.accountId}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-sumi-black">
                    <input
                      type="checkbox"
                      checked={binding.enabled}
                      onChange={(event) => {
                        void updateMutation.mutateAsync({
                          commanderId: selectedCommanderId,
                          bindingId: binding.id,
                          enabled: event.target.checked,
                        })
                      }}
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${binding.displayName}`}
                    onClick={() => {
                      void deleteMutation.mutateAsync({
                        commanderId: selectedCommanderId,
                        bindingId: binding.id,
                      })
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-border text-accent-vermillion transition-colors hover:bg-ink-wash"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )) : (
              <p className="text-sm text-sumi-diluted">(no channel bindings)</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

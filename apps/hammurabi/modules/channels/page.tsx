import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  Hash,
  Mail,
  MessageCircle,
  MessageSquare,
  Plug,
  QrCode,
  Save,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'
import { useOrgTree } from '@modules/org/hooks/useOrgTree'
import {
  useBeginChannelPairing,
  useChannelPairingStatus,
  useChannelStatus,
  useChannelProviderDescriptors,
  useChannels,
  useCompleteChannelPairing,
  useCreateChannelBinding,
  useDeleteChannelBinding,
  useUpdateChannelBinding,
} from './hooks/useChannels'
import type {
  ChannelDescriptorField,
  ChannelProviderDescriptor,
  ChannelPairingChallenge,
  CommanderChannelBinding,
  CommanderChannelProvider,
} from './types'

const INPUT_CLASS =
  'w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none focus:border-ink-border-hover md:text-sm'
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-ink-border text-sumi-black focus:ring-sumi-black/20'

type ChannelFormValue = string | boolean
type ChannelFormState = Record<string, ChannelFormValue>

function fieldFormKey(field: ChannelDescriptorField): string {
  return field.formKey ?? field.key
}

function isIdentityField(field: ChannelDescriptorField): boolean {
  const key = fieldFormKey(field)
  return field.section === 'identity' || key === 'accountId' || key === 'displayName'
}

function isEmptyFormValue(value: ChannelFormValue | undefined): boolean {
  return typeof value === 'boolean'
    ? false
    : !value?.trim()
}

function normalizeFormValue(field: ChannelDescriptorField, value: unknown): ChannelFormValue {
  if (field.kind === 'checkbox') {
    return typeof value === 'boolean' ? value : false
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).join('\n')
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (field.configPath?.endsWith('Ms') && fieldFormKey(field).endsWith('Seconds')) {
      return String(Math.max(1, Math.trunc(value / 1000)))
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return typeof value === 'string' ? value : ''
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    return (current as Record<string, unknown>)[part]
  }, source)
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1] ?? path] = value
}

function cloneConfigDefaults(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value)
}

function textareaToList(value: string): string[] {
  return [...new Set(value
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean))]
}

function formValueForConfig(field: ChannelDescriptorField, value: ChannelFormValue | undefined): unknown {
  if (field.kind === 'checkbox') {
    return value === true
  }
  if (field.kind === 'textarea') {
    return textareaToList(typeof value === 'string' ? value : '')
  }
  const text = typeof value === 'string' ? value.trim() : ''
  if (field.secret && !text) {
    return undefined
  }
  if (!text && field.defaultValue === undefined) {
    return undefined
  }
  if (field.kind === 'number') {
    const parsed = Number(text || field.defaultValue)
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
    if (normalized === undefined) {
      return undefined
    }
    return field.configPath?.endsWith('Ms') && fieldFormKey(field).endsWith('Seconds')
      ? Math.max(1, normalized) * 1000
      : normalized
  }
  return text || normalizeFormValue(field, field.defaultValue)
}

function formStateFromDescriptor(
  descriptor: ChannelProviderDescriptor,
  commanderId: string,
  binding?: CommanderChannelBinding,
): ChannelFormState {
  const state: ChannelFormState = {}
  for (const field of descriptor.fields) {
    const key = fieldFormKey(field)
    const defaultValue = descriptor.formDefaults[key] ?? field.defaultValue ?? ''
    state[key] = normalizeFormValue(field, defaultValue)
  }
  const commanderBindingKey = descriptor.commanderBinding.fieldKey
  if (commanderBindingKey) {
    state[commanderBindingKey] = descriptor.bindingState?.defaultCommanderId ?? commanderId
  }
  if (!binding) {
    return state
  }

  state.accountId = binding.accountId
  state.displayName = binding.displayName
  const config = binding.config && typeof binding.config === 'object'
    ? binding.config as Record<string, unknown>
    : {}
  for (const field of descriptor.fields) {
    const key = fieldFormKey(field)
    if (key === 'accountId' || key === 'displayName') {
      continue
    }
    const configValue = field.configPath ? readPath(config, field.configPath) : config[key]
    if (configValue !== undefined) {
      state[key] = normalizeFormValue(field, configValue)
    }
  }
  return state
}

function buildConfigFromDescriptor(
  descriptor: ChannelProviderDescriptor,
  state: ChannelFormState,
): Record<string, unknown> {
  const config = cloneConfigDefaults(descriptor.configDefaults)
  for (const field of descriptor.fields) {
    const key = fieldFormKey(field)
    if (key === 'accountId' || key === 'displayName') {
      continue
    }
    const value = formValueForConfig(field, state[key])
    if (value === undefined) {
      continue
    }
    setPath(config, field.configPath ?? key, value)
  }
  return config
}

function requiredFieldError(
  descriptor: ChannelProviderDescriptor,
  state: ChannelFormState,
  options: { existingCredentialConfigured?: boolean } = {},
): string | null {
  const missing = descriptor.fields.find((field) => {
    if (!field.required) {
      return false
    }
    if (field.secret && options.existingCredentialConfigured && isEmptyFormValue(state[fieldFormKey(field)])) {
      return false
    }
    return isEmptyFormValue(state[fieldFormKey(field)])
  })
  return missing ? `${missing.label} is required.` : null
}

function providerLabel(descriptor: ChannelProviderDescriptor | null, fallback: string): string {
  return descriptor?.label ?? fallback
}

function providerIcon(provider: CommanderChannelProvider): LucideIcon {
  switch (provider) {
    case 'email':
      return Mail
    case 'whatsapp':
      return MessageCircle
    case 'googlechat':
      return MessageSquare
    case 'telegram':
      return Send
    case 'discord':
      return Hash
    default:
      return Plug
  }
}

function providerIsConnected(bindings: CommanderChannelBinding[] | undefined): boolean {
  return bindings?.some((binding) => binding.enabled) ?? false
}

export default function ChannelsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: orgTree } = useOrgTree()
  const commanders = orgTree?.commanders ?? []
  const requestedCommanderId = searchParams.get('commander')
  const [selectedCommanderId, setSelectedCommanderId] = useState(requestedCommanderId ?? '')
  const [provider, setProvider] = useState<CommanderChannelProvider>('')
  const [formByProvider, setFormByProvider] = useState<Record<string, ChannelFormState>>({})
  const [pairingChallenge, setPairingChallenge] = useState<ChannelPairingChallenge | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [channelModalOpen, setChannelModalOpen] = useState(false)
  const completingPairingIdRef = useRef<string | null>(null)

  const { data: providerDescriptorResponse } = useChannelProviderDescriptors(selectedCommanderId || null)
  const providerDescriptors = providerDescriptorResponse?.providers ?? []
  const selectedProviderDescriptor = providerDescriptors.find((entry) => entry.provider === provider) ?? null
  const selectedForm = selectedProviderDescriptor
    ? formByProvider[provider] ?? formStateFromDescriptor(selectedProviderDescriptor, selectedCommanderId)
    : {}

  useEffect(() => {
    if (requestedCommanderId) {
      setSelectedCommanderId(requestedCommanderId)
      return
    }
    if (!selectedCommanderId && commanders[0]) {
      setSelectedCommanderId(commanders[0].id)
    }
  }, [commanders, requestedCommanderId, selectedCommanderId])

  useEffect(() => {
    if (providerDescriptors.length === 0) {
      return
    }
    if (provider && providerDescriptors.some((entry) => entry.provider === provider)) {
      return
    }
    setProvider(providerDescriptors[0]?.provider ?? '')
  }, [provider, providerDescriptors])

  useEffect(() => {
    if (!selectedProviderDescriptor || formByProvider[provider]) {
      return
    }
    setFormByProvider((current) => ({
      ...current,
      [provider]: formStateFromDescriptor(selectedProviderDescriptor, selectedCommanderId),
    }))
  }, [formByProvider, provider, selectedCommanderId, selectedProviderDescriptor])

  const selectedCommander = useMemo(
    () => commanders.find((commander) => commander.id === selectedCommanderId) ?? null,
    [commanders, selectedCommanderId],
  )
  const { data: bindings = [], error } = useChannels(selectedCommanderId || null)
  const bindingsByProvider = useMemo(() => {
    const grouped = new Map<CommanderChannelProvider, CommanderChannelBinding[]>()
    for (const binding of bindings) {
      grouped.set(binding.provider, [...(grouped.get(binding.provider) ?? []), binding])
    }
    return grouped
  }, [bindings])
  const selectedProviderBindings = provider
    ? bindingsByProvider.get(provider) ?? []
    : []
  const selectedEnabledBinding = selectedProviderBindings.find((binding) => binding.enabled) ?? null
  const shouldPollSelectedProviderStatus = Boolean(
    selectedEnabledBinding && selectedProviderDescriptor?.pairing.mode !== 'none',
  )
  const { data: selectedProviderStatus } = useChannelStatus(
    selectedEnabledBinding?.commanderId ?? '',
    selectedEnabledBinding?.id ?? '',
    shouldPollSelectedProviderStatus,
  )
  const selectedProviderConnected = Boolean(
    selectedEnabledBinding && (!shouldPollSelectedProviderStatus || selectedProviderStatus?.connected === true),
  )
  const createMutation = useCreateChannelBinding()
  const beginPairingMutation = useBeginChannelPairing()
  const completePairingMutation = useCompleteChannelPairing()
  const pairingProvider = pairingChallenge?.provider ?? provider
  const pairingStatusQuery = useChannelPairingStatus(
    selectedCommanderId || null,
    pairingChallenge?.id ?? null,
    pairingProvider,
    pairingChallenge?.accountId ?? null,
    Boolean(pairingChallenge),
  )
  const updateMutation = useUpdateChannelBinding()
  const deleteMutation = useDeleteChannelBinding()
  const activePairingChallenge = pairingStatusQuery.data ?? pairingChallenge
  const activePairingState = pairingStatusQuery.data?.state ?? (pairingChallenge ? 'pairing' : null)
  const activePairingConnected = Boolean(pairingStatusQuery.data?.connected || activePairingChallenge?.kind === 'connected')

  function updateSelectedForm(updater: (current: ChannelFormState) => ChannelFormState) {
    if (!selectedProviderDescriptor) {
      return
    }
    setFormByProvider((current) => {
      const previous = current[provider] ?? formStateFromDescriptor(selectedProviderDescriptor, selectedCommanderId)
      return { ...current, [provider]: updater(previous) }
    })
  }

  function handleCommanderChange(nextCommanderId: string) {
    setSelectedCommanderId(nextCommanderId)
    setFormByProvider({})
    setPairingChallenge(null)
    setChannelModalOpen(false)
    completingPairingIdRef.current = null
    const nextParams = new URLSearchParams(searchParams)
    if (nextCommanderId) {
      nextParams.set('commander', nextCommanderId)
    } else {
      nextParams.delete('commander')
    }
    setSearchParams(nextParams, { replace: true })
  }

  function handleOpenChannelModal(nextProvider: CommanderChannelProvider) {
    setProvider(nextProvider)
    setPairingChallenge(null)
    setFormError(null)
    setChannelModalOpen(true)
    completingPairingIdRef.current = null
  }

  function handleCloseChannelModal() {
    setChannelModalOpen(false)
    setPairingChallenge(null)
    setFormError(null)
    completingPairingIdRef.current = null
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCommanderId) {
      setFormError('Select a commander.')
      return
    }
    if (!selectedProviderDescriptor) {
      setFormError('Select a provider.')
      return
    }
    const validationError = requiredFieldError(selectedProviderDescriptor, selectedForm)
    if (validationError) {
      setFormError(validationError)
      return
    }

    const nextAccountId = typeof selectedForm.accountId === 'string' ? selectedForm.accountId.trim() : ''
    const nextDisplayName = typeof selectedForm.displayName === 'string' ? selectedForm.displayName.trim() : ''
    const config = buildConfigFromDescriptor(selectedProviderDescriptor, selectedForm)

    setFormError(null)
    try {
      if (selectedProviderDescriptor.pairing.mode !== 'none') {
        const challenge = await beginPairingMutation.mutateAsync({
          commanderId: selectedCommanderId,
          provider,
          accountId: nextAccountId || undefined,
          displayName: nextDisplayName,
          config,
        })
        setPairingChallenge(challenge)
        completingPairingIdRef.current = null
        return
      }

      await createMutation.mutateAsync({
        commanderId: selectedCommanderId,
        provider,
        accountId: nextAccountId,
        displayName: nextDisplayName,
        enabled: true,
        config,
      })
      setFormByProvider((current) => ({
        ...current,
        [provider]: formStateFromDescriptor(selectedProviderDescriptor, selectedCommanderId),
      }))
      setPairingChallenge(null)
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'Failed to add channel.')
    }
  }

  async function handleCompletePairing() {
    if (!selectedCommanderId || !pairingChallenge?.id || !selectedProviderDescriptor) {
      return
    }
    completingPairingIdRef.current = pairingChallenge.id
    setFormError(null)
    try {
      await completePairingMutation.mutateAsync({
        commanderId: selectedCommanderId,
        provider: pairingProvider,
        challengeId: pairingChallenge.id,
        accountId: (pairingChallenge.accountId ?? (typeof selectedForm.accountId === 'string' ? selectedForm.accountId.trim() : '')) || undefined,
        displayName: typeof selectedForm.displayName === 'string' ? selectedForm.displayName.trim() : '',
        config: buildConfigFromDescriptor(selectedProviderDescriptor, selectedForm),
      })
      setFormByProvider((current) => ({
        ...current,
        [provider]: formStateFromDescriptor(selectedProviderDescriptor, selectedCommanderId),
      }))
      setPairingChallenge(null)
      completingPairingIdRef.current = null
    } catch (completeError) {
      completingPairingIdRef.current = null
      setFormError(completeError instanceof Error ? completeError.message : 'Failed to complete channel pairing.')
    }
  }

  useEffect(() => {
    if (!selectedCommanderId || !pairingChallenge?.id || !pairingStatusQuery.data?.connected) {
      return
    }
    if (completePairingMutation.isPending || completingPairingIdRef.current === pairingChallenge.id) {
      return
    }
    void handleCompletePairing()
  }, [
    completePairingMutation.isPending,
    pairingChallenge?.id,
    pairingStatusQuery.data?.connected,
    selectedCommanderId,
  ])

  const mutationError =
    formError
    ?? (error instanceof Error ? error.message : null)
    ?? (beginPairingMutation.error instanceof Error ? beginPairingMutation.error.message : null)
    ?? (pairingStatusQuery.error instanceof Error ? pairingStatusQuery.error.message : null)
    ?? (completePairingMutation.error instanceof Error ? completePairingMutation.error.message : null)
    ?? (updateMutation.error instanceof Error ? updateMutation.error.message : null)
    ?? (deleteMutation.error instanceof Error ? deleteMutation.error.message : null)

  return (
    <div className="px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <h1 className="font-display text-display text-sumi-black">Channels</h1>
        </div>

        <section className="card-sumi p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] md:items-end">
            <div>
              <p className="section-title">Selected commander</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-ink-border bg-washi-aged font-display text-lg text-sumi-black">
                  {selectedCommander?.displayName.slice(0, 1).toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-sumi-black">
                    {selectedCommander?.displayName ?? 'Select a commander'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-sumi-diluted">
                    {selectedCommander?.id ?? 'No commander selected'}
                  </p>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="section-title block">Commander</span>
              <select
                value={selectedCommanderId}
                onChange={(event) => handleCommanderChange(event.target.value)}
                className={INPUT_CLASS}
                required
              >
                <option value="">Select Commander</option>
                {commanders.map((commander) => (
                  <option key={commander.id} value={commander.id}>
                    {commander.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 border-t border-ink-border pt-4">
            <p className="section-title">Support channels</p>
            <ChannelProviderStrip
              descriptors={providerDescriptors}
              bindingsByProvider={bindingsByProvider}
              commanderName={selectedCommander?.displayName ?? 'selected commander'}
              activeProvider={channelModalOpen ? provider : ''}
              disabled={!selectedCommander}
              onOpen={handleOpenChannelModal}
            />
          </div>
        </section>

        <ModalFormContainer
          open={channelModalOpen && Boolean(selectedProviderDescriptor)}
          title={selectedProviderDescriptor ? `Pair ${selectedProviderDescriptor.label}` : 'Pair Channel'}
          onClose={handleCloseChannelModal}
          desktopClassName="max-w-5xl"
          mobileClassName="max-h-[96dvh]"
        >
          {selectedProviderDescriptor ? (
            <form onSubmit={(event) => void handleCreate(event)} className="grid gap-4">
              <section className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="section-title">{selectedProviderDescriptor.label}</p>
                    <p className="mt-1 text-sm text-sumi-diluted">
                      {selectedCommander?.displayName ?? 'Selected commander'}
                    </p>
                  </div>
                  <span
                    data-testid="channel-modal-provider-status"
                    className={[
                      'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium',
                      selectedProviderConnected
                        ? 'border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)]'
                        : 'border-ink-border bg-washi-white text-sumi-diluted',
                    ].join(' ')}
                  >
                    {selectedProviderConnected ? (
                      <Check size={12} aria-hidden="true" />
                    ) : null}
                    {selectedProviderConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              </section>

              <div className="grid gap-4 md:grid-cols-3">
                <DescriptorFields
                  fields={selectedProviderDescriptor.fields.filter(isIdentityField)}
                  state={selectedForm}
                  descriptor={selectedProviderDescriptor}
                  commanders={commanders}
                  onChange={updateSelectedForm}
                />
              </div>

              <DescriptorFieldSections
                fields={selectedProviderDescriptor.fields.filter((field) => !isIdentityField(field))}
                state={selectedForm}
                descriptor={selectedProviderDescriptor}
                commanders={commanders}
                onChange={updateSelectedForm}
              />

              {activePairingChallenge ? (
                <section className="rounded-xl border border-ink-border bg-washi-aged p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <QrCode size={18} aria-hidden="true" />
                        <p className="section-title">
                          {providerLabel(selectedProviderDescriptor, String(pairingProvider))} Pairing
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-sumi-diluted">{activePairingChallenge.instructions}</p>
                      <p className="mt-2 font-mono text-xs text-sumi-diluted">
                        {activePairingChallenge.accountId} · {activePairingState ?? 'pending'} · expires {activePairingChallenge.expiresAt ?? 'soon'}
                      </p>
                    </div>
                    {activePairingChallenge.url ? (
                      <img
                        src={activePairingChallenge.url}
                        alt={`${providerLabel(selectedProviderDescriptor, String(pairingProvider))} pairing QR`}
                        className="h-52 w-52 rounded-lg border border-ink-border bg-washi-white p-2"
                      />
                    ) : null}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void pairingStatusQuery.refetch()}
                      disabled={completePairingMutation.isPending || activePairingConnected || pairingStatusQuery.isFetching}
                      className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {completePairingMutation.isPending || activePairingConnected
                        ? 'Completing...'
                        : pairingStatusQuery.isFetching
                          ? 'Checking...'
                          : 'Check Status'}
                    </button>
                  </div>
                </section>
              ) : null}

              {mutationError ? (
                <p className="text-sm text-accent-vermillion" role="alert">{mutationError}</p>
              ) : null}

              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={createMutation.isPending || beginPairingMutation.isPending || !selectedCommander || !selectedProviderDescriptor}
                  className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createMutation.isPending || beginPairingMutation.isPending
                    ? 'Adding...'
                    : selectedProviderDescriptor.pairing.mode === 'none'
                      ? 'Add Channel'
                      : 'Start Pairing'}
                </button>
              </div>

              {selectedProviderBindings.length > 0 ? (
                <section className="grid gap-3 border-t border-ink-border pt-4">
                  <div>
                    <p className="section-title">Connected bindings</p>
                    <p className="mt-1 text-sm text-sumi-diluted">
                      {selectedProviderBindings.length} {selectedProviderBindings.length === 1 ? 'binding' : 'bindings'} for {selectedProviderDescriptor.label}
                    </p>
                  </div>
                  {selectedProviderBindings.map((binding) => (
                    <BindingRow
                      key={binding.id}
                      binding={binding}
                      commanderId={selectedCommanderId}
                      commanders={commanders}
                      updateBinding={(input) => updateMutation.mutateAsync(input)}
                      deleteBinding={(bindingId) => deleteMutation.mutateAsync({
                        commanderId: selectedCommanderId,
                        bindingId,
                      })}
                    />
                  ))}
                </section>
              ) : null}
            </form>
          ) : null}
        </ModalFormContainer>

        {mutationError && !channelModalOpen ? (
          <p className="text-sm text-accent-vermillion">{mutationError}</p>
        ) : null}

        <section className="card-sumi p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Bindings</p>
              <p className="mt-2 text-sm text-sumi-diluted">
                {selectedCommander ? selectedCommander.displayName : 'Select a commander'}
              </p>
            </div>
            <span className="badge-sumi badge-idle">{bindings.length}</span>
          </div>

          <div className="mt-5 space-y-3">
            {bindings.length > 0 ? bindings.map((binding) => (
              <BindingRow
                key={binding.id}
                binding={binding}
                commanderId={selectedCommanderId}
                commanders={commanders}
                updateBinding={(input) => updateMutation.mutateAsync(input)}
                deleteBinding={(bindingId) => deleteMutation.mutateAsync({
                  commanderId: selectedCommanderId,
                  bindingId,
                })}
              />
            )) : (
              <p className="text-sm text-sumi-diluted">(no channel bindings)</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ChannelProviderStrip(props: {
  descriptors: ChannelProviderDescriptor[]
  bindingsByProvider: Map<CommanderChannelProvider, CommanderChannelBinding[]>
  commanderName: string
  activeProvider: CommanderChannelProvider
  disabled: boolean
  onOpen: (provider: CommanderChannelProvider) => void
}) {
  if (props.descriptors.length === 0) {
    return (
      <p className="mt-3 text-sm text-sumi-diluted">(no channel providers)</p>
    )
  }

  return (
    <div
      className="mt-3 flex flex-wrap gap-3"
      role="group"
      aria-label={`Support channels for ${props.commanderName}`}
      data-testid="channel-provider-strip"
    >
      {props.descriptors.map((descriptor) => {
        return (
          <ChannelProviderButton
            key={descriptor.provider}
            descriptor={descriptor}
            bindings={props.bindingsByProvider.get(descriptor.provider) ?? []}
            commanderName={props.commanderName}
            active={props.activeProvider === descriptor.provider}
            disabled={props.disabled}
            onOpen={props.onOpen}
          />
        )
      })}
    </div>
  )
}

function ChannelProviderButton(props: {
  descriptor: ChannelProviderDescriptor
  bindings: CommanderChannelBinding[]
  commanderName: string
  active: boolean
  disabled: boolean
  onOpen: (provider: CommanderChannelProvider) => void
}) {
  const Icon = providerIcon(props.descriptor.provider)
  const binding = props.bindings.find((candidate) => candidate.enabled) ?? null
  const shouldPollStatus = Boolean(binding && props.descriptor.pairing.mode !== 'none')
  const { data: channelStatus } = useChannelStatus(binding?.commanderId ?? '', binding?.id ?? '', shouldPollStatus)
  const connected = Boolean(binding && (!shouldPollStatus || channelStatus?.connected === true))

  return (
    <button
      type="button"
      data-testid={`channel-provider-${props.descriptor.provider}`}
      data-connected={connected ? 'true' : 'false'}
      aria-pressed={props.active}
      aria-label={`${props.descriptor.label} channel for ${props.commanderName}: ${connected ? 'connected' : 'not connected'}. Open pairing and configuration.`}
      title={`${props.descriptor.label} ${connected ? 'connected' : 'not connected'}`}
      disabled={props.disabled}
      onClick={() => props.onOpen(props.descriptor.provider)}
      className={[
        'relative inline-flex min-h-14 min-w-16 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--hv-accent-info)] disabled:cursor-not-allowed disabled:opacity-60',
        connected
          ? 'border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] text-[color:var(--hv-accent-success)]'
          : 'border-ink-border bg-washi-aged text-sumi-black hover:bg-ink-wash',
        props.active ? 'ring-2 ring-[color:var(--hv-accent-info)]' : '',
      ].join(' ')}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="max-w-24 truncate">{props.descriptor.label}</span>
      {connected ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--hv-accent-success)] bg-washi-white text-[color:var(--hv-accent-success)]">
          <Check size={12} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  )
}

function DescriptorFieldSections(props: {
  fields: ChannelDescriptorField[]
  state: ChannelFormState
  descriptor: ChannelProviderDescriptor
  commanders: Array<{ id: string; displayName: string }>
  onChange: (updater: (current: ChannelFormState) => ChannelFormState) => void
}) {
  const sections = props.fields.reduce<Record<string, ChannelDescriptorField[]>>((grouped, field) => {
    const section = field.section ?? 'configuration'
    grouped[section] = [...(grouped[section] ?? []), field]
    return grouped
  }, {})

  return (
    <div className="grid gap-4 border-t border-ink-border pt-4">
      {Object.entries(sections).map(([section, fields]) => (
        <section key={section} className="grid gap-3">
          <p className="section-title">{section}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <DescriptorFields
              fields={fields}
              state={props.state}
              descriptor={props.descriptor}
              commanders={props.commanders}
              onChange={props.onChange}
            />
          </div>
        </section>
      ))}
    </div>
  )
}

function DescriptorFields(props: {
  fields: ChannelDescriptorField[]
  state: ChannelFormState
  descriptor: ChannelProviderDescriptor
  commanders: Array<{ id: string; displayName: string }>
  onChange: (updater: (current: ChannelFormState) => ChannelFormState) => void
}) {
  return (
    <>
      {props.fields.map((field) => (
        <DescriptorField
          key={fieldFormKey(field)}
          field={field}
          value={props.state[fieldFormKey(field)]}
          descriptor={props.descriptor}
          commanders={props.commanders}
          onChange={(value) => {
            props.onChange((current) => ({ ...current, [fieldFormKey(field)]: value }))
          }}
        />
      ))}
    </>
  )
}

function DescriptorField(props: {
  field: ChannelDescriptorField
  value: ChannelFormValue | undefined
  descriptor: ChannelProviderDescriptor
  commanders: Array<{ id: string; displayName: string }>
  onChange: (value: ChannelFormValue) => void
}) {
  const { field } = props
  const value = props.value ?? normalizeFormValue(field, props.descriptor.formDefaults[fieldFormKey(field)] ?? field.defaultValue ?? '')
  const commanderBindingKey = props.descriptor.commanderBinding.fieldKey

  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-sumi-black">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => props.onChange(event.target.checked)}
          className={CHECKBOX_CLASS}
        />
        {field.label}
      </label>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <label className="block">
        <span className="section-title block">{field.label}</span>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => props.onChange(event.target.value)}
          className={`${INPUT_CLASS} min-h-28`}
          placeholder={field.placeholder}
          required={field.required}
        />
        {field.helperText ? (
          <span className="mt-1 block font-mono text-xs text-sumi-diluted">{field.helperText}</span>
        ) : null}
      </label>
    )
  }

  if (field.kind === 'select' || fieldFormKey(field) === commanderBindingKey) {
    const options = fieldFormKey(field) === commanderBindingKey
      ? [
          { value: '', label: props.descriptor.commanderBinding.emptyLabel ?? 'None' },
          ...props.commanders.map((commander) => ({ value: commander.id, label: commander.displayName })),
        ]
      : field.options ?? []
    return (
      <label className="block">
        <span className="section-title block">{field.label}</span>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => props.onChange(event.target.value)}
          className={INPUT_CLASS}
          required={field.required}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    )
  }

  if (field.kind === 'static' || field.readonly) {
    const text = typeof value === 'string' && value
      ? value
      : field.options?.find((option) => option.value === field.defaultValue)?.label ?? String(field.defaultValue ?? '')
    return (
      <label className="block">
        <span className="section-title block">{field.label}</span>
        <div className={INPUT_CLASS}>{text}</div>
      </label>
    )
  }

  return (
    <label className="block">
      <span className="section-title block">{field.label}</span>
      <input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={field.placeholder}
        className={INPUT_CLASS}
        required={field.required}
        type={field.kind === 'password' ? 'password' : field.kind}
        min={field.min}
      />
      {field.helperText ? (
        <span className="mt-1 block font-mono text-xs text-sumi-diluted">{field.helperText}</span>
      ) : null}
    </label>
  )
}

function BindingRow(props: {
  binding: CommanderChannelBinding
  commanderId: string
  commanders: Array<{ id: string; displayName: string }>
  updateBinding: ReturnType<typeof useUpdateChannelBinding>['mutateAsync']
  deleteBinding: (bindingId: string) => Promise<unknown>
}) {
  const { binding, commanderId, commanders, updateBinding, deleteBinding } = props
  const [expanded, setExpanded] = useState(false)
  const { data: providerDescriptorResponse } = useChannelProviderDescriptors(commanderId || null)
  const descriptor = providerDescriptorResponse?.providers.find((entry) => entry.provider === binding.provider) ?? null
  const [formState, setFormState] = useState<ChannelFormState>({})
  const shouldPollStatus = expanded && descriptor?.pairing.mode !== 'none'
  const { data: channelStatus } = useChannelStatus(commanderId, binding.id, shouldPollStatus)

  useEffect(() => {
    if (!descriptor) {
      return
    }
    setFormState(formStateFromDescriptor(descriptor, commanderId, binding))
  }, [binding, commanderId, descriptor])

  async function saveConfig() {
    if (!descriptor) {
      return
    }
    const validationError = requiredFieldError(descriptor, formState, {
      existingCredentialConfigured: credentialConfigured,
    })
    if (validationError) {
      throw new Error(validationError)
    }
    await updateBinding({
      commanderId,
      bindingId: binding.id,
      displayName: typeof formState.displayName === 'string' && formState.displayName.trim()
        ? formState.displayName.trim()
        : binding.displayName,
      config: buildConfigFromDescriptor(descriptor, formState),
    })
    setFormState((current) => {
      const next = { ...current }
      for (const field of descriptor.fields) {
        if (field.secret) {
          next[fieldFormKey(field)] = ''
        }
      }
      return next
    })
  }

  const credentialConfigured = binding.config?.credentialConfigured === true || binding.config?.accessTokenConfigured === true
  const configurableFields = descriptor?.fields.filter((field) => fieldFormKey(field) !== 'accountId') ?? []

  return (
    <div className="rounded-2xl border border-ink-border p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-sumi-black">{binding.displayName}</p>
          <p className="mt-1 font-mono text-xs text-sumi-diluted">
            {binding.provider} · {binding.accountId}
            {credentialConfigured ? ' · credential set' : ''}
            {channelStatus ? ` · ${channelStatus.state}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {descriptor ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="rounded-lg border border-ink-border px-3 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash"
            >
              Configure
            </button>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-sumi-black">
            <input
              type="checkbox"
              checked={binding.enabled}
              onChange={(event) => {
                void updateBinding({
                  commanderId,
                  bindingId: binding.id,
                  enabled: event.target.checked,
                })
              }}
              className={CHECKBOX_CLASS}
            />
            Enabled
          </label>
          <button
            type="button"
            aria-label={`Remove ${binding.displayName}`}
            onClick={() => {
              void deleteBinding(binding.id)
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-border text-accent-vermillion transition-colors hover:bg-ink-wash"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {descriptor && expanded ? (
        <div className="mt-4 border-t border-ink-border pt-4">
          {channelStatus ? (
            <div className="mb-4 rounded-lg border border-ink-border bg-washi-aged px-3 py-2">
              <p className="section-title">Status</p>
              <p className="mt-1 font-mono text-xs text-sumi-diluted">
                {channelStatus.transport ?? binding.provider}:{channelStatus.state}
              </p>
            </div>
          ) : null}
          <DescriptorFieldSections
            fields={configurableFields}
            state={formState}
            descriptor={descriptor}
            commanders={commanders}
            onChange={(updater) => setFormState((current) => updater(current))}
          />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                void saveConfig()
              }}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Save size={16} aria-hidden="true" />
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

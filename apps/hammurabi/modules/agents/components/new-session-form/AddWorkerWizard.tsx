import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import {
  createMachine,
  setupMachineAuth,
  useMachineAuthStatus,
} from '@/hooks/use-agents'
import type {
  Machine,
  MachineAuthMode,
  MachineAuthProvider,
} from '@/types'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'

const INPUT_CLASS =
  'w-full rounded-lg border border-ink-border px-3 py-2 text-[16px] md:text-sm bg-washi-white focus:outline-none focus:ring-1 focus:ring-sumi-black/20 placeholder:text-sumi-mist'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[96px] resize-y`
const GUIDE_URL = 'https://github.com/example-org/example-repo/blob/release-2604/apps/hammurabi/docs/provider-auth-setup.md'
const PROVIDER_ORDER: MachineAuthProvider[] = ['claude', 'codex', 'gemini']

interface AddWorkerWizardProps {
  open: boolean
  onClose: () => void
  onMachineReady?: (machine: Machine) => void
  initialMachine?: Machine | null
}

interface ProviderDraftState {
  mode: MachineAuthMode
  secret: string
  isSubmitting: boolean
  error: string | null
}

const INITIAL_PROVIDER_DRAFTS: Record<MachineAuthProvider, ProviderDraftState> = {
  claude: {
    mode: 'setup-token',
    secret: '',
    isSubmitting: false,
    error: null,
  },
  codex: {
    mode: 'api-key',
    secret: '',
    isSubmitting: false,
    error: null,
  },
  gemini: {
    mode: 'api-key',
    secret: '',
    isSubmitting: false,
    error: null,
  },
}

const INITIAL_PROVIDER_SELECTION: Record<MachineAuthProvider, boolean> = {
  claude: true,
  codex: true,
  gemini: true,
}

function slugifyMachineId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'worker'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildSshCommand(machine: Machine, innerCommand: string): string {
  const destination = machine.user ? `${machine.user}@${machine.host}` : (machine.host ?? 'worker')
  const portPart = machine.port ? `-p ${machine.port} ` : ''
  return `ssh ${portPart}${destination} ${shellQuote(innerCommand)}`
}

function providerActionLabel(provider: MachineAuthProvider, mode: MachineAuthMode): string {
  if (provider === 'codex' && mode === 'device-auth') {
    return 'Prepare device auth'
  }
  if (provider === 'claude') {
    return 'Save token and verify'
  }
  if (provider === 'codex') {
    return 'Save API key and verify'
  }
  return 'Save API key and verify'
}

export function AddWorkerWizard({
  open,
  onClose,
  onMachineReady,
  initialMachine = null,
}: AddWorkerWizardProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<1 | 2>(initialMachine ? 2 : 1)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [host, setHost] = useState(initialMachine?.host ?? '')
  const [label, setLabel] = useState(initialMachine?.label ?? '')
  const [user, setUser] = useState(initialMachine?.user ?? '')
  const [port, setPort] = useState(initialMachine?.port ? String(initialMachine.port) : '')
  const [cwd, setCwd] = useState(initialMachine?.cwd ?? '')
  const [isCreating, setIsCreating] = useState(false)
  const [machine, setMachine] = useState<Machine | null>(initialMachine)
  const [selectedProviders, setSelectedProviders] = useState<Record<MachineAuthProvider, boolean>>(
    INITIAL_PROVIDER_SELECTION,
  )
  const [providerDrafts, setProviderDrafts] = useState<Record<MachineAuthProvider, ProviderDraftState>>(
    INITIAL_PROVIDER_DRAFTS,
  )

  useEffect(() => {
    if (!open) {
      return
    }

    setStep(initialMachine ? 2 : 1)
    setConnectionError(null)
    setHost(initialMachine?.host ?? '')
    setLabel(initialMachine?.label ?? '')
    setUser(initialMachine?.user ?? '')
    setPort(initialMachine?.port ? String(initialMachine.port) : '')
    setCwd(initialMachine?.cwd ?? '')
    setIsCreating(false)
    setMachine(initialMachine)
    setSelectedProviders(INITIAL_PROVIDER_SELECTION)
    setProviderDrafts(INITIAL_PROVIDER_DRAFTS)
  }, [initialMachine, open])

  const derivedMachineId = useMemo(
    () => slugifyMachineId(label.trim() || host.trim()),
    [host, label],
  )

  const authStatusQuery = useMachineAuthStatus(machine?.id, open && machine !== null)
  const authStatus = authStatusQuery.data
  const machineLabel = (machine?.label ?? label.trim()) || 'Worker'
  const machineHost = machine?.host ?? host.trim()

  const canFinish = PROVIDER_ORDER.every((provider) => {
    if (!selectedProviders[provider]) {
      return true
    }
    return authStatus?.providers[provider].configured === true
  })

  async function handleCreateMachine(): Promise<void> {
    const trimmedHost = host.trim()
    const trimmedLabel = label.trim() || trimmedHost
    const trimmedUser = user.trim()
    const trimmedCwd = cwd.trim()

    if (!trimmedHost) {
      setConnectionError('Hostname or IP address is required.')
      return
    }

    const parsedPort = port.trim() ? Number.parseInt(port.trim(), 10) : undefined
    if (port.trim() && (!Number.isInteger(parsedPort) || (parsedPort ?? 0) <= 0 || (parsedPort ?? 0) > 65535)) {
      setConnectionError('SSH port must be between 1 and 65535.')
      return
    }

    if (trimmedCwd && !trimmedCwd.startsWith('/')) {
      setConnectionError('Workspace directory must be an absolute path.')
      return
    }

    setIsCreating(true)
    setConnectionError(null)

    try {
      const created = await createMachine({
        id: derivedMachineId,
        label: trimmedLabel,
        host: trimmedHost,
        ...(trimmedUser ? { user: trimmedUser } : {}),
        ...(parsedPort ? { port: parsedPort } : {}),
        ...(trimmedCwd ? { cwd: trimmedCwd } : {}),
      })
      setMachine(created)
      setStep(2)
      await queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] })
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Failed to add worker.')
    } finally {
      setIsCreating(false)
    }
  }

  function updateProviderDraft(
    provider: MachineAuthProvider,
    updates: Partial<ProviderDraftState>,
  ): void {
    setProviderDrafts((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        ...updates,
      },
    }))
  }

  async function handleProviderSetup(provider: MachineAuthProvider): Promise<void> {
    if (!machine) {
      return
    }

    const draft = providerDrafts[provider]
    const needsSecret = draft.mode !== 'device-auth'
    if (needsSecret && draft.secret.trim().length < 12) {
      updateProviderDraft(provider, { error: 'Paste a valid token or API key first.' })
      return
    }

    updateProviderDraft(provider, { isSubmitting: true, error: null })

    try {
      await setupMachineAuth(machine.id, {
        provider,
        mode: draft.mode,
        ...(needsSecret ? { secret: draft.secret.trim() } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] })
      await authStatusQuery.refetch()
      if (provider !== 'codex' || draft.mode !== 'device-auth') {
        updateProviderDraft(provider, { secret: '' })
      }
    } catch (error) {
      updateProviderDraft(
        provider,
        { error: error instanceof Error ? error.message : 'Failed to save provider credentials.' },
      )
    } finally {
      updateProviderDraft(provider, { isSubmitting: false })
    }
  }

  function handleProviderSkip(provider: MachineAuthProvider): void {
    setSelectedProviders((current) => ({
      ...current,
      [provider]: false,
    }))
    updateProviderDraft(provider, { error: null, secret: '' })
  }

  function handleFinish(): void {
    if (machine) {
      onMachineReady?.(machine)
    }
    onClose()
  }

  return (
    <ModalFormContainer
      open={open}
      onClose={onClose}
      title={step === 1 ? 'Add Worker' : 'Worker Provider Auth'}
      contentClassName="space-y-4"
    >
      <div className="rounded-lg border border-ink-border bg-washi-white px-4 py-3">
        <div className="text-xs uppercase tracking-[0.18em] text-sumi-diluted">
          {step === 1 ? 'Step 1 of 2' : 'Step 2 of 2'}
        </div>
        <div className="mt-1 text-sm text-sumi-black">
          {step === 1
            ? 'Register the worker first, then configure provider auth on the same machine.'
            : `Configure Claude, Codex, and Gemini on ${machineLabel}.`}
        </div>
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-sumi-black">
              <span className="text-whisper uppercase tracking-wide text-sumi-diluted">Worker label</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Workshop Mac Mini"
                className={INPUT_CLASS}
              />
            </label>

            <label className="space-y-1 text-sm text-sumi-black">
              <span className="text-whisper uppercase tracking-wide text-sumi-diluted">Hostname or IP</span>
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="tail2bb6ea.ts.net"
                className={INPUT_CLASS}
              />
            </label>

            <label className="space-y-1 text-sm text-sumi-black">
              <span className="text-whisper uppercase tracking-wide text-sumi-diluted">SSH user</span>
              <input
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="yugu"
                className={INPUT_CLASS}
              />
            </label>

            <label className="space-y-1 text-sm text-sumi-black">
              <span className="text-whisper uppercase tracking-wide text-sumi-diluted">SSH port</span>
              <input
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="22"
                className={INPUT_CLASS}
                inputMode="numeric"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm text-sumi-black">
            <span className="text-whisper uppercase tracking-wide text-sumi-diluted">Workspace directory</span>
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/Users/yugu/workspace"
              className={INPUT_CLASS}
            />
          </label>

          <div className="rounded-lg border border-dashed border-ink-border px-3 py-2 text-sm text-sumi-diluted">
            Worker ID preview: <span className="font-mono text-sumi-black">{derivedMachineId}</span>
          </div>

          {connectionError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {connectionError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreateMachine()}
              className="btn-primary inline-flex items-center gap-2"
              disabled={isCreating}
            >
              {isCreating ? <Loader2 size={14} className="animate-spin" /> : null}
              Continue to provider auth
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-ink-border bg-washi-white px-4 py-3 text-sm text-sumi-black">
            <div className="font-medium">{machineLabel}</div>
            <div className="mt-1 text-sumi-diluted">
              {machineHost}
              {machine?.user ? ` as ${machine.user}` : ''}
              {machine?.port ? ` on port ${machine.port}` : ''}
            </div>
            {authStatus?.envFile ? (
              <div className="mt-2 font-mono text-xs text-sumi-diluted">
                env file: {authStatus.envFile}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-border bg-washi-white px-4 py-3 text-sm">
            <div className="text-sumi-diluted">
              Need the manual commands? The full guide stays in the repo docs.
            </div>
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sumi-black underline underline-offset-2"
            >
              Provider auth guide
              <ExternalLink size={14} />
            </a>
          </div>

          {authStatusQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-ink-border bg-washi-white px-4 py-3 text-sm text-sumi-diluted">
              <Loader2 size={14} className="animate-spin" />
              Checking worker provider status…
            </div>
          ) : null}

          {authStatusQuery.error ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {authStatusQuery.error instanceof Error
                ? authStatusQuery.error.message
                : 'Could not read provider auth status.'}
            </div>
          ) : null}

          {PROVIDER_ORDER.map((provider) => {
            const status = authStatus?.providers[provider]
            const draft = providerDrafts[provider]
            const selected = selectedProviders[provider]
            const sshCommand = machine
              ? provider === 'claude'
                ? buildSshCommand(machine, 'claude setup-token')
                : provider === 'codex'
                  ? buildSshCommand(machine, 'codex login --device-auth')
                  : buildSshCommand(machine, 'gemini')
              : ''

            return (
              <div key={provider} className="rounded-xl border border-ink-border bg-washi-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => setSelectedProviders((current) => ({
                        ...current,
                        [provider]: event.target.checked,
                      }))}
                      className="mt-1 h-4 w-4 rounded border-ink-border"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-sumi-black">
                          {status?.label ?? provider}
                        </div>
                        <a
                          href={GUIDE_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-sumi-diluted underline underline-offset-2"
                        >
                          Guide
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <div className="mt-1 text-sm text-sumi-diluted">
                        {provider === 'claude'
                          ? 'Run setup-token on the worker, paste the token here, then verify before dispatching Claude sessions.'
                          : provider === 'codex'
                            ? 'Use an OpenAI API key or device-auth on the worker. Device-auth keeps the Codex auth cache on disk.'
                            : 'Paste a Gemini API key. The wizard also enables file-backed Gemini storage on the worker.'}
                      </div>
                    </div>
                  </label>

                  <div className="rounded-full border border-ink-border px-2.5 py-1 text-xs uppercase tracking-wide text-sumi-diluted">
                    {status?.configured
                      ? 'ready'
                      : selected
                        ? (status?.installed === false ? 'cli missing' : 'pending')
                        : 'skipped'}
                  </div>
                </div>

                {status ? (
                  <div className="mt-3 grid gap-2 text-xs text-sumi-diluted md:grid-cols-2">
                    <div>Version: <span className="font-mono text-sumi-black">{status.version ?? 'missing'}</span></div>
                    <div>Detected auth: <span className="font-mono text-sumi-black">{status.currentMethod}</span></div>
                    <div>Env source: <span className="font-mono text-sumi-black">{status.envSourceKey ?? 'missing'}</span></div>
                    <div>Verification: <span className="font-mono text-sumi-black">{status.verificationCommand}</span></div>
                  </div>
                ) : null}

                {selected ? (
                  <div className="mt-4 space-y-3">
                    {provider === 'codex' ? (
                      <label className="space-y-1 text-sm text-sumi-black">
                        <span className="text-whisper uppercase tracking-wide text-sumi-diluted">Auth mode</span>
                        <select
                          value={draft.mode}
                          onChange={(event) => updateProviderDraft(provider, {
                            mode: event.target.value === 'device-auth' ? 'device-auth' : 'api-key',
                            error: null,
                          })}
                          className={INPUT_CLASS}
                        >
                          <option value="api-key">OpenAI API key</option>
                          <option value="device-auth">Device auth</option>
                        </select>
                      </label>
                    ) : null}

                    {provider === 'claude' ? (
                      <div className="rounded-lg border border-dashed border-ink-border px-3 py-2 text-sm text-sumi-diluted">
                        1. Run on the worker:
                        <div className="mt-2 font-mono text-xs text-sumi-black">{sshCommand}</div>
                        <div className="mt-2">2. Paste the resulting token below and verify it.</div>
                      </div>
                    ) : null}

                    {provider === 'codex' && draft.mode === 'device-auth' ? (
                      <div className="rounded-lg border border-dashed border-ink-border px-3 py-2 text-sm text-sumi-diluted">
                        1. Click <strong>Prepare device auth</strong> once so the worker stores Codex credentials in <span className="font-mono">~/.codex/auth.json</span>.
                        <div className="mt-2">2. Run on the worker:</div>
                        <div className="mt-2 font-mono text-xs text-sumi-black">{sshCommand}</div>
                        <div className="mt-2">3. Complete the device-code prompt, then refresh status here.</div>
                      </div>
                    ) : null}

                    {provider === 'gemini' ? (
                      <div className="rounded-lg border border-dashed border-ink-border px-3 py-2 text-sm text-sumi-diluted">
                        This phase 1 flow stores <span className="font-mono">GEMINI_API_KEY</span> in the worker env file and sets <span className="font-mono">GEMINI_FORCE_FILE_STORAGE=1</span>.
                      </div>
                    ) : null}

                    {(provider !== 'codex' || draft.mode !== 'device-auth') ? (
                      <label className="space-y-1 text-sm text-sumi-black">
                        <span className="text-whisper uppercase tracking-wide text-sumi-diluted">
                          {provider === 'claude' ? 'Setup token' : 'API key'}
                        </span>
                        <textarea
                          value={draft.secret}
                          onChange={(event) => updateProviderDraft(provider, {
                            secret: event.target.value,
                            error: null,
                          })}
                          className={TEXTAREA_CLASS}
                          placeholder={provider === 'claude' ? 'Paste CLAUDE_CODE_OAUTH_TOKEN' : 'Paste provider API key'}
                        />
                      </label>
                    ) : null}

                    {draft.error ? (
                      <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {draft.error}
                      </div>
                    ) : null}

                    {status?.configured ? (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        <CheckCircle2 size={16} />
                        {status.label} is ready on this worker.
                      </div>
                    ) : null}

                    {status?.installed === false ? (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {status.label} CLI is missing on this worker. Run <span className="font-mono">hammurabi machine bootstrap {machine?.id}</span> first, then come back here to verify auth.
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleProviderSetup(provider)}
                        className="btn-primary inline-flex items-center gap-2"
                        disabled={draft.isSubmitting || !machine}
                      >
                        {draft.isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
                        {providerActionLabel(provider, draft.mode)}
                      </button>

                      <button
                        type="button"
                        onClick={() => void authStatusQuery.refetch()}
                        className="btn-ghost inline-flex items-center gap-2"
                        disabled={authStatusQuery.isFetching}
                      >
                        <RefreshCw size={14} className={authStatusQuery.isFetching ? 'animate-spin' : ''} />
                        Refresh status
                      </button>

                      <button
                        type="button"
                        onClick={() => handleProviderSkip(provider)}
                        className="btn-ghost"
                      >
                        Skip for now
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-sumi-diluted">
              Partial setup is OK. Unchecked providers stay unavailable until you return and verify them.
            </div>
            <div className="flex items-center gap-2">
              {!initialMachine ? (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-ghost"
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleFinish}
                className="btn-primary"
                disabled={!canFinish}
              >
                Finish worker setup
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalFormContainer>
  )
}

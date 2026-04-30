import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createMachine,
  verifyTailscaleHostname,
  type CreateMachineInput,
  type VerifyTailscaleHostnameResponse,
} from '@/hooks/use-agents'

type WorkerConnectionMode = 'same-machine' | 'direct-ssh' | 'tailscale'
type TailscalePlatformOption = 'macos' | 'linux' | 'already-installed'

const INPUT_CLASS =
  'w-full rounded-lg border border-ink-border px-3 py-2 text-[16px] md:text-sm bg-washi-white focus:outline-none focus:ring-1 focus:ring-sumi-black/20 placeholder:text-sumi-mist'
const LABEL_CLASS = 'text-whisper uppercase tracking-wide text-sumi-diluted'

const MODE_OPTIONS: Array<{ value: WorkerConnectionMode; label: string }> = [
  { value: 'same-machine', label: 'Same machine' },
  { value: 'direct-ssh', label: 'Direct SSH' },
  { value: 'tailscale', label: 'Behind NAT - use Tailscale' },
]

const TAILSCALE_PLATFORM_OPTIONS: Array<{ value: TailscalePlatformOption; label: string }> = [
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
  { value: 'already-installed', label: 'Already installed' },
]

const TAILSCALE_COMMANDS: Record<TailscalePlatformOption, string[]> = {
  macos: [
    'brew install tailscale',
    'sudo tailscale up',
  ],
  linux: [
    'curl -fsSL https://tailscale.com/install.sh | sh',
    'sudo tailscale up',
  ],
  'already-installed': [
    'sudo tailscale up',
  ],
}

function detectSuggestedTailscalePlatform(): TailscalePlatformOption {
  if (typeof navigator === 'undefined') {
    return 'macos'
  }

  const fingerprint = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (fingerprint.includes('mac')) {
    return 'macos'
  }
  if (fingerprint.includes('linux')) {
    return 'linux'
  }
  return 'already-installed'
}

function normalizeHostname(value: string): string {
  return value.trim().replace(/\.+$/u, '')
}

function parsePort(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined
}

function renderCommandList(platform: TailscalePlatformOption) {
  return (
    <div className="space-y-2 rounded-lg border border-ink-border bg-washi-aged/60 p-3">
      <p className="text-sm text-sumi-black">
        Run these commands on the worker you want to pair:
      </p>
      {TAILSCALE_COMMANDS[platform].map((command) => (
        <pre
          key={command}
          className="overflow-x-auto rounded-md bg-sumi-black px-3 py-2 font-mono text-xs text-washi-white"
        >
          {command}
        </pre>
      ))}
      <p className="text-xs text-sumi-diluted">
        `tailscale up` opens the Tailscale auth flow the first time it runs.
      </p>
      <div className="rounded-md border border-dashed border-ink-border/70 bg-washi-white/80 p-3">
        <p className="text-sm text-sumi-black">
          Then run <span className="font-mono">tailscale status --json</span>, copy
          {' '}<span className="font-mono">Self.DNSName</span>, and paste it below.
        </p>
      </div>
    </div>
  )
}

export function AddWorkerWizard({
  onCreated,
}: {
  onCreated: () => void | Promise<void>
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<WorkerConnectionMode>('tailscale')
  const [tailscalePlatform, setTailscalePlatform] = useState<TailscalePlatformOption>(
    () => detectSuggestedTailscalePlatform(),
  )
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [tailscaleHostname, setTailscaleHostname] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const [cwd, setCwd] = useState('')
  const [verification, setVerification] = useState<VerifyTailscaleHostnameResponse | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const normalizedTailscaleHostname = useMemo(
    () => normalizeHostname(tailscaleHostname),
    [tailscaleHostname],
  )

  useEffect(() => {
    setVerification((current) => (
      current?.tailscaleHostname === normalizedTailscaleHostname ? current : null
    ))
  }, [normalizedTailscaleHostname])

  async function handleVerify(): Promise<void> {
    if (!normalizedTailscaleHostname) {
      setActionError('Tailscale hostname is required.')
      return
    }

    setIsVerifying(true)
    setActionError(null)
    try {
      const result = await verifyTailscaleHostname(normalizedTailscaleHostname)
      setVerification(result)
    } catch (error) {
      setVerification(null)
      setActionError(error instanceof Error ? error.message : 'Failed to verify Tailscale hostname.')
    } finally {
      setIsVerifying(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    if (mode === 'same-machine') {
      setActionError('The local machine is already available as `local` and does not need registration.')
      return
    }

    const trimmedId = id.trim()
    const trimmedLabel = label.trim()
    if (!trimmedId || !trimmedLabel) {
      setActionError('Machine ID and label are required.')
      return
    }

    const input: CreateMachineInput = {
      id: trimmedId,
      label: trimmedLabel,
      user: user.trim() || undefined,
      port: parsePort(port),
      cwd: cwd.trim() || undefined,
    }

    if (mode === 'direct-ssh') {
      const trimmedHost = host.trim()
      if (!trimmedHost) {
        setActionError('Host is required for direct SSH workers.')
        return
      }
      input.host = trimmedHost
    } else {
      if (!normalizedTailscaleHostname) {
        setActionError('Tailscale hostname is required.')
        return
      }
      if (verification?.tailscaleHostname !== normalizedTailscaleHostname) {
        setActionError('Verify the Tailscale hostname before registering the worker.')
        return
      }
      input.tailscaleHostname = normalizedTailscaleHostname
    }

    setIsSubmitting(true)
    setActionError(null)
    try {
      await createMachine(input)
      await queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] })
      await onCreated()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to register worker.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className={LABEL_CLASS} htmlFor="worker-connection-mode">Worker Location</label>
        <select
          id="worker-connection-mode"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as WorkerConnectionMode)
            setActionError(null)
          }}
          className={INPUT_CLASS}
          required
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {mode === 'same-machine' && (
        <div className="rounded-lg border border-ink-border bg-washi-aged/60 p-4 text-sm text-sumi-black">
          The Hammurabi host already exposes the local machine as <span className="font-mono">local</span>.
          Use that machine entry when you want to run workers on this server.
        </div>
      )}

      {mode === 'tailscale' && (
        <>
          <div className="space-y-2">
            <label className={LABEL_CLASS} htmlFor="worker-tailscale-platform">Worker OS</label>
            <select
              id="worker-tailscale-platform"
              value={tailscalePlatform}
              onChange={(event) => setTailscalePlatform(event.target.value as TailscalePlatformOption)}
              className={INPUT_CLASS}
              required
            >
              {TAILSCALE_PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {renderCommandList(tailscalePlatform)}
        </>
      )}

      {mode !== 'same-machine' && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-id">Machine ID</label>
              <input
                id="worker-id"
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="home-mac"
                className={INPUT_CLASS}
                required
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-label">Label</label>
              <input
                id="worker-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Home Mac"
                className={INPUT_CLASS}
                required
              />
            </div>
          </div>

          {mode === 'direct-ssh' ? (
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-host">SSH Host</label>
              <input
                id="worker-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="10.0.1.60"
                className={INPUT_CLASS}
                required
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-tailscale-hostname">Tailscale Hostname</label>
              <div className="flex flex-col gap-2 md:flex-row">
                <input
                  id="worker-tailscale-hostname"
                  value={tailscaleHostname}
                  onChange={(event) => {
                    setTailscaleHostname(event.target.value)
                    setActionError(null)
                  }}
                  placeholder="home-mac.tail2bb6ea.ts.net"
                  className={INPUT_CLASS}
                  required
                />
                <button
                  type="button"
                  onClick={() => { void handleVerify() }}
                  className="btn-ghost min-h-[44px] whitespace-nowrap"
                  disabled={isVerifying}
                >
                  {isVerifying ? 'Verifying...' : 'Verify'}
                </button>
              </div>
              {verification && (
                <p className="text-sm text-sumi-black">
                  Verified. Server can reach <span className="font-mono">{verification.tailscaleHostname}</span>
                  {' '}({verification.resolvedHost}).
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-user">SSH User</label>
              <input
                id="worker-user"
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="yugu"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-port">SSH Port</label>
              <input
                id="worker-port"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="22"
                inputMode="numeric"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-cwd">Working Directory</label>
              <input
                id="worker-cwd"
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder="/Users/yugu"
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </>
      )}

      {actionError && (
        <div className="rounded-lg border border-accent-vermillion/30 bg-accent-vermillion/8 px-3 py-2 text-sm text-accent-vermillion">
          {actionError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-ghost min-h-[44px]"
          disabled={isSubmitting || mode === 'same-machine'}
        >
          {isSubmitting ? 'Registering...' : 'Register Worker'}
        </button>
      </div>
    </form>
  )
}

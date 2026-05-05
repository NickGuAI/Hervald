import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Triangle } from 'lucide-react'
import { useProviderRegistry } from '@/hooks/use-providers'
import type { CommanderAgentType } from '../hooks/useCommander'

const DESKTOP_CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
}

const DESKTOP_SELECT_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 220,
  padding: '8px 12px',
  border: '1px solid var(--hv-border-firm)',
  borderRadius: '2px 10px 2px 10px',
  background: 'var(--hv-bg-raised)',
  color: 'var(--hv-fg-subtle)',
  fontFamily: 'var(--hv-font-body)',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
}

const DESKTOP_SELECT_STYLE: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--hv-fg)',
  fontFamily: 'var(--hv-font-body)',
  fontSize: 13,
  letterSpacing: '0.02em',
  textTransform: 'none',
  outline: 'none',
}

function resolveCommanderAgentType(value?: string | null): CommanderAgentType {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : 'claude'
}

export interface CommanderStartControlProps {
  commanderName: string
  initialAgentType?: string | null
  disabled?: boolean
  variant?: 'desktop' | 'mobile'
  onStart: (agentType: CommanderAgentType) => void
}

export function CommanderStartControl({
  commanderName,
  initialAgentType,
  disabled = false,
  variant = 'desktop',
  onStart,
}: CommanderStartControlProps) {
  const { data: providers = [] } = useProviderRegistry()
  const [agentType, setAgentType] = useState<CommanderAgentType>(
    resolveCommanderAgentType(initialAgentType),
  )

  useEffect(() => {
    setAgentType(resolveCommanderAgentType(initialAgentType))
  }, [initialAgentType])

  if (variant === 'mobile') {
    return (
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          data-testid="commander-start-button"
          onClick={() => onStart(agentType)}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-[2px_12px_2px_12px] bg-washi-white px-5 py-3 text-sm font-medium text-sumi-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Triangle size={10} className="fill-current" />
          Start {commanderName}
        </button>
        <label className="inline-flex min-w-[220px] items-center justify-between gap-2 rounded-[2px_12px_2px_12px] border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/60">
          <span>Provider</span>
          <select
            aria-label="Commander provider"
            data-testid="commander-start-agent-type"
            value={agentType}
            onChange={(event) => {
              setAgentType(resolveCommanderAgentType(event.target.value))
            }}
            disabled={disabled}
            className="bg-transparent text-sm normal-case tracking-normal text-washi-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id} className="text-sumi-black">
                {provider.label.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  return (
    <div style={DESKTOP_CONTAINER_STYLE}>
      <button
        type="button"
        data-testid="commander-start-button"
        onClick={() => onStart(agentType)}
        disabled={disabled}
        style={{
          minWidth: 220,
          padding: '14px 22px',
          border: '1px solid var(--hv-fg)',
          borderRadius: '2px 14px 2px 14px',
          background: 'var(--hv-fg)',
          color: 'var(--hv-fg-inverse)',
          fontFamily: 'var(--hv-font-body)',
          fontSize: 15,
          letterSpacing: '0.02em',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Triangle size={11} className="fill-current" />
        Start {commanderName}
      </button>
      <label style={DESKTOP_SELECT_LABEL_STYLE}>
        <span>Provider</span>
        <select
          aria-label="Commander provider"
          data-testid="commander-start-agent-type"
          value={agentType}
          onChange={(event) => {
            setAgentType(resolveCommanderAgentType(event.target.value))
          }}
          disabled={disabled}
          style={DESKTOP_SELECT_STYLE}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

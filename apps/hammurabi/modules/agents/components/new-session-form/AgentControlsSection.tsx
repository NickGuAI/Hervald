import { AlertTriangle } from 'lucide-react'
import type { ProviderRegistryEntry } from '@/types'
import { cn } from '@/lib/utils'
import type { AgentType, SessionTransportType } from '@/types'
import {
  CLAUDE_ADAPTIVE_THINKING_MODES,
  type ClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import { CLAUDE_EFFORT_LEVELS, type ClaudeEffortLevel } from '../../../claude-effort.js'
import {
  MAX_CLAUDE_MAX_THINKING_TOKENS,
  MIN_CLAUDE_MAX_THINKING_TOKENS,
  type ClaudeMaxThinkingTokens,
} from '../../../claude-max-thinking-tokens.js'

interface AgentControlsSectionProps {
  providers: readonly ProviderRegistryEntry[]
  agentType: AgentType
  setAgentType: (value: AgentType) => void
  transportType: Exclude<SessionTransportType, 'external'>
  setTransportType: (value: Exclude<SessionTransportType, 'external'>) => void
  resumeLocked: boolean
  effort: ClaudeEffortLevel
  setEffort: (value: ClaudeEffortLevel) => void
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  setAdaptiveThinking: (value: ClaudeAdaptiveThinkingMode) => void
  maxThinkingTokens: ClaudeMaxThinkingTokens
  setMaxThinkingTokens: (value: ClaudeMaxThinkingTokens) => void
}

export function AgentControlsSection({
  providers,
  agentType,
  setAgentType,
  transportType,
  setTransportType,
  resumeLocked,
  effort,
  setEffort,
  adaptiveThinking,
  setAdaptiveThinking,
  maxThinkingTokens,
  setMaxThinkingTokens,
}: AgentControlsSectionProps) {
  const currentProvider = providers.find((provider) => provider.id === agentType) ?? null
  const providerDefaults = currentProvider?.defaults
  const defaultEffort = providerDefaults?.effort ?? 'high'
  const defaultAdaptiveThinking = providerDefaults?.adaptiveThinking ?? 'disabled'
  const defaultMaxThinkingTokens = providerDefaults?.maxThinkingTokens ?? 128000
  const sessionTypeOptions = currentProvider?.uiCapabilities.forcedTransport === 'stream'
    ? [{ value: 'stream', label: 'Stream', description: 'ACP chat UI, supports resume' }]
    : [
        { value: 'stream', label: 'Stream', description: 'Chat UI, supports resume' },
        { value: 'pty', label: 'PTY', description: 'Terminal UI, no resume' },
      ]

  return (
    <>
      <div>
        <label className="section-title block mb-2">Agent</label>
        <div className="flex gap-2">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => setAgentType(provider.id)}
              disabled={resumeLocked}
              className={cn(
                'flex-1 text-center rounded-lg border px-3 py-2 transition-colors min-h-[44px] font-mono text-sm',
                agentType === provider.id
                  ? 'border-[color:var(--hv-fg)] bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]'
                  : 'border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[color:var(--hv-fg)] hover:border-[color:var(--hv-border-soft)]',
                resumeLocked && 'cursor-not-allowed opacity-60 hover:border-[color:var(--hv-border-hair)]',
              )}
            >
              {provider.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="section-title block mb-2">Session Type</label>
        <div className="flex gap-2">
          {sessionTypeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTransportType(option.value as Exclude<SessionTransportType, 'external'>)}
              disabled={resumeLocked}
              className={cn(
                'flex-1 text-left rounded-lg border px-3 py-2 transition-colors min-h-[44px]',
                transportType === option.value
                  ? 'border-[color:var(--hv-fg)] bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]'
                  : 'border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[color:var(--hv-fg)] hover:border-[color:var(--hv-border-soft)]',
                resumeLocked && 'cursor-not-allowed opacity-60 hover:border-[color:var(--hv-border-hair)]',
              )}
            >
              <div className="font-mono text-xs">{option.label}</div>
              <div
                className={cn(
                  'text-whisper mt-1',
                  transportType === option.value ? 'text-[color:var(--hv-fg-inverse)]' : 'text-[color:var(--hv-fg-subtle)]',
                )}
              >
                {option.description}
              </div>
            </button>
          ))}
        </div>
        {transportType === 'pty' ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>PTY sessions cannot be resumed after server restart</span>
          </div>
        ) : null}
        {currentProvider?.uiCapabilities.infoBanner ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-700">
            <span>{currentProvider.uiCapabilities.infoBanner.text}</span>
          </div>
        ) : null}
      </div>

      <div>
        <label className="section-title block mb-2">Approval</label>
        <div className="rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2 text-sm text-[color:var(--hv-fg-muted)]">
          Hammurabi approval is always on. Safe internal actions auto-approve fast; outbound or
          policy-matching actions enter the review queue.
        </div>
      </div>

      {currentProvider?.uiCapabilities.supportsEffort ? (
        <>
          <div>
            <label className="section-title block mb-2">Claude Effort</label>
            <select
              value={effort}
              onChange={(event) => setEffort(event.target.value as ClaudeEffortLevel)}
              disabled={resumeLocked}
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]',
                resumeLocked && 'cursor-not-allowed opacity-60',
              )}
            >
              {CLAUDE_EFFORT_LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
            <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
              Default is `{defaultEffort}`. Resume reuses the selected session’s Claude effort.
            </p>
          </div>

          <div>
            <label className="section-title block mb-2">Adaptive Thinking</label>
            <select
              value={adaptiveThinking}
              onChange={(event) => setAdaptiveThinking(event.target.value as ClaudeAdaptiveThinkingMode)}
              disabled={resumeLocked}
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]',
                resumeLocked && 'cursor-not-allowed opacity-60',
              )}
            >
              {CLAUDE_ADAPTIVE_THINKING_MODES.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
            <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
              Default is `{defaultAdaptiveThinking}` for fixed `MAX_THINKING_TOKENS`; enable only when the smaller adaptive budget is wanted.
            </p>
          </div>

          {currentProvider?.uiCapabilities.supportsMaxThinkingTokens ? (
            <div>
              <label className="section-title block mb-2">Max Thinking Tokens</label>
              <input
                type="number"
                min={MIN_CLAUDE_MAX_THINKING_TOKENS}
                max={MAX_CLAUDE_MAX_THINKING_TOKENS}
                step={1}
                required
                value={maxThinkingTokens}
                onChange={(event) => setMaxThinkingTokens(Number(event.target.value))}
                disabled={resumeLocked}
                className={cn(
                  'w-full px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]',
                  resumeLocked && 'cursor-not-allowed opacity-60',
                )}
              />
              <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">
                Default is `{defaultMaxThinkingTokens}`. Valid range is 1024-256000.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}

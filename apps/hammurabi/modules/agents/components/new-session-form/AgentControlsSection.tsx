import { AlertTriangle } from 'lucide-react'
import type { ProviderRegistryEntry } from '@/types'
import { cn } from '@/lib/utils'
import type { AgentType, SessionTransportType } from '@/types'
import {
  CLAUDE_ADAPTIVE_THINKING_MODES,
  type ClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import { CLAUDE_EFFORT_LEVELS, type ClaudeEffortLevel } from '../../../claude-effort.js'

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
}: AgentControlsSectionProps) {
  const currentProvider = providers.find((provider) => provider.id === agentType) ?? null
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
                  ? 'border-sumi-black bg-sumi-black text-washi-aged'
                  : 'border-ink-border bg-washi-aged text-sumi-black hover:border-ink-border-hover',
                resumeLocked && 'cursor-not-allowed opacity-60 hover:border-ink-border',
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
                  ? 'border-sumi-black bg-sumi-black text-washi-aged'
                  : 'border-ink-border bg-washi-aged text-sumi-black hover:border-ink-border-hover',
                resumeLocked && 'cursor-not-allowed opacity-60 hover:border-ink-border',
              )}
            >
              <div className="font-mono text-xs">{option.label}</div>
              <div
                className={cn(
                  'text-whisper mt-1',
                  transportType === option.value ? 'text-washi-aged/80' : 'text-sumi-diluted',
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
        <div className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-gray">
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
                'w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover',
                resumeLocked && 'cursor-not-allowed opacity-60',
              )}
            >
              {CLAUDE_EFFORT_LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
            <p className="mt-1 text-whisper text-sumi-mist">
              Default is `max`. Resume reuses the selected session’s Claude effort.
            </p>
          </div>

          <div>
            <label className="section-title block mb-2">Adaptive Thinking</label>
            <select
              value={adaptiveThinking}
              onChange={(event) => setAdaptiveThinking(event.target.value as ClaudeAdaptiveThinkingMode)}
              disabled={resumeLocked}
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover',
                resumeLocked && 'cursor-not-allowed opacity-60',
              )}
            >
              {CLAUDE_ADAPTIVE_THINKING_MODES.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
            <p className="mt-1 text-whisper text-sumi-mist">
              Default is `enabled`. Keep it enabled for `--effort max`; disable only to force fixed `MAX_THINKING_TOKENS`.
            </p>
          </div>
        </>
      ) : null}
    </>
  )
}

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Plus } from 'lucide-react'
import type { AgentType, ProviderRegistryEntry } from '@/types'
import {
  CLAUDE_ADAPTIVE_THINKING_MODES,
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '@modules/claude-adaptive-thinking.js'
import {
  CLAUDE_EFFORT_LEVELS,
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '@modules/claude-effort.js'
import {
  DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  MAX_CLAUDE_MAX_THINKING_TOKENS,
  MIN_CLAUDE_MAX_THINKING_TOKENS,
  type ClaudeMaxThinkingTokens,
} from '@modules/claude-max-thinking-tokens.js'

export interface CreateConversationReasoningConfig {
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
}

function resolveInitialAgentType(
  providers: readonly ProviderRegistryEntry[],
  defaultAgentType?: AgentType,
): AgentType | null {
  if (defaultAgentType && providers.some((provider) => provider.id === defaultAgentType)) {
    return defaultAgentType
  }
  return providers[0]?.id ?? null
}

export function CreateConversationPanel({
  commanderName,
  onCreateChat,
  createChatPending = false,
  defaultAgentType,
  providerOptions = [],
}: {
  commanderName: string
  onCreateChat?: (
    agentType: AgentType,
    model: string | null,
    reasoningConfig: CreateConversationReasoningConfig,
  ) => void | Promise<void>
  createChatPending?: boolean
  defaultAgentType?: AgentType
  providerOptions?: readonly ProviderRegistryEntry[]
}) {
  // The corrected issue 1362 contract: the empty-state panel must NOT create
  // anything until the user explicitly confirms (with provider choice). The
  // dropdown sits next to the Create button, and the POST only fires on the
  // button click — never on render, never on commander selection.
  const [agentType, setAgentType] = useState<AgentType | null>(
    () => resolveInitialAgentType(providerOptions, defaultAgentType),
  )
  const [model, setModel] = useState<string | null>(null)
  const [effort, setEffort] = useState<ClaudeEffortLevel>(DEFAULT_CLAUDE_EFFORT_LEVEL)
  const [adaptiveThinking, setAdaptiveThinking] = useState<ClaudeAdaptiveThinkingMode>(
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const [maxThinkingTokens, setMaxThinkingTokens] = useState(String(DEFAULT_CLAUDE_MAX_THINKING_TOKENS))
  const [reasoningError, setReasoningError] = useState<string | null>(null)
  const userSelectedAgentTypeRef = useRef(false)
  const previousDefaultAgentTypeRef = useRef(defaultAgentType)
  const activeProvider = useMemo(
    () => providerOptions.find((provider) => provider.id === agentType) ?? null,
    [agentType, providerOptions],
  )
  const availableModels = activeProvider?.availableModels ?? []
  const capabilities = activeProvider?.uiCapabilities
  const disabled = !onCreateChat || createChatPending || !agentType

  useEffect(() => {
    const defaultAgentTypeChanged = previousDefaultAgentTypeRef.current !== defaultAgentType
    previousDefaultAgentTypeRef.current = defaultAgentType

    setAgentType((current) => {
      const currentIsAvailable = Boolean(
        current && providerOptions.some((provider) => provider.id === current),
      )

      if (currentIsAvailable && (!defaultAgentTypeChanged || userSelectedAgentTypeRef.current)) {
        return current
      }

      userSelectedAgentTypeRef.current = false
      return resolveInitialAgentType(providerOptions, defaultAgentType)
    })
  }, [defaultAgentType, providerOptions])

  useEffect(() => {
    if (model && !availableModels.some((option) => option.id === model)) {
      setModel(null)
    }
  }, [availableModels, model])

  useEffect(() => {
    const defaults = activeProvider?.defaults
    setEffort(defaults?.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL)
    setAdaptiveThinking(defaults?.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE)
    setMaxThinkingTokens(String(defaults?.maxThinkingTokens ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS))
    setReasoningError(null)
  }, [activeProvider])

  function buildReasoningConfig(): CreateConversationReasoningConfig | null {
    if (!capabilities?.supportsMaxThinkingTokens) {
      setReasoningError(null)
      return {
        ...(capabilities?.supportsEffort ? { effort } : {}),
        ...(capabilities?.supportsAdaptiveThinking ? { adaptiveThinking } : {}),
      }
    }

    const parsedMaxThinkingTokens = Number.parseInt(maxThinkingTokens.trim(), 10)
    if (
      !Number.isFinite(parsedMaxThinkingTokens)
      || parsedMaxThinkingTokens < MIN_CLAUDE_MAX_THINKING_TOKENS
      || parsedMaxThinkingTokens > MAX_CLAUDE_MAX_THINKING_TOKENS
    ) {
      setReasoningError(
        `Max tokens must be an integer between ${MIN_CLAUDE_MAX_THINKING_TOKENS} and ${MAX_CLAUDE_MAX_THINKING_TOKENS}.`,
      )
      return null
    }

    setReasoningError(null)
    return {
      ...(capabilities?.supportsEffort ? { effort } : {}),
      ...(capabilities?.supportsAdaptiveThinking ? { adaptiveThinking } : {}),
      maxThinkingTokens: parsedMaxThinkingTokens,
    }
  }

  function handleAgentTypeChange(nextAgentType: AgentType): void {
    userSelectedAgentTypeRef.current = true
    setAgentType(nextAgentType)
    const nextModels = providerOptions.find((provider) => provider.id === nextAgentType)?.availableModels ?? []
    if (model && !nextModels.some((option) => option.id === model)) {
      setModel(null)
    }
  }

  function handleAgentTypeSelectEvent(event: ChangeEvent<HTMLSelectElement>): void {
    handleAgentTypeChange(event.currentTarget.value as AgentType)
  }

  return (
    <div
      data-testid="start-conversation-panel"
      style={{
        minHeight: 360,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 32px 56px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <p
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--hv-fg-faint)',
            margin: 0,
          }}
        >
          New conversation with {commanderName}
        </p>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px',
              border: '1px solid var(--hv-border-hair)',
              borderRadius: '2px 10px 2px 10px',
              background: 'var(--hv-bg-raised)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--hv-fg-subtle)',
            }}
          >
            <span>Provider</span>
            <select
              className="font-body"
              data-testid="create-chat-provider-select"
              value={agentType ?? ''}
              onChange={handleAgentTypeSelectEvent}
              disabled={disabled}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--hv-fg)',
                fontSize: 13,
                padding: '8px 4px',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px',
              border: '1px solid var(--hv-border-hair)',
              borderRadius: '2px 10px 2px 10px',
              background: 'var(--hv-bg-raised)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--hv-fg-subtle)',
            }}
          >
            <span>Model</span>
            <select
              className="font-body"
              data-testid="create-chat-model-select"
              value={model ?? ''}
              onChange={(event) => setModel(event.target.value || null)}
              disabled={disabled}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--hv-fg)',
                fontSize: 13,
                padding: '8px 4px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                maxWidth: 260,
              }}
            >
              <option value="">Adapter default</option>
              {availableModels.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            className="font-body"
            type="button"
            data-testid="create-chat-panel-button"
            onClick={() => {
              if (agentType) {
                const reasoningConfig = buildReasoningConfig()
                if (reasoningConfig) {
                  void onCreateChat?.(agentType, model, reasoningConfig)
                }
              }
            }}
            disabled={disabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minWidth: 156,
              padding: '12px 18px',
              border: '1px solid var(--hv-border-firm)',
              borderRadius: '2px 10px 2px 10px',
              background: 'var(--sumi-black)',
              color: 'var(--washi-white)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: onCreateChat ? 1 : 0.55,
              fontSize: 13,
              letterSpacing: '0.04em',
            }}
          >
            <Plus size={14} />
            <span>{createChatPending ? 'Creating' : 'Create chat'}</span>
          </button>
        </div>
        {activeProvider && (
          capabilities?.supportsEffort ||
          capabilities?.supportsAdaptiveThinking ||
          capabilities?.supportsMaxThinkingTokens
        ) ? (
          <div
            data-testid="create-chat-reasoning-settings"
            data-test-id="create-chat-reasoning-settings"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
              maxWidth: 640,
            }}
          >
            {capabilities?.supportsEffort ? (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 10px',
                  border: '1px solid var(--hv-border-hair)',
                  borderRadius: '2px 10px 2px 10px',
                  background: 'var(--hv-bg-raised)',
                  color: 'var(--hv-fg-subtle)',
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}
              >
                <span>Effort</span>
                <select
                  className="font-body"
                  data-testid="create-chat-effort-select"
                  value={effort}
                  onChange={(event) => setEffort(event.target.value as ClaudeEffortLevel)}
                  disabled={disabled}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hv-fg)',
                    fontSize: 12,
                    padding: '8px 2px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {CLAUDE_EFFORT_LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {capabilities?.supportsAdaptiveThinking ? (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 10px',
                  border: '1px solid var(--hv-border-hair)',
                  borderRadius: '2px 10px 2px 10px',
                  background: 'var(--hv-bg-raised)',
                  color: 'var(--hv-fg-subtle)',
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}
              >
                <span>Adaptive</span>
                <select
                  className="font-body"
                  data-testid="create-chat-adaptive-thinking-select"
                  value={adaptiveThinking}
                  onChange={(event) => setAdaptiveThinking(event.target.value as ClaudeAdaptiveThinkingMode)}
                  disabled={disabled}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hv-fg)',
                    fontSize: 12,
                    padding: '8px 2px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {CLAUDE_ADAPTIVE_THINKING_MODES.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {capabilities?.supportsMaxThinkingTokens ? (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 10px',
                  border: '1px solid var(--hv-border-hair)',
                  borderRadius: '2px 10px 2px 10px',
                  background: 'var(--hv-bg-raised)',
                  color: 'var(--hv-fg-subtle)',
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}
              >
                <span>Max tokens</span>
                <input
                  className="font-body"
                  data-testid="create-chat-max-thinking-tokens-input"
                  type="number"
                  min={MIN_CLAUDE_MAX_THINKING_TOKENS}
                  max={MAX_CLAUDE_MAX_THINKING_TOKENS}
                  step={1}
                  value={maxThinkingTokens}
                  onChange={(event) => setMaxThinkingTokens(event.target.value)}
                  disabled={disabled}
                  style={{
                    width: 88,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hv-fg)',
                    fontSize: 12,
                    padding: '8px 2px',
                    cursor: disabled ? 'not-allowed' : 'text',
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}
        {reasoningError ? (
          <p
            data-testid="create-chat-reasoning-error"
            data-test-id="create-chat-reasoning-error"
            style={{
              margin: 0,
              maxWidth: 520,
              color: 'var(--hv-danger)',
              fontSize: 11,
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            {reasoningError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

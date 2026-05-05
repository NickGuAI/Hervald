import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { AgentType } from '@/types'

const DEFAULT_PROVIDER_OPTIONS: AgentType[] = ['claude', 'codex', 'gemini']

export function CreateConversationPanel({
  commanderName,
  onCreateChat,
  createChatPending = false,
  defaultAgentType,
  providerOptions = DEFAULT_PROVIDER_OPTIONS,
}: {
  commanderName: string
  onCreateChat?: (agentType: AgentType) => void | Promise<void>
  createChatPending?: boolean
  defaultAgentType?: AgentType
  providerOptions?: AgentType[]
}) {
  // The corrected #1362 contract: the empty-state panel must NOT create
  // anything until the user explicitly confirms (with provider choice). The
  // dropdown sits next to the Create button, and the POST only fires on the
  // button click — never on render, never on commander selection.
  const [agentType, setAgentType] = useState<AgentType>(
    defaultAgentType && providerOptions.includes(defaultAgentType)
      ? defaultAgentType
      : providerOptions[0] ?? 'claude',
  )
  const disabled = !onCreateChat || createChatPending

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
              data-testid="create-chat-provider-select"
              value={agentType}
              onChange={(event) => setAgentType(event.target.value as AgentType)}
              disabled={disabled}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--hv-fg)',
                fontFamily: 'var(--hv-font-body)',
                fontSize: 13,
                padding: '8px 4px',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="create-chat-panel-button"
            onClick={() => { void onCreateChat?.(agentType) }}
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
              fontFamily: 'var(--hv-font-body)',
              fontSize: 13,
              letterSpacing: '0.04em',
            }}
          >
            <Plus size={14} />
            <span>{createChatPending ? 'Creating' : 'Create chat'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import type {
  AgentType,
  ProviderRegistryEntry,
  SessionTransportType,
} from '@/types'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../../../claude-effort.js'

interface UseNewSessionConstraintsOptions {
  providers: readonly ProviderRegistryEntry[]
  agentType: AgentType
  setAgentType: (value: AgentType) => void
  transportType: Exclude<SessionTransportType, 'external'>
  setTransportType: (value: Exclude<SessionTransportType, 'external'>) => void
  effort: ClaudeEffortLevel
  setEffort: (value: ClaudeEffortLevel) => void
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  setAdaptiveThinking: (value: ClaudeAdaptiveThinkingMode) => void
}

function findProvider(
  providers: readonly ProviderRegistryEntry[],
  agentType: AgentType,
): ProviderRegistryEntry | null {
  return providers.find((provider) => provider.id === agentType) ?? null
}

export function getFallbackAgent(
  providers: readonly ProviderRegistryEntry[],
  agentType: AgentType,
): AgentType | null {
  if (providers.some((provider) => provider.id === agentType)) {
    return null
  }

  return providers[0]?.id ?? null
}

export function getForcedTransportType(
  providers: readonly ProviderRegistryEntry[],
  agentType: AgentType,
  transportType: Exclude<SessionTransportType, 'external'>,
): Exclude<SessionTransportType, 'external'> | null {
  const forcedTransport = findProvider(providers, agentType)?.uiCapabilities.forcedTransport
  return forcedTransport && transportType !== forcedTransport ? forcedTransport : null
}

export function getNormalizedEffort(
  providers: readonly ProviderRegistryEntry[],
  agentType: AgentType,
  effort: ClaudeEffortLevel,
): ClaudeEffortLevel | null {
  return !findProvider(providers, agentType)?.uiCapabilities.supportsEffort
    && effort !== DEFAULT_CLAUDE_EFFORT_LEVEL
    ? DEFAULT_CLAUDE_EFFORT_LEVEL
    : null
}

export function getNormalizedAdaptiveThinking(
  providers: readonly ProviderRegistryEntry[],
  agentType: AgentType,
  adaptiveThinking: ClaudeAdaptiveThinkingMode,
): ClaudeAdaptiveThinkingMode | null {
  return !findProvider(providers, agentType)?.uiCapabilities.supportsAdaptiveThinking
    && adaptiveThinking !== DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
    ? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
    : null
}

export function useNewSessionConstraints({
  providers,
  agentType,
  setAgentType,
  transportType,
  setTransportType,
  effort,
  setEffort,
  adaptiveThinking,
  setAdaptiveThinking,
}: UseNewSessionConstraintsOptions) {
  useEffect(() => {
    const fallbackAgent = getFallbackAgent(providers, agentType)
    if (fallbackAgent) {
      setAgentType(fallbackAgent)
    }
  }, [providers, agentType, setAgentType])

  useEffect(() => {
    const nextTransportType = getForcedTransportType(providers, agentType, transportType)
    if (nextTransportType) {
      setTransportType(nextTransportType)
    }
  }, [providers, agentType, setTransportType, transportType])

  useEffect(() => {
    const nextEffort = getNormalizedEffort(providers, agentType, effort)
    if (nextEffort) {
      setEffort(nextEffort)
    }
  }, [providers, agentType, effort, setEffort])

  useEffect(() => {
    const nextAdaptiveThinking = getNormalizedAdaptiveThinking(providers, agentType, adaptiveThinking)
    if (nextAdaptiveThinking) {
      setAdaptiveThinking(nextAdaptiveThinking)
    }
  }, [providers, adaptiveThinking, agentType, setAdaptiveThinking])
}

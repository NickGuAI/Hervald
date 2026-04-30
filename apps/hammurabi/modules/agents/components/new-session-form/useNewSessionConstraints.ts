import { useEffect } from 'react'
import type { AgentType, SessionTransportType } from '@/types'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../../../claude-effort.js'

interface UseNewSessionConstraintsOptions {
  agentOptions: readonly AgentType[]
  agentType: AgentType
  setAgentType: (value: AgentType) => void
  transportType: Exclude<SessionTransportType, 'external'>
  setTransportType: (value: Exclude<SessionTransportType, 'external'>) => void
  effort: ClaudeEffortLevel
  setEffort: (value: ClaudeEffortLevel) => void
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  setAdaptiveThinking: (value: ClaudeAdaptiveThinkingMode) => void
}

export function getFallbackAgent(agentOptions: readonly AgentType[], agentType: AgentType): AgentType | null {
  if (agentOptions.includes(agentType)) {
    return null
  }

  return agentOptions[0] ?? null
}

export function getForcedTransportType(
  agentType: AgentType,
  transportType: Exclude<SessionTransportType, 'external'>,
): Exclude<SessionTransportType, 'external'> | null {
  return agentType === 'gemini' && transportType !== 'stream' ? 'stream' : null
}

export function getNormalizedEffort(
  agentType: AgentType,
  effort: ClaudeEffortLevel,
): ClaudeEffortLevel | null {
  return agentType !== 'claude' && effort !== DEFAULT_CLAUDE_EFFORT_LEVEL
    ? DEFAULT_CLAUDE_EFFORT_LEVEL
    : null
}

export function getNormalizedAdaptiveThinking(
  agentType: AgentType,
  adaptiveThinking: ClaudeAdaptiveThinkingMode,
): ClaudeAdaptiveThinkingMode | null {
  return agentType !== 'claude' && adaptiveThinking !== DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
    ? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
    : null
}

export function useNewSessionConstraints({
  agentOptions,
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
    const fallbackAgent = getFallbackAgent(agentOptions, agentType)
    if (fallbackAgent) {
      setAgentType(fallbackAgent)
    }
  }, [agentOptions, agentType, setAgentType])

  useEffect(() => {
    const nextTransportType = getForcedTransportType(agentType, transportType)
    if (nextTransportType) {
      setTransportType(nextTransportType)
    }
  }, [agentType, setTransportType, transportType])

  useEffect(() => {
    const nextEffort = getNormalizedEffort(agentType, effort)
    if (nextEffort) {
      setEffort(nextEffort)
    }
  }, [agentType, effort, setEffort])

  useEffect(() => {
    const nextAdaptiveThinking = getNormalizedAdaptiveThinking(agentType, adaptiveThinking)
    if (nextAdaptiveThinking) {
      setAdaptiveThinking(nextAdaptiveThinking)
    }
  }, [adaptiveThinking, agentType, setAdaptiveThinking])
}

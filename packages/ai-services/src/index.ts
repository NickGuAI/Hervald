export type {
  AgentProvider,
  AgentCallSettings,
  AgentEvent,
  AgentUsage,
  McpServerConfig,
} from './types.js'

export { runClaude } from './claude-adapter.js'
export { runCodex } from './codex-adapter.js'

export type {
  AgentSessionTransportMode,
  AgentSessionKind,
  AgentType,
  SessionType,
  SessionCreator,
  SessionCreatorKind,
  SessionCompletionStatus,
  SessionRuntimeState,
  AgentSessionCreateInput,
  CreatedAgentSession,
  AgentSessionCompletion,
  AgentSessionProgress,
  AgentSessionMonitorOptions,
  AgentSessionClientOptions,
} from './agent-session-client.js'
export { AgentSessionClient } from './agent-session-client.js'

import type { AgentProvider, AgentCallSettings, AgentEvent } from './types.js'
import { runClaude } from './claude-adapter.js'
import { runCodex } from './codex-adapter.js'

/**
 * Unified agent call that routes to the appropriate provider.
 *
 * @example
 * ```ts
 * import { agentCall } from '@gehirn/ai-services'
 *
 * for await (const event of agentCall('Fix the failing tests', 'claude', { passive: true })) {
 *   if (event.type === 'text') console.log(event.content)
 * }
 * ```
 */
export async function* agentCall(
  prompt: string,
  provider: AgentProvider,
  settings: AgentCallSettings = {},
): AsyncGenerator<AgentEvent> {
  switch (provider) {
    case 'claude':
      yield* runClaude(prompt, settings)
      break
    case 'codex':
      yield* runCodex(prompt, settings)
      break
    default:
      yield { type: 'error', content: `Unknown provider: ${provider}` }
  }
}

import type { AgentType } from '@/types'

export function supportsQueuedDrafts(_agentType?: AgentType | null): boolean {
  return true
}

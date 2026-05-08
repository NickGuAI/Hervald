import { getProvider } from './registry.js'

export function validateModelForAgentType(
  agentType: string,
  model: string | null,
): { ok: true } | { ok: false; error: string; validIds: string[] } {
  const trimmedModel = typeof model === 'string' ? model.trim() : ''
  if (!trimmedModel) {
    return { ok: true }
  }

  const provider = getProvider(agentType)
  const validIds = provider?.availableModels.map((entry) => entry.id) ?? []
  if (validIds.includes(trimmedModel)) {
    return { ok: true }
  }

  if (!provider) {
    return {
      ok: false,
      error: `Unknown provider "${agentType}"`,
      validIds: [],
    }
  }

  return {
    ok: false,
    error: `Model "${trimmedModel}" is not valid for provider "${agentType}"`,
    validIds,
  }
}

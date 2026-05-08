import type { ProviderModelOption } from '../../providers/provider-adapter.js'

export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.5'

export const availableModels = [
  {
    id: DEFAULT_CODEX_MODEL_ID,
    label: 'GPT-5.5',
    description: 'Frontier Codex model for complex coding and research.',
    default: true,
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Strong general-purpose Codex model.',
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Fast lower-cost Codex model.',
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    description: 'Coding-optimized Codex model.',
  },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3 Codex Spark',
    description: 'Ultra-fast Codex model for quick iteration.',
  },
] satisfies ProviderModelOption[]

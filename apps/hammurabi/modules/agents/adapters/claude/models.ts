import type { ProviderModelOption } from '../../providers/provider-adapter.js'

export const availableModels = [
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7',
    description: 'Most capable Claude model for complex coding work.',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: 'Balanced Claude model for most commander and worker sessions.',
    default: true,
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    description: 'Pinned Opus 4.6 full model ID.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    description: 'Fast Claude option for lighter tasks.',
  },
] satisfies ProviderModelOption[]

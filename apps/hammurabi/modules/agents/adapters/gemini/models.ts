import type { ProviderModelOption } from '../../providers/provider-adapter.js'

export const availableModels = [
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    description: 'Current flagship Gemini preview model.',
    default: true,
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    description: 'Faster Gemini preview model.',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Previous flagship Gemini model.',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Previous fast Gemini model.',
  },
] satisfies ProviderModelOption[]

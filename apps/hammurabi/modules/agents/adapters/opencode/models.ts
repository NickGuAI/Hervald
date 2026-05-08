import type { ProviderModelOption } from '../../providers/provider-adapter.js'

export const availableModels = [
  {
    id: 'opencode/gpt-5.1-codex',
    label: 'Zen GPT 5.1 Codex',
    description: 'OpenCode Zen example model from the official docs.',
  },
  {
    id: 'openai/gpt-5.2',
    label: 'OpenAI GPT 5.2',
    description: 'Recommended OpenCode model from the official docs.',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    label: 'Anthropic Claude Sonnet 4.5',
    description: 'Recommended Anthropic option from the official docs.',
  },
  {
    id: 'anthropic/claude-opus-4-5',
    label: 'Anthropic Claude Opus 4.5',
    description: 'Recommended Anthropic high-capability option.',
  },
  {
    id: 'google/gemini-3-pro',
    label: 'Google Gemini 3 Pro',
    description: 'Recommended Gemini option from the official docs.',
  },
  {
    id: 'minimax/minimax-m2.1',
    label: 'MiniMax M2.1',
    description: 'Recommended MiniMax option from the official docs.',
  },
] satisfies ProviderModelOption[]

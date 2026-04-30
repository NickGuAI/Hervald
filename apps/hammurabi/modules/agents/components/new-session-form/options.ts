import type { ClaudePermissionMode } from '@/types'

export interface PermissionModeOption {
  value: ClaudePermissionMode
  label: string
  description: string
}

export const CLAUDE_MODE_OPTIONS: PermissionModeOption[] = [
  { value: 'default', label: 'default', description: 'claude' },
]

export const CODEX_MODE_OPTIONS: PermissionModeOption[] = [
  {
    value: 'default',
    label: 'default',
    description: 'Codex approval requests route through Hammurabi action policies',
  },
]

export const GEMINI_MODE_OPTIONS: PermissionModeOption[] = [
  { value: 'default', label: 'default', description: 'gemini --acp (mode: default)' },
]

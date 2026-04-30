import { buildRemoteCommand } from '../../machines.js'
import type { ClaudePermissionMode } from '../../types.js'

export function buildGeminiAcpInvocation(): string {
  return buildRemoteCommand('gemini', ['--acp'])
}

export function mapGeminiMode(mode: ClaudePermissionMode): 'default' | 'autoEdit' | 'yolo' {
  return 'default'
}

export function buildGeminiSystemPrompt(systemPrompt?: string, maxTurns?: number): string | undefined {
  const parts: string[] = []
  if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
    parts.push(systemPrompt.trim())
  }
  if (typeof maxTurns === 'number' && Number.isFinite(maxTurns) && maxTurns > 0) {
    parts.push(`Execution limit: finish and hand back control within ${maxTurns} turn(s).`)
  }
  if (parts.length === 0) {
    return undefined
  }
  return parts.join('\n\n')
}

export function buildGeminiPromptText(
  session: { geminiPendingSystemPrompt?: string },
  text: string,
): string {
  const trimmed = text.trim()
  const pendingSystemPrompt = typeof session.geminiPendingSystemPrompt === 'string'
    ? session.geminiPendingSystemPrompt.trim()
    : ''

  if (!pendingSystemPrompt) {
    return trimmed
  }

  session.geminiPendingSystemPrompt = undefined
  if (!trimmed) {
    return pendingSystemPrompt
  }

  return [
    'System instructions:',
    pendingSystemPrompt,
    '',
    'User request:',
    trimmed,
  ].join('\n')
}

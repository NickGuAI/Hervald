import { buildRemoteCommand } from '../../machines.js'
import type { ClaudePermissionMode } from '../../types.js'

export function buildOpenCodeAcpInvocation(
  options?: { model?: string; cwd?: string; envFile?: string },
): string {
  return buildRemoteCommand(
    'opencode',
    [
      'acp',
      ...(options?.model ? ['--model', options.model] : []),
    ],
    options?.cwd,
    options?.envFile,
  )
}

export function mapOpenCodeMode(mode: ClaudePermissionMode): 'default' | 'autoEdit' | 'yolo' {
  return 'default'
}

export function buildOpenCodeSystemPrompt(systemPrompt?: string, maxTurns?: number): string | undefined {
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

export function buildOpenCodePromptText(
  session: { opencodePendingSystemPrompt?: string },
  text: string,
): string {
  const trimmed = text.trim()
  const pendingSystemPrompt = typeof session.opencodePendingSystemPrompt === 'string'
    ? session.opencodePendingSystemPrompt.trim()
    : ''

  if (!pendingSystemPrompt) {
    return trimmed
  }

  session.opencodePendingSystemPrompt = undefined
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

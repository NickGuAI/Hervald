import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type {
  CodexSessionRuntimeHandle,
  GeminiAcpRuntimeHandle,
  OpenCodeAcpRuntimeHandle,
} from '../types.js'
import type { ProviderId } from '../adapters/provider-registry-types.js'

export interface ProviderSessionContext {
  providerId: ProviderId
}

export interface ClaudeProviderContext extends ProviderSessionContext {
  providerId: 'claude'
  sessionId?: string
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
}

export interface CodexProviderContext extends ProviderSessionContext {
  providerId: 'codex'
  threadId?: string
  runtime?: CodexSessionRuntimeHandle
  notificationCleanup?: () => void
  runtimeTeardownPromise?: Promise<void>
}

export interface GeminiProviderContext extends ProviderSessionContext {
  providerId: 'gemini'
  sessionId?: string
  runtime?: GeminiAcpRuntimeHandle
  notificationCleanup?: () => void
  runtimeTeardownPromise?: Promise<void>
}

export interface OpenCodeProviderContext extends ProviderSessionContext {
  providerId: 'opencode'
  sessionId?: string
  runtime?: OpenCodeAcpRuntimeHandle
  notificationCleanup?: () => void
  runtimeTeardownPromise?: Promise<void>
}

export interface ProviderContextInit {
  sessionId?: string
  threadId?: string
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
}

type ProviderContextContainer = {
  providerContext?: ProviderSessionContext
}

type ClaudeContextContainer = ProviderContextContainer
type CodexContextContainer = ProviderContextContainer
type GeminiContextContainer = ProviderContextContainer
type OpenCodeContextContainer = ProviderContextContainer

export function createClaudeProviderContext(
  init: Omit<ClaudeProviderContext, 'providerId'> = {},
): ClaudeProviderContext {
  return {
    providerId: 'claude',
    ...init,
  }
}

export function createCodexProviderContext(
  init: Omit<CodexProviderContext, 'providerId'> = {},
): CodexProviderContext {
  return {
    providerId: 'codex',
    ...init,
  }
}

export function createGeminiProviderContext(
  init: Omit<GeminiProviderContext, 'providerId'> = {},
): GeminiProviderContext {
  return {
    providerId: 'gemini',
    ...init,
  }
}

export function createOpenCodeProviderContext(
  init: Omit<OpenCodeProviderContext, 'providerId'> = {},
): OpenCodeProviderContext {
  return {
    providerId: 'opencode',
    ...init,
  }
}

export function createProviderContextForAgentType(
  agentType: ProviderId,
  init: ProviderContextInit = {},
): ProviderSessionContext {
  if (agentType === 'codex') {
    return createCodexProviderContext({
      threadId: init.threadId ?? init.sessionId,
    })
  }
  if (agentType === 'gemini') {
    return createGeminiProviderContext({
      sessionId: init.sessionId,
    })
  }
  if (agentType === 'opencode') {
    return createOpenCodeProviderContext({
      sessionId: init.sessionId,
    })
  }
  return createClaudeProviderContext({
    sessionId: init.sessionId,
    effort: init.effort,
    adaptiveThinking: init.adaptiveThinking,
  })
}

export function asClaudeProviderContext(
  value: ProviderSessionContext | undefined,
): ClaudeProviderContext | null {
  return value?.providerId === 'claude' ? value as ClaudeProviderContext : null
}

export function asCodexProviderContext(
  value: ProviderSessionContext | undefined,
): CodexProviderContext | null {
  return value?.providerId === 'codex' ? value as CodexProviderContext : null
}

export function asGeminiProviderContext(
  value: ProviderSessionContext | undefined,
): GeminiProviderContext | null {
  return value?.providerId === 'gemini' ? value as GeminiProviderContext : null
}

export function asOpenCodeProviderContext(
  value: ProviderSessionContext | undefined,
): OpenCodeProviderContext | null {
  return value?.providerId === 'opencode' ? value as OpenCodeProviderContext : null
}

export function ensureClaudeProviderContext<T extends ProviderContextContainer>(container: T): ClaudeProviderContext {
  const existing = asClaudeProviderContext(container.providerContext)
  if (existing) {
    return existing
  }
  const created = createClaudeProviderContext()
  container.providerContext = created
  return created
}

export function ensureCodexProviderContext<T extends ProviderContextContainer>(container: T): CodexProviderContext {
  const existing = asCodexProviderContext(container.providerContext)
  if (existing) {
    return existing
  }
  const created = createCodexProviderContext()
  container.providerContext = created
  return created
}

export function ensureGeminiProviderContext<T extends ProviderContextContainer>(container: T): GeminiProviderContext {
  const existing = asGeminiProviderContext(container.providerContext)
  if (existing) {
    return existing
  }
  const created = createGeminiProviderContext()
  container.providerContext = created
  return created
}

export function ensureOpenCodeProviderContext<T extends ProviderContextContainer>(container: T): OpenCodeProviderContext {
  const existing = asOpenCodeProviderContext(container.providerContext)
  if (existing) {
    return existing
  }
  const created = createOpenCodeProviderContext()
  container.providerContext = created
  return created
}

export function readClaudeSessionId(container: ClaudeContextContainer): string | undefined {
  return asClaudeProviderContext(container.providerContext)?.sessionId
}

export function readCodexThreadId(container: CodexContextContainer): string | undefined {
  return asCodexProviderContext(container.providerContext)?.threadId
}

export function readCodexRuntime(container: CodexContextContainer): CodexSessionRuntimeHandle | undefined {
  return asCodexProviderContext(container.providerContext)?.runtime
}

export function readCodexNotificationCleanup(
  container: CodexContextContainer,
): (() => void) | undefined {
  return asCodexProviderContext(container.providerContext)?.notificationCleanup
}

export function readCodexRuntimeTeardownPromise(
  container: CodexContextContainer,
): Promise<void> | undefined {
  return asCodexProviderContext(container.providerContext)?.runtimeTeardownPromise
}

export function readGeminiSessionId(container: GeminiContextContainer): string | undefined {
  return asGeminiProviderContext(container.providerContext)?.sessionId
}

export function readGeminiRuntime(container: GeminiContextContainer): GeminiAcpRuntimeHandle | undefined {
  return asGeminiProviderContext(container.providerContext)?.runtime
}

export function readGeminiNotificationCleanup(
  container: GeminiContextContainer,
): (() => void) | undefined {
  return asGeminiProviderContext(container.providerContext)?.notificationCleanup
}

export function readGeminiRuntimeTeardownPromise(
  container: GeminiContextContainer,
): Promise<void> | undefined {
  return asGeminiProviderContext(container.providerContext)?.runtimeTeardownPromise
}

export function readOpenCodeSessionId(container: OpenCodeContextContainer): string | undefined {
  return asOpenCodeProviderContext(container.providerContext)?.sessionId
}

export function readOpenCodeRuntime(container: OpenCodeContextContainer): OpenCodeAcpRuntimeHandle | undefined {
  return asOpenCodeProviderContext(container.providerContext)?.runtime
}

export function readOpenCodeNotificationCleanup(
  container: OpenCodeContextContainer,
): (() => void) | undefined {
  return asOpenCodeProviderContext(container.providerContext)?.notificationCleanup
}

export function readOpenCodeRuntimeTeardownPromise(
  container: OpenCodeContextContainer,
): Promise<void> | undefined {
  return asOpenCodeProviderContext(container.providerContext)?.runtimeTeardownPromise
}

export function readProviderResumeId(container: ProviderContextContainer): string | undefined {
  const context = container.providerContext
  if (!context) {
    return undefined
  }
  if (context.providerId === 'codex') {
    return asCodexProviderContext(context)?.threadId
  }
  if (context.providerId === 'gemini') {
    return asGeminiProviderContext(context)?.sessionId
  }
  if (context.providerId === 'opencode') {
    return asOpenCodeProviderContext(context)?.sessionId
  }
  return asClaudeProviderContext(context)?.sessionId
}

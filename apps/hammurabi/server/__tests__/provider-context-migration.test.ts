import { describe, expect, it } from 'vitest'
import {
  migrateProviderContext,
  sanitizeProviderContextForPersistence,
} from '../../migrations/provider-context'
import {
  createClaudeProviderContext,
  createGeminiProviderContext,
} from '../../modules/agents/providers/provider-session-context'

describe('provider-context migration helpers', () => {
  it('maps legacy resume fields to canonical providerContext and removes the legacy keys', () => {
    const { providerContext, cleaned } = migrateProviderContext({
      codexThreadId: 'thread-123',
      extra: 'kept',
    })

    expect(providerContext).toEqual({
      providerId: 'codex',
      threadId: 'thread-123',
    })
    expect(cleaned).toEqual({
      extra: 'kept',
      providerContext: {
        providerId: 'codex',
        threadId: 'thread-123',
      },
    })
  })

  it('prefers canonical providerContext when both canonical and legacy fields are present', () => {
    const { providerContext, cleaned } = migrateProviderContext({
      claudeSessionId: 'legacy-session',
      providerContext: createClaudeProviderContext({
        sessionId: 'canonical-session',
      }),
    })

    expect(providerContext).toEqual({
      providerId: 'claude',
      sessionId: 'canonical-session',
    })
    expect(cleaned).toEqual({
      providerContext: {
        providerId: 'claude',
        sessionId: 'canonical-session',
      },
    })
  })

  it('drops non-serializable runtime handles from persisted providerContext snapshots', () => {
    expect(sanitizeProviderContextForPersistence(createGeminiProviderContext({
      sessionId: 'gemini-123',
      runtime: { process: {} } as never,
      notificationCleanup: (() => undefined) as never,
      runtimeTeardownPromise: Promise.resolve(),
    }))).toEqual({
      providerId: 'gemini',
      sessionId: 'gemini-123',
    })
  })
})

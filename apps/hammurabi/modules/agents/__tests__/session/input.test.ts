import { describe, expect, it } from 'vitest'
import {
  parseActiveSkillInvocation,
  parseAgentType,
  parseClaudeAdaptiveThinking,
  parseClaudeEffort,
  parseClaudePermissionMode,
  parseCodexApprovalDecision,
  parseCwd,
  parseMaxSessions,
  parseOptionalHost,
  parseOptionalSessionName,
  parseOptionalTask,
  parseSessionCreator,
  parseSessionName,
  parseSessionTransportType,
  parseSessionType,
  parseTaskDelayMs,
  parseWsKeepAliveIntervalMs,
  parseCodexTurnWatchdogTimeoutMs,
} from '../../session/input'

describe('agents/session/input', () => {
  it('parses supported agent types and defaults unknown values to claude', () => {
    expect(parseAgentType('codex')).toBe('codex')
    expect(parseAgentType('gemini')).toBe('gemini')
    expect(parseAgentType('openclaw')).toBe('claude')
    expect(parseAgentType('claude')).toBe('claude')
    expect(parseAgentType('something-else')).toBe('claude')
  })

  it('validates required and optional session names', () => {
    expect(parseSessionName(' commander-main ')).toBe('commander-main')
    expect(parseSessionName('bad/name')).toBeNull()
    expect(parseSessionName('')).toBeNull()

    expect(parseOptionalSessionName(undefined)).toBeUndefined()
    expect(parseOptionalSessionName('')).toBeUndefined()
    expect(parseOptionalSessionName(' worker-1 ')).toBe('worker-1')
    expect(parseOptionalSessionName('bad/name')).toBeNull()
  })

  it('parses permission and approval enums', () => {
    expect(parseClaudePermissionMode('default')).toBe('default')
    expect(parseClaudePermissionMode('nope')).toBeNull()

    expect(parseCodexApprovalDecision('accept')).toBe('accept')
    expect(parseCodexApprovalDecision('decline')).toBe('decline')
    expect(parseCodexApprovalDecision('later')).toBeNull()
  })

  it('parses claude effort and adaptive thinking inputs', () => {
    expect(parseClaudeEffort(undefined)).toBeUndefined()
    expect(parseClaudeEffort('medium')).toBe('medium')
    expect(parseClaudeEffort('invalid')).toBeNull()

    expect(parseClaudeAdaptiveThinking(undefined)).toBeUndefined()
    expect(parseClaudeAdaptiveThinking('disabled')).toBe('disabled')
    expect(parseClaudeAdaptiveThinking('invalid')).toBeNull()
  })

  it('parses task, session type, cwd, host, and transport inputs', () => {
    expect(parseOptionalTask(undefined)).toBe('')
    expect(parseOptionalTask('  investigate logs  ')).toBe('investigate logs')
    expect(parseOptionalTask(42)).toBeNull()

    expect(parseSessionType(undefined)).toBeUndefined()
    expect(parseSessionType(' sentinel ')).toBe('sentinel')
    expect(parseSessionType('worker')).toBe('worker')
    expect(parseSessionType('invalid')).toBeNull()
    expect(parseSessionCreator({ kind: 'commander', id: 'cmdr-1' })).toEqual({
      kind: 'commander',
      id: 'cmdr-1',
    })
    expect(parseSessionCreator({ kind: 'nope' })).toBeNull()

    expect(parseCwd(undefined)).toBeUndefined()
    expect(parseCwd('   ')).toBeUndefined()
    expect(parseCwd('/tmp/../var/work')).toBe('/var/work')
    expect(parseCwd('relative/path')).toBeNull()

    expect(parseOptionalHost(undefined)).toBeUndefined()
    expect(parseOptionalHost(' host-1 ')).toBe('host-1')
    expect(parseOptionalHost('bad.host')).toBeNull()

    expect(parseSessionTransportType('stream')).toBe('stream')
    expect(parseSessionTransportType('pty')).toBe('pty')
    expect(parseSessionTransportType('anything-else')).toBe('pty')
  })

  it('parses active skill invocations and rejects malformed shapes', () => {
    expect(parseActiveSkillInvocation(undefined)).toBeUndefined()
    expect(parseActiveSkillInvocation({
      skillId: 'send-weekly-update',
      displayName: '/send-weekly-update',
      startedAt: '2026-04-26T12:00:00.000Z',
      toolUseId: 'toolu_123',
    })).toEqual({
      skillId: 'send-weekly-update',
      displayName: '/send-weekly-update',
      startedAt: '2026-04-26T12:00:00.000Z',
      toolUseId: 'toolu_123',
    })
    expect(parseActiveSkillInvocation({
      skillId: 'send-weekly-update',
      displayName: '/send-weekly-update',
      startedAt: '2026-04-26T12:00:00.000Z',
      toolUseId: 42,
    })).toBeNull()
    expect(parseActiveSkillInvocation({
      skillId: 'send-weekly-update',
      startedAt: '2026-04-26T12:00:00.000Z',
    })).toBeNull()
  })

  it('parses numeric options with the same defaults as routes.ts', () => {
    expect(parseMaxSessions('25')).toBe(25)
    expect(parseMaxSessions(0)).toBe(10)

    expect(parseTaskDelayMs('1500')).toBe(1500)
    expect(parseTaskDelayMs(-1)).toBe(3000)

    expect(parseWsKeepAliveIntervalMs('45000')).toBe(45000)
    expect(parseWsKeepAliveIntervalMs('0')).toBe(30000)

    expect(parseCodexTurnWatchdogTimeoutMs('90000')).toBe(90000)
    expect(parseCodexTurnWatchdogTimeoutMs(undefined)).toBe(300_000)
  })
})

// On-disk validators consume migrateLegacyPermissionMode at the parse boundary
// of every JSON store. The helper migrates the deprecated literal pre-#1186
// (bypassPermissions / dangerouslySkipPermissions / acceptEdits) to 'default'
// so legacy entries normalize cleanly instead of silently dropping. See #1222.
describe('agents/session/input: migrateLegacyPermissionMode', () => {
  it('migrates each deprecated alias to default with the legacy literal recorded', async () => {
    const { migrateLegacyPermissionMode } = await import('../../session/input')
    for (const legacy of ['dangerouslySkipPermissions', 'bypassPermissions', 'acceptEdits']) {
      const result = migrateLegacyPermissionMode(legacy)
      expect(result).toEqual({
        changed: true,
        value: 'default',
        legacyLiteral: legacy,
      })
    }
  })

  it('trims surrounding whitespace before recognizing a legacy literal', async () => {
    const { migrateLegacyPermissionMode } = await import('../../session/input')
    const result = migrateLegacyPermissionMode('  bypassPermissions  ')
    expect(result.changed).toBe(true)
    expect(result.value).toBe('default')
    expect(result.legacyLiteral).toBe('bypassPermissions')
  })

  it('passes through a valid default with changed=false', async () => {
    const { migrateLegacyPermissionMode } = await import('../../session/input')
    const result = migrateLegacyPermissionMode('default')
    expect(result).toEqual({ changed: false, value: 'default' })
  })

  it('returns changed=false with value=undefined for empty/missing inputs', async () => {
    const { migrateLegacyPermissionMode } = await import('../../session/input')
    expect(migrateLegacyPermissionMode(undefined)).toEqual({ changed: false, value: undefined })
    expect(migrateLegacyPermissionMode(null)).toEqual({ changed: false, value: undefined })
    expect(migrateLegacyPermissionMode('')).toEqual({ changed: false, value: undefined })
    expect(migrateLegacyPermissionMode('   ')).toEqual({ changed: false, value: undefined })
  })

  it('returns changed=false with value=null for genuinely-invalid strings (not just legacy)', async () => {
    const { migrateLegacyPermissionMode } = await import('../../session/input')
    expect(migrateLegacyPermissionMode('plan')).toEqual({ changed: false, value: null })
    expect(migrateLegacyPermissionMode('something-else')).toEqual({ changed: false, value: null })
  })

  it('returns changed=false with value=null for non-string inputs', async () => {
    const { migrateLegacyPermissionMode } = await import('../../session/input')
    expect(migrateLegacyPermissionMode(42)).toEqual({ changed: false, value: null })
    expect(migrateLegacyPermissionMode(true)).toEqual({ changed: false, value: null })
    expect(migrateLegacyPermissionMode([])).toEqual({ changed: false, value: null })
  })
})

import { describe, expect, it } from 'vitest'
import { parseProviderId } from '../../providers/registry'
import {
  parseActiveSkillInvocation,
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
  it('parses registered provider ids and rejects unknown values', () => {
    expect(parseProviderId('codex')).toBe('codex')
    expect(parseProviderId('gemini')).toBe('gemini')
    expect(parseProviderId('claude')).toBe('claude')
    expect(parseProviderId('openclaw')).toBeNull()
    expect(parseProviderId('something-else')).toBeNull()
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
    expect(parseClaudePermissionMode('bypassPermissions')).toBeNull()
    expect(parseClaudePermissionMode('dangerouslySkipPermissions')).toBeNull()
    expect(parseClaudePermissionMode('acceptEdits')).toBeNull()

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

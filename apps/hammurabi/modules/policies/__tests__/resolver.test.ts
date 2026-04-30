import { describe, expect, it } from 'vitest'
import { resolveActionPolicy } from '../resolver.js'

const DEFAULT_POLICY_VIEW = {
  scope: {},
  fallbackPolicy: 'auto' as const,
  records: [
    {
      actionId: 'send-email',
      policy: 'review' as const,
      allowlist: [],
      blocklist: [],
    },
    {
      actionId: 'destructive-git',
      policy: 'block' as const,
      allowlist: [],
      blocklist: [],
    },
    {
      actionId: 'deploy',
      policy: 'review' as const,
      allowlist: [],
      blocklist: [],
    },
  ],
}

describe('resolveActionPolicy — compound Bash commands', () => {
  it('matches a simple gog gmail send command', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: { command: 'gog gmail send --to a@b.com --subject "test"' },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('send-email')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('review')
  })

  it('matches gog gmail send after source && export preamble', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'source ~/.bashrc && export GOG_KEYRING_PASSWORD="${GOG_KEYRING_PASSWORD}" && gog gmail send --to a@b.com --subject "test" --body-file /tmp/body.txt 2>&1',
      },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('send-email')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('review')
  })

  it('matches gog gmail send after a simple source preamble', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'source ~/.bashrc && gog gmail send --to nick@example.com --subject "hello"',
      },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('send-email')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('review')
  })

  it('matches destructive git after export preamble', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'export FOO=bar && git reset --hard HEAD~1',
      },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('destructive-git')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('block')
  })

  it('matches deploy after cd preamble', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'cd /app && vercel deploy --prod',
      },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('deploy')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('review')
  })

  it('matches send-email after semicolon separator', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'echo done ; sendmail root',
      },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('send-email')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('review')
  })

  it('auto-allows fully safe compound commands', () => {
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'source ~/.bashrc && echo hello && ls -la',
      },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('internal:safe-bash')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('auto')
  })

  it('does not affect non-Bash tool matching', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__gmail__send_email',
      toolInput: { to: 'test@example.com', subject: 'hi' },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('send-email')
    expect(resolved.matchedBy).toBe('mcp')
    expect(resolved.decision).toBe('review')
  })
})

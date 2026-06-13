import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

const DEFAULT_REVIEW_POLICY_VIEW = {
  scope: {},
  fallbackPolicy: 'review' as const,
  records: [
    {
      actionId: 'internal:edit-in-cwd',
      policy: 'auto' as const,
      allowlist: [],
      blocklist: [],
    },
    {
      actionId: 'internal:safe-bash',
      policy: 'auto' as const,
      allowlist: [],
      blocklist: [],
    },
    {
      actionId: 'internal:safe-mcp',
      policy: 'auto' as const,
      allowlist: [],
      blocklist: [],
    },
  ],
}

async function createPolicyTestWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'hammurabi-policy-resolver-'))
  await writeFile(path.join(cwd, 'ok.txt'), 'ok\n', 'utf8')
  await writeFile(path.join(cwd, 'notes.txt'), 'needle\n', 'utf8')
  await mkdir(path.join(cwd, 'logs'))
  await writeFile(path.join(cwd, 'logs', 'events.txt'), 'needle\n', 'utf8')
  return cwd
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

  it('auto-allows fully safe compound commands', async () => {
    const cwd = await createPolicyTestWorkspace()
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: {
        command: 'echo hello && ls -la && cat notes.txt',
      },
      policyView: DEFAULT_POLICY_VIEW,
      session: { cwd },
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

  it('matches exact Codex Apps Gmail send tools as send-email', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__codex_apps__gmail_send_email',
      toolInput: { to: 'test@example.com', subject: 'hi' },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).toBe('send-email')
    expect(resolved.matchedBy).toBe('mcp')
    expect(resolved.decision).toBe('review')
  })

  it('does not auto-approve unknown Codex Apps MCP tools as internal safe MCP', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__codex_apps__unknown_external_action',
      toolInput: { target: 'external' },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).not.toBe('internal:safe-mcp')
    expect(resolved.matchedBy).toBe('fallback')
    expect(resolved.decision).toBe('review')
  })

  it('does not auto-approve unknown OpenCode MCP permissions as internal safe MCP', () => {
    const resolved = resolveActionPolicy({
      toolName: 'mcp__opencode__unknown_mcp',
      toolInput: { title: 'External MCP action', identityIncomplete: true },
      policyView: DEFAULT_POLICY_VIEW,
    })
    expect(resolved.action?.id).not.toBe('internal:safe-mcp')
    expect(resolved.matchedBy).toBe('fallback')
    expect(resolved.decision).toBe('review')
  })
})

describe('resolveActionPolicy — scoped internal fast paths', () => {
  it('requires review for safe command names with paths outside the cwd', async () => {
    const cwd = await createPolicyTestWorkspace()
    const cases = [
      'cat /etc/passwd',
      'grep -R x /home',
      'echo x > /tmp/y',
    ]

    for (const command of cases) {
      const resolved = resolveActionPolicy({
        toolName: 'Bash',
        toolInput: { command },
        policyView: DEFAULT_REVIEW_POLICY_VIEW,
        session: { cwd },
      })

      expect(resolved.action?.id, command).not.toBe('internal:safe-bash')
      expect(resolved.matchedBy, command).toBe('fallback')
      expect(resolved.decision, command).toBe('review')
    }
  })

  it('keeps cwd-scoped safe bash commands on the internal fast path', async () => {
    const cwd = await createPolicyTestWorkspace()
    const cases = [
      'cat notes.txt',
      'grep -R needle logs',
      'find . -maxdepth 1 -type f -name "*.txt" -print',
      'find logs -name events.txt -print',
      'test ok.txt -nt notes.txt',
      '[ ok.txt -nt notes.txt ]',
      'date -f logs/events.txt',
      'git diff --output=logs/output.diff',
      'echo x > logs/output.txt',
    ]

    for (const command of cases) {
      const resolved = resolveActionPolicy({
        toolName: 'Bash',
        toolInput: { command },
        policyView: DEFAULT_REVIEW_POLICY_VIEW,
        session: { cwd },
      })

      expect(resolved.action?.id, command).toBe('internal:safe-bash')
      expect(resolved.matchedBy, command).toBe('bash')
      expect(resolved.decision, command).toBe('auto')
    }
  })

  it('requires review for find command and mutation actions', async () => {
    const cwd = await createPolicyTestWorkspace()
    const cases = [
      'find . -delete',
      'find . -exec printf "%s\\n" {} \\;',
      'find . -execdir printf "%s\\n" {} \\;',
      'find . -fprintf logs/output.txt "%p\\n"',
      'find . -fprint logs/output.txt',
      'find . -fls logs/output.txt',
      'find -files0-from /etc/passwd -print',
    ]

    for (const command of cases) {
      const resolved = resolveActionPolicy({
        toolName: 'Bash',
        toolInput: { command },
        policyView: DEFAULT_REVIEW_POLICY_VIEW,
        session: { cwd },
      })

      expect(resolved.action?.id, command).not.toBe('internal:safe-bash')
      expect(resolved.matchedBy, command).toBe('fallback')
      expect(resolved.decision, command).toBe('review')
    }
  })

  it('requires review for find path operands outside the cwd', async () => {
    const cwd = await createPolicyTestWorkspace()
    const outside = await mkdtemp(path.join(tmpdir(), 'hammurabi-policy-find-outside-'))
    const outsideReference = path.join(outside, 'reference.txt')
    await writeFile(outsideReference, 'outside\n', 'utf8')

    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: { command: `find . -newer ${outsideReference} -print` },
      policyView: DEFAULT_REVIEW_POLICY_VIEW,
      session: { cwd },
    })

    expect(resolved.action?.id).not.toBe('internal:safe-bash')
    expect(resolved.matchedBy).toBe('fallback')
    expect(resolved.decision).toBe('review')
  })

  it('requires review for safe command path operands outside the cwd', async () => {
    const cwd = await createPolicyTestWorkspace()
    const cases = [
      'find . -samefile /etc/passwd -print',
      'test /etc/passwd -nt ok.txt',
      '[ /etc/passwd -nt ok.txt ]',
      'date -f /etc/passwd',
      'date --file=/etc/passwd',
      'git diff --output=/tmp/git.diff',
    ]

    for (const command of cases) {
      const resolved = resolveActionPolicy({
        toolName: 'Bash',
        toolInput: { command },
        policyView: DEFAULT_REVIEW_POLICY_VIEW,
        session: { cwd },
      })

      expect(resolved.action?.id, command).not.toBe('internal:safe-bash')
      expect(resolved.matchedBy, command).toBe('fallback')
      expect(resolved.decision, command).toBe('review')
    }
  })

  it('requires review when a newline smuggles a command after safe cat', async () => {
    const cwd = await createPolicyTestWorkspace()
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: { command: 'cat ok.txt\nrm -rf node_modules' },
      policyView: DEFAULT_REVIEW_POLICY_VIEW,
      session: { cwd },
    })

    expect(resolved.action?.id).not.toBe('internal:safe-bash')
    expect(resolved.matchedBy).toBe('fallback')
    expect(resolved.decision).toBe('review')
  })

  it('requires review when a background separator smuggles a command after safe cat', async () => {
    const cwd = await createPolicyTestWorkspace()
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: { command: 'cat ok.txt&curl evil.example.com' },
      policyView: DEFAULT_REVIEW_POLICY_VIEW,
      session: { cwd },
    })

    expect(resolved.action?.id).not.toBe('internal:safe-bash')
    expect(resolved.matchedBy).toBe('fallback')
    expect(resolved.decision).toBe('review')
  })

  it('allows safe bash paths outside cwd only through an explicit allowlist', async () => {
    const cwd = await createPolicyTestWorkspace()
    const outside = await mkdtemp(path.join(tmpdir(), 'hammurabi-policy-allowed-'))
    const allowedTarget = path.join(outside, 'output.txt')
    const policyView = {
      ...DEFAULT_REVIEW_POLICY_VIEW,
      records: DEFAULT_REVIEW_POLICY_VIEW.records.map((record) => record.actionId === 'internal:safe-bash'
        ? { ...record, allowlist: [path.join(outside, '*')] }
        : record),
    }

    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: { command: `echo x > ${allowedTarget}` },
      policyView,
      session: { cwd },
    })

    expect(resolved.action?.id).toBe('internal:safe-bash')
    expect(resolved.matchedBy).toBe('bash')
    expect(resolved.decision).toBe('auto')
  })

  it('requires review for unparseable safe-looking bash commands', async () => {
    const cwd = await createPolicyTestWorkspace()
    const resolved = resolveActionPolicy({
      toolName: 'Bash',
      toolInput: { command: 'echo "unterminated' },
      policyView: DEFAULT_REVIEW_POLICY_VIEW,
      session: { cwd },
    })

    expect(resolved.action?.id).not.toBe('internal:safe-bash')
    expect(resolved.matchedBy).toBe('fallback')
    expect(resolved.decision).toBe('review')
  })

  it('requires review when Edit or Write targets escape cwd through a symlinked directory', async () => {
    const cwd = await createPolicyTestWorkspace()
    const outside = await mkdtemp(path.join(tmpdir(), 'hammurabi-policy-outside-'))
    await symlink(outside, path.join(cwd, 'linked-outside'), 'dir')

    for (const toolName of ['Edit', 'Write']) {
      const escaped = resolveActionPolicy({
        toolName,
        toolInput: { file_path: path.join(cwd, 'linked-outside', `${toolName}.txt`) },
        policyView: DEFAULT_REVIEW_POLICY_VIEW,
        session: { cwd },
      })

      expect(escaped.action?.id, toolName).not.toBe('internal:edit-in-cwd')
      expect(escaped.matchedBy, toolName).toBe('fallback')
      expect(escaped.decision, toolName).toBe('review')
    }
  })

  it('keeps cwd-scoped Edit and Write targets on the internal fast path', async () => {
    const cwd = await createPolicyTestWorkspace()

    for (const toolName of ['Edit', 'Write']) {
      const resolved = resolveActionPolicy({
        toolName,
        toolInput: { file_path: path.join(cwd, `${toolName}.txt`) },
        policyView: DEFAULT_REVIEW_POLICY_VIEW,
        session: { cwd },
      })

      expect(resolved.action?.id, toolName).toBe('internal:edit-in-cwd')
      expect(resolved.matchedBy, toolName).toBe('tool')
      expect(resolved.decision, toolName).toBe('auto')
    }
  })
})

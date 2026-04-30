import { describe, expect, it } from 'vitest'
import {
  buildProviderVerificationCommand,
  parseMachineAuthProbeOutput,
  upsertExportedEnvVars,
  upsertTomlStringSetting,
} from '../machine-auth'

describe('agents/machine-auth', () => {
  it('builds provider verification commands that match the supported auth methods', () => {
    expect(buildProviderVerificationCommand('claude')).toBe(
      'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status)',
    )
    expect(buildProviderVerificationCommand('codex')).toBe(
      'codex --version && (test -n "$OPENAI_API_KEY" || codex login status)',
    )
    expect(buildProviderVerificationCommand('gemini')).toBe(
      'gemini --version && (test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY")',
    )
  })

  it('parses auth probe output into provider readiness and current method', () => {
    const report = parseMachineAuthProbeOutput({
      machineId: 'gpu-1',
      envFile: '/Users/builder/.hammurabi-env',
      output: [
        'version:claude:1.0.31',
        'env:claude:CLAUDE_CODE_OAUTH_TOKEN',
        'login:claude:1',
        'version:codex:0.1.2503271400',
        'env:codex:missing',
        'login:codex:0',
        'version:gemini:0.1.18',
        'env:gemini:GOOGLE_API_KEY',
        'login:gemini:n/a',
      ].join('\n'),
    })

    expect(report.providers.claude.configured).toBe(true)
    expect(report.providers.claude.currentMethod).toBe('setup-token')
    expect(report.providers.codex.configured).toBe(true)
    expect(report.providers.codex.currentMethod).toBe('device-auth')
    expect(report.providers.gemini.configured).toBe(true)
    expect(report.providers.gemini.currentMethod).toBe('api-key')
  })

  it('upserts exported env vars without keeping removed secrets', () => {
    const next = upsertExportedEnvVars(
      [
        'export OPENAI_API_KEY=\'old-value\'',
        'export GEMINI_API_KEY=\'old-gemini\'',
        'export KEEP_ME=\'still-here\'',
        '',
      ].join('\n'),
      {
        OPENAI_API_KEY: null,
        CLAUDE_CODE_OAUTH_TOKEN: 'claude-token',
        GEMINI_API_KEY: 'new-gemini',
      },
    )

    expect(next).toContain('export CLAUDE_CODE_OAUTH_TOKEN=')
    expect(next).toContain('export GEMINI_API_KEY=')
    expect(next).toContain('export KEEP_ME=')
    expect(next).not.toContain('old-value')
  })

  it('replaces or appends TOML string settings in-place', () => {
    expect(
      upsertTomlStringSetting(
        'model = "gpt-5"\ncli_auth_credentials_store = "keyring"\n',
        'cli_auth_credentials_store',
        'file',
      ),
    ).toBe('model = "gpt-5"\ncli_auth_credentials_store = "file"\n')

    expect(
      upsertTomlStringSetting(
        'model = "gpt-5"\n',
        'cli_auth_credentials_store',
        'file',
      ),
    ).toBe('model = "gpt-5"\ncli_auth_credentials_store = "file"\n')
  })
})

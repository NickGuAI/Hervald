import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  buildClaudeApprovalHookCommand,
  buildClaudeEnvironmentPrefix,
  buildClaudeLocalLoginShellSpawn,
  buildClaudePtyCommand,
  buildClaudeSpawnEnv,
  buildClaudeStreamArgs,
  mergeClaudeExtraBody,
} from '../../../adapters/claude/helpers'

const UNSET_CLAUDE_CHILD_ENV = 'unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL'

function startApprovalServer(decision: 'allow' | 'deny') {
  return new Promise<{ baseUrl: string; close(): Promise<void> }>((resolve, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ decision }))
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind approval server'))
        return
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error)
              return
            }
            closeResolve()
          })
        }),
      })
    })
  })
}

function runHookThroughShell(command: string, env: NodeJS.ProcessEnv, stdin: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('/bin/sh', ['-lc', command], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(stdin)
  })
}

describe('agents/adapters/claude/helpers', () => {
  it('builds Claude environment and PTY commands', () => {
    expect(buildClaudeEnvironmentPrefix()).toBe(
      `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && ${UNSET_CLAUDE_CHILD_ENV}`,
    )
    expect(buildClaudeEnvironmentPrefix('disabled')).toBe(
      `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1 && ${UNSET_CLAUDE_CHILD_ENV}`,
    )

    expect(buildClaudePtyCommand('default', 'medium')).toBe(
      `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && ${UNSET_CLAUDE_CHILD_ENV} && claude --effort medium`,
    )
    expect(buildClaudePtyCommand('default', 'low', 'disabled')).toBe(
      `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1 && ${UNSET_CLAUDE_CHILD_ENV} && claude --effort low`,
    )
    expect(buildClaudePtyCommand('default', 'high')).toBe(
      `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && ${UNSET_CLAUDE_CHILD_ENV} && claude --effort high`,
    )
  })

  it('embeds structured PreToolUse permission output in the inline approval hook command', () => {
    const command = buildClaudeApprovalHookCommand()
    expect(command.startsWith("node -e '")).toBe(true)
    expect(command).toContain('hookEventName:"PreToolUse"')
    expect(command).toContain('permissionDecision')
    expect(command).toContain('emitPreToolUseDecision("allow"')
  })

  it('shell-escapes the inline approval hook command so sh does not mangle template literals', async () => {
    const approvalServer = await startApprovalServer('allow')

    try {
      const result = await runHookThroughShell(
        buildClaudeApprovalHookCommand(),
        {
          HAMMURABI_APPROVAL_BASE_URL: approvalServer.baseUrl,
          HAMMURABI_APPROVAL_FAIL_OPEN: '',
        },
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'hammurabi quests list' } }),
      )

      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      })
    } finally {
      await approvalServer.close()
    }
  })

  it('passes an explicit model through Claude stream args', () => {
    expect(buildClaudeStreamArgs('default', undefined, undefined, undefined, 'high', undefined, 'claude-opus-4-6'))
      .toEqual(expect.arrayContaining(['--model', 'claude-opus-4-6']))
  })

  it('builds a local login-shell spawn that bootstraps shell init before execing Claude', () => {
    const spawnConfig = buildClaudeLocalLoginShellSpawn(
      ['-p', '--output-format', 'stream-json'],
      'enabled',
      '/tmp/project alpha',
      '/tmp/hammurabi.env',
      '/bin/zsh',
    )

    expect(spawnConfig.command).toBe('/bin/zsh')
    expect(spawnConfig.args).toHaveLength(2)
    expect(spawnConfig.args[0]).toBe('-lc')
    expect(spawnConfig.args[1]).toContain('. "$HOME/.bashrc" >/dev/null 2>&1 || true')
    expect(spawnConfig.args[1]).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
    expect(spawnConfig.args[1]).toContain('. \'/tmp/hammurabi.env\' >/dev/null 2>&1 || true')
    expect(spawnConfig.args[1]).toContain(`cd '/tmp/project alpha' && export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0; ${UNSET_CLAUDE_CHILD_ENV}; claude '-p' '--output-format' 'stream-json'`)
  })
})

describe('agents/adapters/claude/helpers: mergeClaudeExtraBody', () => {
  const expectedThinking = { type: 'adaptive', display: 'summarized' }

  it('returns our defaults when caller did not set the env var', () => {
    expect(JSON.parse(mergeClaudeExtraBody(undefined))).toEqual({ thinking: expectedThinking })
    expect(JSON.parse(mergeClaudeExtraBody(''))).toEqual({ thinking: expectedThinking })
    expect(JSON.parse(mergeClaudeExtraBody('   '))).toEqual({ thinking: expectedThinking })
  })

  it('returns our defaults when caller value is unparseable JSON', () => {
    expect(JSON.parse(mergeClaudeExtraBody('not json'))).toEqual({ thinking: expectedThinking })
  })

  it('preserves caller fields and fills in our defaults when thinking is missing', () => {
    const merged = JSON.parse(
      mergeClaudeExtraBody(JSON.stringify({ metadata: { user_id: 'abc' } })),
    )
    expect(merged.metadata).toEqual({ user_id: 'abc' })
    expect(merged.thinking).toEqual(expectedThinking)
  })

  it('lets caller-provided thinking fields override our defaults', () => {
    const merged = JSON.parse(
      mergeClaudeExtraBody(
        JSON.stringify({ thinking: { display: 'raw', budget_tokens: 2048 } }),
      ),
    )
    expect(merged.thinking).toEqual({ type: 'adaptive', display: 'raw', budget_tokens: 2048 })
  })

  it('leaves a non-object caller thinking value alone', () => {
    const merged = JSON.parse(mergeClaudeExtraBody(JSON.stringify({ thinking: 'off' })))
    expect(merged.thinking).toBe('off')
  })
})

describe('agents/adapters/claude/helpers: buildClaudeSpawnEnv', () => {
  it('injects CLAUDE_CODE_EXTRA_BODY with summarized thinking on every spawn', () => {
    const spawnEnv = buildClaudeSpawnEnv({})
    expect(spawnEnv.CLAUDE_CODE_EXTRA_BODY).toBeDefined()
    const body = JSON.parse(spawnEnv.CLAUDE_CODE_EXTRA_BODY!)
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  })

  it('deep-merges into a caller-provided CLAUDE_CODE_EXTRA_BODY without clobbering other fields', () => {
    const spawnEnv = buildClaudeSpawnEnv({
      CLAUDE_CODE_EXTRA_BODY: JSON.stringify({
        metadata: { user_id: 'op' },
        thinking: { budget_tokens: 8000 },
      }),
    })
    const body = JSON.parse(spawnEnv.CLAUDE_CODE_EXTRA_BODY!)
    expect(body.metadata).toEqual({ user_id: 'op' })
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized', budget_tokens: 8000 })
  })

  it('scrubs inherited Claude runtime env that can poison child model selection', () => {
    const spawnEnv = buildClaudeSpawnEnv({
      CLAUDECODE: '1',
      ANTHROPIC_MODEL: 'claude-opus-4-6-[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6-[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5-[1m]',
      PORT: '20002',
    })
    expect(spawnEnv.CLAUDECODE).toBeUndefined()
    expect(spawnEnv.ANTHROPIC_MODEL).toBeUndefined()
    expect(spawnEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(spawnEnv.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(spawnEnv.HAMMURABI_PORT).toBe('20002')
  })
})

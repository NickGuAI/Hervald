import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HOOK_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'claude-approval-hook.mjs',
)

interface HookResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

interface MockApprovalServer {
  baseUrl: string
  close(): Promise<void>
}

function runHook(env: NodeJS.ProcessEnv, stdin: string): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

async function startApprovalServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<MockApprovalServer> {
  const server = http.createServer(handler)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected approval server to bind to an ephemeral TCP port')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  }
}

describe('claude-approval-hook', () => {
  it('emits structured PreToolUse allow output when Hammurabi auto-approves', async () => {
    const approvalServer = await startApprovalServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ decision: 'allow' }))
    })

    try {
      const result = await runHook(
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

  it('polls pending approvals until a terminal allow decision arrives', async () => {
    let pollCount = 0
    const approvalServer = await startApprovalServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/api/approval/check') {
        res.end(JSON.stringify({
          decision: 'pending',
          request_id: 'req-1',
          retry_after_ms: 10,
        }))
        return
      }

      pollCount += 1
      if (pollCount < 2) {
        res.end(JSON.stringify({
          decision: 'pending',
          request_id: 'req-1',
          retry_after_ms: 10,
        }))
        return
      }

      res.end(JSON.stringify({ decision: 'allow' }))
    })

    try {
      const result = await runHook(
        {
          HAMMURABI_APPROVAL_BASE_URL: approvalServer.baseUrl,
          HAMMURABI_APPROVAL_FAIL_OPEN: '',
        },
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/example' } }),
      )

      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      })
      expect(pollCount).toBeGreaterThanOrEqual(2)
    } finally {
      await approvalServer.close()
    }
  })

  it('fails closed (exit 2) when the approval service is unreachable', async () => {
    const result = await runHook(
      {
        HAMMURABI_APPROVAL_BASE_URL: 'http://127.0.0.1:1',
        HAMMURABI_APPROVAL_FAIL_OPEN: '',
      },
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }),
    )

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('[hammurabi-approval-hook]')
    expect(result.stderr.toLowerCase()).toContain('blocking by default')
  })

  it('honours HAMMURABI_APPROVAL_FAIL_OPEN=1 by emitting a structured allow on unreachable approval service', async () => {
    const result = await runHook(
      {
        HAMMURABI_APPROVAL_BASE_URL: 'http://127.0.0.1:1',
        HAMMURABI_APPROVAL_FAIL_OPEN: '1',
      },
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }),
    )

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('[hammurabi-approval-hook]')
    expect(result.stderr).toContain('HAMMURABI_APPROVAL_FAIL_OPEN=1')

    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput: {
        hookEventName: string
        permissionDecision: string
        permissionDecisionReason: string
      }
    }
    expect(payload).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: expect.stringContaining('approval service unreachable'),
      },
    })
  })

  it('fails closed when a pending approval never reaches a terminal decision before the hook deadline', async () => {
    const approvalServer = await startApprovalServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url?.startsWith('/api/approval/check/')) {
        res.end(JSON.stringify({
          decision: 'pending',
          request_id: 'req-timeout',
          retry_after_ms: 10,
        }))
        return
      }

      res.end(JSON.stringify({
        decision: 'pending',
        request_id: 'req-timeout',
        retry_after_ms: 10,
      }))
    })

    try {
      const result = await runHook(
        {
          HAMMURABI_APPROVAL_BASE_URL: approvalServer.baseUrl,
          HAMMURABI_APPROVAL_DEADLINE_MS: '75',
          HAMMURABI_APPROVAL_FAIL_OPEN: '',
        },
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } }),
      )

      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('approval review deadline exceeded')
    } finally {
      await approvalServer.close()
    }
  })
})

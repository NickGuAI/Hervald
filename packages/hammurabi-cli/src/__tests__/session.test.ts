import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runSessionCli } from '../session.js'

interface BufferWriter {
  writer: { write: (chunk: string) => boolean }
  read: () => string
}

function createBufferWriter(): BufferWriter {
  let buffer = ''
  return {
    writer: {
      write(chunk: string): boolean {
        buffer += chunk
        return true
      },
    },
    read(): string {
      return buffer
    },
  }
}

const config = createHammurabiConfig({
  endpoint: 'https://hervald.gehirn.ai',
  apiKey: 'hmrb_test_key',
  agents: ['claude-code'],
  configuredAt: new Date('2026-03-01T00:00:00.000Z'),
})

describe('runSessionCli', () => {
  it('prints usage when no subcommand given', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli([], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(stdout.read()).toContain('hammurabi session register')
  })

  it('prints usage on --help', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['--help'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stdout.read()).toContain('Usage:')
  })

  it('lists sessions across categories', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'commander-main', sessionType: 'commander', status: 'active' },
          { name: 'worker-1710000000000', sessionType: 'worker', cwd: '/tmp/worktree' },
          { name: 'sentinel-email-1', sessionType: 'sentinel', host: 'mac-mini' },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Active sessions:')
    expect(stdout.read()).toContain('commander-main type=commander status=active')
    expect(stdout.read()).toContain('worker-1710000000000 type=worker cwd=/tmp/worktree')
    expect(stdout.read()).toContain('sentinel-email-1 type=sentinel host=mac-mini')
  })

  it('filters listed sessions by --type', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'commander-main', sessionType: 'commander' },
          { name: 'worker-1710000000000', sessionType: 'worker' },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['list', '--type=worker'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('worker-1710000000000 type=worker')
    expect(stdout.read()).not.toContain('commander-main')
  })

  it('lists worker payloads without legacy aliases', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'fixer', sessionType: 'worker' },
          { name: 'agent-1710000000000', sessionType: 'worker' },
          { name: 'factory-1710000000001', sessionType: 'worker' },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['list', '--type=worker'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('fixer type=worker')
    expect(stdout.read()).toContain('agent-1710000000000 type=worker')
    expect(stdout.read()).toContain('factory-1710000000001 type=worker')
  })

  it('omits exited sessions from sessions list output', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'worker-1710000000000', sessionType: 'worker', status: 'active' },
          { name: 'worker-1710000000001', sessionType: 'worker', status: 'exited' },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('worker-1710000000000 type=worker status=active')
    expect(stdout.read()).not.toContain('worker-1710000000001')
  })

  it('shows session info', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'worker-1710000000000',
          sessionType: 'worker',
          transportType: 'stream',
          status: 'running',
          created: '2026-04-14T00:00:00.000Z',
          lastActivityAt: '2026-04-14T00:05:00.000Z',
          spawnedBy: 'commander-main',
          spawnedWorkers: ['worker-1710000000000'],
          cwd: '/tmp/worktree',
          host: 'mac-mini',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['info', 'worker-1710000000000'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Session: worker-1710000000000')
    expect(stdout.read()).toContain('Type: worker')
    expect(stdout.read()).toContain('Transport: stream')
    expect(stdout.read()).toContain('Created: 2026-04-14T00:00:00.000Z')
    expect(stdout.read()).toContain('Last activity: 2026-04-14T00:05:00.000Z')
    expect(stdout.read()).toContain('Spawned by: commander-main')
  })

  it('shows session info tail output when --tail is provided', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-22T12:00:05.000Z'))

    try {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const target = String(url)
        if (target.endsWith('/api/agents/sessions/worker-1710000000000')) {
          return new Response(
            JSON.stringify({
              name: 'worker-1710000000000',
              sessionType: 'worker',
              transportType: 'stream',
              status: 'running',
              created: '2026-04-14T00:00:00.000Z',
              lastActivityAt: '2026-04-14T00:05:00.000Z',
              spawnedBy: 'commander-main',
              spawnedWorkers: ['worker-1710000000000'],
              cwd: '/tmp/worktree',
              host: 'mac-mini',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        }

        if (target.endsWith('/api/agents/sessions/worker-1710000000000/messages?last=2&includeToolUse=true')) {
          return new Response(
            JSON.stringify({
              session: 'worker-1710000000000',
              total: 12,
              returned: 2,
              messages: [
                {
                  ts: '2026-04-22T12:00:03.000Z',
                  type: 'assistant',
                  kind: 'text',
                  preview: 'tail text',
                },
                {
                  ts: '2026-04-22T12:00:04.000Z',
                  type: 'user',
                  kind: 'tool_result',
                  tool: 'Edit',
                  preview: 'Applied',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        }

        return new Response(JSON.stringify({ error: `Unexpected URL: ${target}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      })
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runSessionCli(['info', 'worker-1710000000000', '--tail', '2'], {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('Session: worker-1710000000000')
      expect(stdout.read()).toContain('last 2:')
      expect(stdout.read()).toContain('assistant/text')
      expect(stdout.read()).toContain('Edit  "Applied"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits JSON for session info when --json is provided', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url)
      if (target.endsWith('/api/agents/sessions/worker-1710000000000')) {
        return new Response(
          JSON.stringify({
            name: 'worker-1710000000000',
            sessionType: 'worker',
            transportType: 'stream',
            status: 'running',
            created: '2026-04-14T00:00:00.000Z',
            lastActivityAt: '2026-04-14T00:05:00.000Z',
            spawnedBy: 'commander-main',
            spawnedWorkers: ['worker-1710000000000'],
            cwd: '/tmp/worktree',
            host: 'mac-mini',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      if (target.endsWith('/api/agents/sessions/worker-1710000000000/messages?last=5&includeToolUse=true')) {
        return new Response(
          JSON.stringify({
            session: 'worker-1710000000000',
            total: 12,
            returned: 5,
            messages: [
              {
                ts: '2026-04-22T12:00:03.000Z',
                type: 'assistant',
                kind: 'text',
                preview: 'tail text',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      return new Response(JSON.stringify({ error: `Unexpected URL: ${target}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['info', 'worker-1710000000000', '--json'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')

    const payload = JSON.parse(stdout.read()) as {
      session: string
      sessionType: string
      transport: string
      status: string
      events: { total: number; returned: number }
      messages: Array<{ preview: string }>
    }

    expect(payload).toMatchObject({
      session: 'worker-1710000000000',
      sessionType: 'worker',
      transport: 'stream',
      status: 'running',
      events: {
        total: 12,
        returned: 5,
      },
    })
    expect(payload.messages[0]?.preview).toBe('tail text')
  })

  it('requires a session name for info', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['info'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects factory list filters', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['list', '--type=factory'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('register requires --name', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['register', '--machine', 'laptop'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('--name is required')
  })

  it('register requires --machine', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['register', '--name', 'my-session'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('--machine is required')
  })

  it('registers an external session', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          registered: true,
          name: 'my-session',
          agentType: 'claude',
          machine: 'my-laptop',
          cwd: '/home/user/project',
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(
      ['register', '--name', 'my-session', '--machine', 'my-laptop', '--cwd', '/home/user/project'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Registered session "my-session" from my-laptop')

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/register',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          name: 'my-session',
          machine: 'my-laptop',
          cwd: '/home/user/project',
        }),
      }),
    )
  })

  it('handles register conflict', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Session "my-session" already exists' }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(
      ['register', '--name', 'my-session', '--machine', 'laptop'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Register failed (409)')
    expect(stderr.read()).toContain('already exists')
  })

  it('sends a heartbeat', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, status: 'connected' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(
      ['heartbeat', '--name', 'my-session'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Heartbeat sent for "my-session"')

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/my-session/heartbeat',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('pushes events', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ accepted: 2 }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const events = JSON.stringify([
      { type: 'assistant', message: { role: 'assistant' } },
      { type: 'result', subtype: 'success' },
    ])

    const exitCode = await runSessionCli(
      ['events', '--name', 'my-session', '--events', events],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Pushed 2 event(s) to "my-session"')
  })

  it('unregisters a session', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ killed: true }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(
      ['unregister', '--name', 'my-session'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Session "my-session" unregistered')
  })

  it('fails when not configured', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['register', '--name', 'x', '--machine', 'y'], {
      readConfig: async () => null,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Not configured')
  })

  it('rejects unknown subcommand', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(['bogus'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Unknown session subcommand: bogus')
  })

  it('events requires valid JSON', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(
      ['events', '--name', 'my-session', '--events', 'not-json'],
      {
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('must be valid JSON')
  })

  it('events requires JSON array', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runSessionCli(
      ['events', '--name', 'my-session', '--events', '{"type":"foo"}'],
      {
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('must be a JSON array')
  })
})

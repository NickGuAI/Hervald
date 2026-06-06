import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runEvalCli } from '../eval.js'

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
  endpoint: 'https://hervald.gehirn.ai/',
  apiKey: 'hmrb_test_key',
  agents: ['codex'],
  configuredAt: new Date('2026-06-01T00:00:00.000Z'),
})

describe('runEvalCli', () => {
  it('bootstraps the benchmark commander with the issue payload and template id', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'cmdr-benchmark',
          sessionName: 'commander-cmdr-benchmark',
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runEvalCli(
      ['commander', 'bootstrap', '--host', 'builder-host', '--model', 'gpt-5.5'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Benchmark commander: cmdr-benchmark')
    expect(stdout.read()).toContain('Session: commander-cmdr-benchmark')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/commanders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
      }),
    )

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      templateId: 'benchmark',
      displayName: 'Benchmark Commander',
      agentType: 'codex',
      host: 'builder-host',
      model: 'gpt-5.5',
      cwd: '/home/builder/App/benchmarks/hammurabi',
      maxTurns: 300,
      contextMode: 'fat',
      contextConfig: { fatPinInterval: 2 },
      taskSource: {
        owner: 'NickGuAI',
        repo: 'Hervald',
        label: 'benchmark',
      },
    })
    expect(body.heartbeat).toMatchObject({ intervalMs: 1800000 })
  })

  it('calls eval doctor with subscription runner mode without treating it as an api key', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runEvalCli(
      ['doctor', '--bench', 'terminal-bench', '--runner', 'subscription-host-cli'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/eval/doctor?bench=terminal-bench&runner=subscription-host-cli',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('api-key')
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('OPENAI_API_KEY')
  })

  it('calls eval doctor with api-key runner mode distinctly from subscription auth', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runEvalCli(
      ['doctor', '--bench', 'terminal-bench', '--runner', 'api-key'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/eval/doctor?bench=terminal-bench&runner=api-key',
      expect.any(Object),
    )
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('subscription-host-cli')
  })

  it('rejects invalid runner modes before dispatching', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runEvalCli(
      [
        'run',
        'terminal-bench',
        '--trials',
        '4',
        '--commander',
        'cmdr-benchmark',
        '--profile',
        'smoke',
        '--runner',
        'subscription',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('hammurabi eval run <bench>')
    expect(stderr.read()).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('dispatches eval run through the canonical commander worker route', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000)
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionName: 'eval-terminal-bench-1800000000000',
          created: true,
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    try {
      const exitCode = await runEvalCli(
        [
          'run',
          'terminal-bench',
          '--trials',
          '4',
          '--commander',
          'cmdr-benchmark',
          '--profile',
          'smoke',
          '--runner',
          'subscription-sbx',
        ],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('Eval worker dispatched: eval-terminal-bench-1800000000000')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/commanders/cmdr-benchmark/workers',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer hmrb_test_key',
            'content-type': 'application/json',
          }),
        }),
      )
      expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('/api/agents/sessions/dispatch-worker')

      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        name: 'eval-terminal-bench-1800000000000',
        agentType: 'codex',
        cwd: '/home/builder/App/benchmarks/hammurabi',
      })
      expect(body).not.toHaveProperty('creator')
      expect(body).not.toHaveProperty('parentSession')
      expect(body).not.toHaveProperty('machine')
      expect(String(body.task)).toContain('hammurabi eval doctor --bench terminal-bench --runner subscription-sbx')
      expect(String(body.task)).toContain('PYTHONPATH=/home/builder/App/benchmarks/hammurabi:/home/builder/App/benchmarks/hammurabi/terminal_bench')
      expect(String(body.task)).toContain(
        'python3 -m hammurabi_terminal_bench.runner --run-id eval-terminal-bench-1800000000000 --profile smoke --trials 4 --runner-mode subscription-sbx --eval-root ~/.hammurabi/eval --smoke',
      )
      expect(String(body.task)).not.toContain('/home/builder/App/apps/hammurabi/agents')
      expect(String(body.task)).toContain('do not run `hammurabi eval run` inside this worker')
      expect(String(body.task)).not.toContain('~/.codex')
      expect(String(body.task)).not.toContain('~/.claude')
      expect(String(body.task)).not.toContain('auth.json')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('calls list, status, report, and submit eval endpoints', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    await runEvalCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })
    await runEvalCli(['status', 'run-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })
    await runEvalCli(['report', 'run-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })
    await runEvalCli(['submit', 'run-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(stderr.read()).toBe('')
    expect(fetchImpl.mock.calls.map((call) => [String(call[0]), call[1]?.method])).toEqual([
      ['https://hervald.gehirn.ai/api/eval/list', 'GET'],
      ['https://hervald.gehirn.ai/api/eval/runs/run-1/status', 'GET'],
      ['https://hervald.gehirn.ai/api/eval/runs/run-1/report', 'GET'],
      ['https://hervald.gehirn.ai/api/eval/runs/run-1/submit', 'POST'],
    ])
  })

  it('prints stored api key recovery guidance on 401', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runEvalCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toContain('.hammurabi.json')
    expect(stderr.read()).toContain('api-keys/keys.json')
    expect(stderr.read()).toContain('hammurabi onboard')
  })
})

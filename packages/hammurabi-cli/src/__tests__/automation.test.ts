import { describe, expect, it, vi } from 'vitest'
import { runAutomationCli } from '../automation.js'
import { createHammurabiConfig } from '../config.js'

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

const providerRegistryPayload = [
  {
    id: 'claude',
    label: 'Claude',
    eventProvider: 'claude',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
  },
]

describe('runAutomationCli', () => {
  it('prints usage when no subcommand is provided', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runAutomationCli([], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(stderr.read()).toBe('')
  })

  it('lists automations with commander and trigger filters', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([
        {
          id: 'auto-1',
          name: 'daily-briefing',
          trigger: 'schedule',
          status: 'active',
          schedule: '27 6 * * *',
          enabled: true,
          parentCommanderId: 'cmd-1',
        },
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runAutomationCli(['list', '--commander', 'cmd-1', '--trigger', 'schedule'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('daily-briefing')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/automations?parentCommanderId=cmd-1&trigger=schedule',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('creates a schedule automation with unified fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://hervald.gehirn.ai/api/providers') {
        return new Response(JSON.stringify(providerRegistryPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://hervald.gehirn.ai/api/automations') {
        return new Response(JSON.stringify({ id: 'auto-1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runAutomationCli(
      [
        'create',
        '--trigger',
        'schedule',
        '--name',
        'daily-briefing',
        '--instruction',
        '/daily-briefing',
        '--commander',
        'cmd-1',
        '--schedule',
        '27 6 * * *',
        '--timezone',
        'America/New_York',
        '--model',
        'claude-opus-4-6',
        '--agent',
        'claude',
        '--work-dir',
        '/home/builder/App',
        '--machine',
        'mbp',
        '--permission-mode',
        'default',
        '--session-type',
        'stream',
        '--enabled',
        'true',
        '--skills',
        'daily-briefing,write-report',
        '--seed-memory',
        'Use the latest calendar notes.',
        '--max-runs',
        '15',
        '--description',
        'Morning automation',
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
    expect(stdout.read()).toContain('Created automation ID: auto-1')

    const call = fetchImpl.mock.calls.find(([url]) => String(url) === 'https://hervald.gehirn.ai/api/automations')
    expect(call?.[0]).toBe('https://hervald.gehirn.ai/api/automations')
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      trigger: 'schedule',
      name: 'daily-briefing',
      instruction: '/daily-briefing',
      parentCommanderId: 'cmd-1',
      description: 'Morning automation',
      schedule: '27 6 * * *',
      timezone: 'America/New_York',
      model: 'claude-opus-4-6',
      agentType: 'claude',
      workDir: '/home/builder/App',
      machine: 'mbp',
      permissionMode: 'default',
      sessionType: 'stream',
      enabled: true,
      skills: ['daily-briefing', 'write-report'],
      seedMemory: 'Use the latest calendar notes.',
      maxRuns: 15,
    })
  })

  it('creates a quest automation with an explicit trigger payload', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'auto-quest-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const exitCode = await runAutomationCli(
      [
        'create',
        '--trigger',
        'quest',
        '--name',
        'quest-summary',
        '--instruction',
        'Summarize the completed quest',
        '--quest-commander',
        'cmd-2',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
      },
    )

    expect(exitCode).toBe(0)
    const call = fetchImpl.mock.calls[0]
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      trigger: 'quest',
      name: 'quest-summary',
      instruction: 'Summarize the completed quest',
      enabled: true,
      questTrigger: {
        event: 'completed',
        commanderId: 'cmd-2',
      },
    })
  })

  it('updates an automation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'auto-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()

    const exitCode = await runAutomationCli(
      ['update', 'auto-1', '--enabled', 'false', '--schedule', '0 7 * * *'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stdout.read()).toContain('Updated automation auto-1.')
    const call = fetchImpl.mock.calls[0]
    expect(call?.[0]).toBe('https://hervald.gehirn.ai/api/automations/auto-1')
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      schedule: '0 7 * * *',
      enabled: false,
    })
  })

  it('shows automation details', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'auto-1',
        name: 'daily-briefing',
        trigger: 'schedule',
        status: 'active',
        schedule: '27 6 * * *',
        timezone: 'America/New_York',
        enabled: true,
        parentCommanderId: 'cmd-1',
        skills: ['daily-briefing'],
        totalRuns: 4,
        totalCostUsd: 1.25,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()

    const exitCode = await runAutomationCli(['show', 'auto-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
    })

    expect(exitCode).toBe(0)
    const output = stdout.read()
    expect(output).toContain('ID: auto-1')
    expect(output).toContain('Trigger: schedule')
    expect(output).toContain('Schedule: 27 6 * * *')
    expect(output).toContain('Commander: cmd-1')
    expect(output).toContain('Skills: daily-briefing')
    expect(output).toContain('Total Runs: 4')
  })

  it('renders automation history entries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([
        {
          timestamp: '2026-04-06T13:00:00.000Z',
          action: 'email_followup',
          result: 'sent',
          costUsd: 0.0312,
          durationSec: 9,
          sessionId: 'session-1',
        },
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()

    const exitCode = await runAutomationCli(['history', 'auto-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
    })

    expect(exitCode).toBe(0)
    const output = stdout.read()
    expect(output).toContain('TIMESTAMP')
    expect(output).toContain('STATUS')
    expect(output).toContain('DURATION')
    expect(output).toContain('DETAIL')
    expect(output).toContain('sent')
    expect(output).toContain('email_followup')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/automations/auto-1/history?limit=10',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('fires a manual run through /run', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'run-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()

    const exitCode = await runAutomationCli(['trigger', 'auto-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
    })

    expect(exitCode).toBe(0)
    expect(stdout.read()).toContain('Triggered automation auto-1 (run run-1).')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/automations/auto-1/run',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('pause and resume patch automation status', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()

    const commands: Array<[string, string]> = [
      ['pause', 'paused'],
      ['resume', 'active'],
    ]

    for (const [command] of commands) {
      const exitCode = await runAutomationCli([command, 'auto-1'], {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      })
      expect(exitCode).toBe(0)
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const [index, [, status]] of commands.entries()) {
      const call = fetchImpl.mock.calls[index]
      expect(call?.[0]).toBe('https://hervald.gehirn.ai/api/automations/auto-1')
      expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({ status })
    }
  })

  it('deletes an automation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    )
    const stdout = createBufferWriter()

    const exitCode = await runAutomationCli(['delete', 'auto-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
    })

    expect(exitCode).toBe(0)
    expect(stdout.read()).toContain('Deleted automation auto-1.')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/automations/auto-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runConversationsCli } from '../conversations.js'
import { runCli } from '../index.js'

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

describe('runConversationsCli', () => {
  it('lists conversations for a commander', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            commanderId: 'cmdr-1',
            surface: 'cli',
            status: 'active',
            liveSession: { name: 'commander-cmdr-1-conversation-11111111' },
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            commanderId: 'cmdr-1',
            surface: 'ui',
            status: 'idle',
            liveSession: null,
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runConversationsCli(['list', '--commander', 'cmdr-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Conversations:')
    expect(stdout.read()).toContain(
      '- 11111111-1111-4111-8111-111111111111 surface=cli status=active live=yes',
    )
    expect(stdout.read()).toContain(
      '- 22222222-2222-4222-8222-222222222222 surface=ui status=idle live=no',
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/commanders/cmdr-1/conversations',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('creates a conversation and prints its id', async () => {
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: conversationId,
          commanderId: 'cmdr-2',
          surface: 'api',
          status: 'idle',
          liveSession: null,
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runConversationsCli(
      ['create', '--commander', 'cmdr-2', '--surface', 'api'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toBe(`${conversationId}\n`)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/commanders/cmdr-2/conversations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ surface: 'api' }),
      }),
    )
  })

  it('attaches to an existing conversation through the resume route', async () => {
    const conversationId = '44444444-4444-4444-8444-444444444444'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: conversationId,
          commanderId: 'cmdr-3',
          surface: 'cli',
          status: 'active',
          liveSession: { name: 'commander-cmdr-3-conversation-44444444' },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runConversationsCli(['attach', conversationId], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toBe(`Conversation ${conversationId} attached.\n`)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://hervald.gehirn.ai/api/conversations/${conversationId}/resume`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('archives a conversation through the archive route', async () => {
    const conversationId = '55555555-5555-4555-8555-555555555555'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: conversationId,
          commanderId: 'cmdr-4',
          surface: 'ui',
          status: 'archived',
          liveSession: null,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runConversationsCli(['archive', conversationId], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toBe(`Conversation ${conversationId} archived.\n`)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://hervald.gehirn.ai/api/conversations/${conversationId}/archive`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('prints recovery guidance on 401 errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runConversationsCli(['attach', '66666666-6666-4666-8666-666666666666'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toContain('.hammurabi.json')
    expect(stderr.read()).toContain('api-keys/keys.json')
    expect(stderr.read()).toContain('HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1')
    expect(stderr.read()).toContain('hammurabi onboard')
  })

  it('prints usage for invalid arguments', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runConversationsCli(['create', '--commander', 'cmdr-1'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
  })
})

describe('hammurabi root help', () => {
  it('mentions the conversations command', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      const exitCode = await runCli(['unknown-command'])
      expect(exitCode).toBe(1)
      const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('')
      expect(output).toContain('hammurabi conversations <command>')
    } finally {
      stdoutSpy.mockRestore()
    }
  })
})

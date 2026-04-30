import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runMemoryCli } from '../memory.js'

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

describe('runMemoryCli', () => {
  it('prints usage when no subcommand is given', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMemoryCli([], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(stdout.read()).toContain('hammurabi memory save')
    expect(stdout.read()).toContain('hammurabi memory export')
    expect(stdout.read()).toContain('hammurabi memory --type=working_memory append')
    expect(stdout.read()).toContain('hammurabi memory --type=working_memory read')
    expect(stdout.read()).toContain('hammurabi memory --type=working_memory clear')
  })

  it('prints usage for unknown subcommand', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMemoryCli(['unknown'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
  })

  describe('working memory', () => {
    it('posts append requests to the working-memory endpoint', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ content: '# Working Memory\n\n- note' }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(
        ['--type=working_memory', 'append', '--commander', 'cmdr-1', 'Investigate trim policy'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('Working memory updated for cmdr-1.')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/commanders/cmdr-1/memory/working-memory',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer hmrb_test_key',
            'content-type': 'application/json',
          }),
          body: JSON.stringify({ content: 'Investigate trim policy' }),
        }),
      )
    })

    it('reads working memory from the API', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ content: '# Working Memory\n\n- Active note' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(
        ['--type', 'working_memory', 'read', '--commander', 'cmdr-1'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('# Working Memory')
      expect(stdout.read()).toContain('Active note')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/commanders/cmdr-1/memory/working-memory',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            authorization: 'Bearer hmrb_test_key',
          }),
        }),
      )
    })

    it('clears working memory through the API', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 204 }),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(
        ['--type=working_memory', 'clear', '--commander', 'cmdr-1'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('Working memory cleared for cmdr-1.')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/commanders/cmdr-1/memory/working-memory',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            authorization: 'Bearer hmrb_test_key',
          }),
        }),
      )
    })
  })

  describe('save', () => {
    it('posts facts to facts endpoint and prints confirmation', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            factsAdded: 2,
            lineCount: 47,
            evicted: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(
        ['save', '--commander', 'cmdr-1', 'Prisma needs set for arrays', '--fact', 'Always use pnpm'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('Saved 2 facts to MEMORY.md (47 total lines).')

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/commanders/cmdr-1/memory/facts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer hmrb_test_key',
            'content-type': 'application/json',
          }),
        }),
      )

      const sentBody = JSON.parse(
        (fetchImpl.mock.calls[0]?.[1] as RequestInit)?.body as string,
      )
      expect(sentBody).toEqual({
        facts: ['Prisma needs set for arrays', 'Always use pnpm'],
      })
    })

    it('prints usage when no facts are provided', async () => {
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(
        ['save', '--commander', 'cmdr-1'],
        {
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(1)
      expect(stdout.read()).toContain('Usage:')
    })

    it('prints error on server failure', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Failed to save facts' }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(
        ['save', '--commander', 'cmdr-1', 'some fact'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(1)
      expect(stderr.read()).toContain('Request failed (500)')
    })

    it('prints keystore recovery guidance on 401', async () => {
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

      const exitCode = await runMemoryCli(
        ['save', '--commander', 'cmdr-1', 'some fact'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(1)
      expect(stderr.read()).toContain('.hammurabi.json')
      expect(stderr.read()).toContain('api-keys/keys.json')
      expect(stderr.read()).toContain('HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1')
      expect(stderr.read()).toContain('hammurabi onboard')
    })
  })

  describe('export', () => {
    it('gets memory export payload and prints json', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            syncRevision: 7,
            memoryMd: '# Commander Memory\n\n- Fact',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runMemoryCli(['export', '--commander', 'cmdr-1'], {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('"syncRevision": 7')
      expect(stdout.read()).toContain('"memoryMd": "# Commander Memory')

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/commanders/cmdr-1/memory/export',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            authorization: 'Bearer hmrb_test_key',
          }),
        }),
      )
    })
  })

  it('reports missing config', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMemoryCli(['export', '--commander', 'cmdr-1'], {
      readConfig: async () => null,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Hammurabi config not found')
  })

  it('prints usage for removed find subcommand', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMemoryCli(['find', '--commander', 'cmdr-1', 'query'], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(stdout.read()).not.toContain('hammurabi memory find')
  })
})

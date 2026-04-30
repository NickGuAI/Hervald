import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runTranscriptsCli } from '../transcripts.js'

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

describe('runTranscriptsCli', () => {
  it('prints usage when no subcommand is given', async () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runTranscriptsCli([], {
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(stdout.read()).toContain('hammurabi commander transcripts search')
  })

  it('posts transcript search requests and prints formatted hits', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: [
            {
              score: 0.9142,
              text: 'Reset rebuilt the commander identity and system prompt from disk.',
              sourceFile: '/tmp/commander/sessions/2026-03-28.jsonl',
              transcriptId: '2026-03-28',
              timestamp: '2026-03-28T11:20:00.000Z',
              role: 'assistant',
              turnNumber: 142,
              messageIndex: 1,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runTranscriptsCli(
      ['search', '--commander', 'cmdr-1', '--top-k', '3', 'rotation reset'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Found 1 transcript hit for cmdr-1.')
    expect(stdout.read()).toContain('[0.9142] 2026-03-28 assistant turn 142 @ 2026-03-28T11:20:00.000Z')
    expect(stdout.read()).toContain('Reset rebuilt the commander identity and system prompt from disk.')
    expect(stdout.read()).toContain('Source: /tmp/commander/sessions/2026-03-28.jsonl')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/commanders/cmdr-1/transcripts/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          query: 'rotation reset',
          topK: 3,
        }),
      }),
    )
  })

  it('prints a friendly message when no transcript hits are found', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ hits: [] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runTranscriptsCli(
      ['search', '--commander', 'cmdr-1', 'rotation reset'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toBe('No transcript hits found for cmdr-1.\n')
  })
})

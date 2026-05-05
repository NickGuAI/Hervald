import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runQuestsCli } from '../quests.js'

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

describe('runQuestsCli', () => {
  it('formats pending and active quests for list', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          quests: [
            {
              id: 'quest-1',
              status: 'pending',
              title: 'Prepare deployment checklist',
              claimedByConversationId: null,
              artifacts: [{ type: 'url', label: 'Doc', href: 'https://example.com/doc' }],
            },
            {
              id: 'quest-2',
              status: 'active',
              title: 'Patch telemetry emitter',
              claimedByConversationId: null,
            },
            { id: 'quest-3', status: 'done', title: 'Archive incident writeup' },
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

    const exitCode = await runQuestsCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain(
      'Pending quests:\n- quest-1 [unclaimed] Prepare deployment checklist [1 artifacts]\n',
    )
    expect(stdout.read()).toContain('Active quests:\n- quest-2 [unclaimed] Patch telemetry emitter\n')
    expect(stdout.read()).not.toContain('quest-3')

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/commanders/cmdr-1/quests',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('marks caller-owned quests as mine in list output', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          quests: [
            {
              id: 'quest-mine',
              status: 'active',
              title: 'Caller-owned quest',
              claimedByConversationId: 'conv-calling-123',
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

    const exitCode = await runQuestsCli(['list', '--conversation', 'conv-calling-123'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('- quest-mine [MINE] Caller-owned quest\n')
  })

  it('marks sibling-owned quests with the short conversation id in list output', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          quests: [
            {
              id: 'quest-sibling',
              status: 'active',
              title: 'Sibling-owned quest',
              claimedByConversationId: 'abcdef12-3456-7890-abcd-ef1234567890',
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

    const exitCode = await runQuestsCli(['list', '--conversation', 'conv-calling-123'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('- quest-sibling [claimed by abcdef12] Sibling-owned quest\n')
    expect(stdout.read()).not.toContain('[MINE]')
  })

  it('marks unclaimed quests in list output', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          quests: [
            {
              id: 'quest-open',
              status: 'pending',
              title: 'Open quest',
              claimedByConversationId: null,
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

    const exitCode = await runQuestsCli(['list', '--conversation', 'conv-calling-123'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('- quest-open [unclaimed] Open quest\n')
  })

  it('never renders mine when list has no calling-conversation context', async () => {
    vi.stubEnv('HAMMURABI_CONVERSATION_ID', '')
    vi.stubEnv('HAMMURABI_COMMANDER_RUNTIME_CONVERSATION_ID', '')

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          quests: [
            {
              id: 'quest-no-context',
              status: 'active',
              title: 'Claimed without local context',
              claimedByConversationId: 'abcdef12-3456-7890-abcd-ef1234567890',
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

    try {
      const exitCode = await runQuestsCli(['list'], {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain(
        '- quest-no-context [claimed by abcdef12] Claimed without local context\n',
      )
      expect(stdout.read()).not.toContain('[MINE]')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('prints keystore recovery guidance on 401 from list', async () => {
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

    const exitCode = await runQuestsCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('.hammurabi.json')
    expect(stderr.read()).toContain('api-keys/keys.json')
    expect(stderr.read()).toContain('HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1')
    expect(stderr.read()).toContain('hammurabi onboard')
  })

  it('sends POST for claim using explicit conversation id', async () => {
    vi.stubEnv('HAMMURABI_CONVERSATION_ID', 'conv-from-primary-env')
    vi.stubEnv('HAMMURABI_COMMANDER_RUNTIME_CONVERSATION_ID', 'conv-from-runtime-env')

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    try {
      const exitCode = await runQuestsCli(['claim', 'quest-42', '--conversation', 'conv-42'], {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      const call = fetchImpl.mock.calls[0]
      expect(call?.[0]).toBe(
        'https://hervald.gehirn.ai/api/commanders/cmdr-1/quests/quest-42/claim',
      )
      expect(call?.[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
      })
      expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
        conversationId: 'conv-42',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses HAMMURABI_CONVERSATION_ID before runtime conversation env for claim', async () => {
    vi.stubEnv('HAMMURABI_CONVERSATION_ID', 'conv-from-primary-env')
    vi.stubEnv('HAMMURABI_COMMANDER_RUNTIME_CONVERSATION_ID', 'conv-from-runtime-env')

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    try {
      const exitCode = await runQuestsCli(['claim', 'quest-42'], {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      const call = fetchImpl.mock.calls[0]
      expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
        conversationId: 'conv-from-primary-env',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses runtime conversation env for claim when primary conversation env is absent', async () => {
    vi.stubEnv('HAMMURABI_CONVERSATION_ID', '')
    vi.stubEnv('HAMMURABI_COMMANDER_RUNTIME_CONVERSATION_ID', 'conv-from-runtime-env')

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    try {
      const exitCode = await runQuestsCli(['claim', 'quest-42'], {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      const call = fetchImpl.mock.calls[0]
      expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
        conversationId: 'conv-from-runtime-env',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('fails claim when no conversation id can be resolved', async () => {
    vi.stubEnv('HAMMURABI_CONVERSATION_ID', '')
    vi.stubEnv('HAMMURABI_COMMANDER_RUNTIME_CONVERSATION_ID', '')

    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    try {
      const exitCode = await runQuestsCli(['claim', 'quest-42'], {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(1)
      expect(stderr.read()).toContain('--conversation')
      expect(stderr.read()).toContain('HAMMURABI_CONVERSATION_ID')
      expect(stderr.read()).toContain('HAMMURABI_COMMANDER_RUNTIME_CONVERSATION_ID')
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('prints claim holder on 409 conflict', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Quest is already claimed',
          claimedBy: 'conv-owner-7',
        }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['claim', 'quest-42', '--conversation', 'conv-42'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Quest quest-42 is already claimed by conv-owner-7.')
  })

  it('sends POST for note', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['note', 'quest-88', 'Progress made'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const call = fetchImpl.mock.calls[0]
    expect(call?.[0]).toBe(
      'https://hervald.gehirn.ai/api/commanders/cmdr-1/quests/quest-88/notes',
    )
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({ note: 'Progress made' })
  })

  it('sends PATCH for done with status done', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['done', 'quest-9', '--note', 'Completed rollout'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const call = fetchImpl.mock.calls[0]
    expect(call?.[1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      status: 'done',
      note: 'Completed rollout',
    })
  })

  it('sends PATCH for fail with status failed', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['fail', 'quest-11', '--note', 'Blocked by API outage'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const call = fetchImpl.mock.calls[0]
    expect(call?.[1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      status: 'failed',
      note: 'Blocked by API outage',
    })
  })

  it('adds quest artifact via GET then PATCH', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quests: [
              {
                id: 'quest-42',
                artifacts: [
                  {
                    type: 'github_issue',
                    label: 'Issue #55',
                    href: 'https://github.com/NickGuAI/Hervald/issues/55',
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(
      [
        'artifact',
        'add',
        'quest-42',
        '--type',
        'github_pr',
        '--label',
        'PR #77',
        '--href',
        'https://github.com/NickGuAI/Hervald/pull/77',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const getCall = fetchImpl.mock.calls[0]
    expect(getCall?.[0]).toBe('https://hervald.gehirn.ai/api/commanders/cmdr-1/quests')
    expect(getCall?.[1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
      }),
    })

    const patchCall = fetchImpl.mock.calls[1]
    expect(patchCall?.[0]).toBe('https://hervald.gehirn.ai/api/commanders/cmdr-1/quests/quest-42')
    expect(patchCall?.[1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse((patchCall?.[1]?.body as string) ?? '{}')).toEqual({
      artifacts: [
        {
          type: 'github_issue',
          label: 'Issue #55',
          href: 'https://github.com/NickGuAI/Hervald/issues/55',
        },
        {
          type: 'github_pr',
          label: 'PR #77',
          href: 'https://github.com/NickGuAI/Hervald/pull/77',
        },
      ],
    })
  })

  it('removes quest artifact via GET then PATCH', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quests: [
              {
                id: 'quest-99',
                artifacts: [
                  {
                    type: 'github_issue',
                    label: 'Issue #10',
                    href: 'https://github.com/NickGuAI/Hervald/issues/10',
                  },
                  {
                    type: 'url',
                    label: 'Spec',
                    href: 'https://example.com/spec',
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(
      ['artifact', 'remove', 'quest-99', 'https://example.com/spec'],
      {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const patchCall = fetchImpl.mock.calls[1]
    expect(JSON.parse((patchCall?.[1]?.body as string) ?? '{}')).toEqual({
      artifacts: [
        {
          type: 'github_issue',
          label: 'Issue #10',
          href: 'https://github.com/NickGuAI/Hervald/issues/10',
        },
      ],
    })
  })

  it('fails when HAMMURABI_COMMANDER_ID is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: '',
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('HAMMURABI_COMMANDER_ID is required.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends POST for create with contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'quest-new-1', status: 'pending' }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(
      [
        'create',
        '--instruction', 'Deploy the new service',
        '--cwd', '/home/user/app',
        '--mode', 'default',
        '--agent', 'claude',
        '--skills', 'commit,test',
        '--source', 'manual',
        '--issue', 'https://github.com/org/repo/issues/42',
        '--note', 'High priority',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Quest created: quest-new-1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = fetchImpl.mock.calls[0]
    expect(call?.[0]).toBe('https://hervald.gehirn.ai/api/commanders/cmdr-1/quests')
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer hmrb_test_key',
        'content-type': 'application/json',
      }),
    })
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      instruction: 'Deploy the new service',
      contract: {
        cwd: '/home/user/app',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: ['commit', 'test'],
      },
      source: 'manual',
      githubIssueUrl: 'https://github.com/org/repo/issues/42',
      note: 'High priority',
    })
  })

  it('supports issue-only create without explicit contract flags', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'quest-new-2', status: 'pending' }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(
      ['create', '--issue', 'https://github.com/org/repo/issues/544'],
      {
        fetchImpl,
        readConfig: async () => config,
        commanderId: 'cmdr-1',
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Quest created: quest-new-2')

    const call = fetchImpl.mock.calls[0]
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      githubIssueUrl: 'https://github.com/org/repo/issues/544',
    })
  })

  it('supports instruction-only create without explicit contract flags', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'quest-new-3', status: 'pending' }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['create', '--instruction', 'Do something'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Quest created: quest-new-3')

    const call = fetchImpl.mock.calls[0]
    expect(JSON.parse((call?.[1]?.body as string) ?? '{}')).toEqual({
      instruction: 'Do something',
    })
  })

  it('requires --instruction or --issue for create', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const exitCode = await runQuestsCli(['create', '--source', 'manual'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
    })

    expect(exitCode).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends DELETE for delete', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['delete', 'quest-99'], {
      fetchImpl,
      readConfig: async () => config,
      commanderId: 'cmdr-1',
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Quest quest-99 deleted.')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = fetchImpl.mock.calls[0]
    expect(call?.[0]).toBe('https://hervald.gehirn.ai/api/commanders/cmdr-1/quests/quest-99')
    expect(call?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('fails when hammurabi config is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stderr = createBufferWriter()

    const exitCode = await runQuestsCli(['list'], {
      fetchImpl,
      readConfig: async () => null,
      commanderId: 'cmdr-1',
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Hammurabi config not found.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

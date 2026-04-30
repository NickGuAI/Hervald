import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import {
  createChannelReplyDispatchers,
  createCliRelayDispatcher,
} from '../channel-dispatchers'
import type { CommanderChannelReplyDispatchInput } from '../routes'
import type { CommanderChannelMeta } from '../store'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

interface MockExecFileOptions {
  env?: NodeJS.ProcessEnv
  timeout?: number
  maxBuffer?: number
}

function createDispatchInput(
  provider: CommanderChannelMeta['provider'],
  options: {
    channel?: string
    to?: string
    accountId?: string
    threadId?: string
    message?: string
  } = {},
): CommanderChannelReplyDispatchInput {
  const to = options.to ?? `${provider}-target`
  const accountId = options.accountId ?? 'default'
  const threadId = options.threadId
  const message = options.message ?? `reply for ${provider}`

  return {
    commanderId: 'cmd-123',
    message,
    channelMeta: {
      provider,
      chatType: provider === 'discord' ? 'channel' : 'group',
      accountId,
      peerId: to,
      sessionKey: `${provider}:${accountId}:${to}`,
      displayName: `${provider} display`,
      ...(threadId ? { threadId } : {}),
    },
    lastRoute: {
      channel: options.channel ?? provider,
      to,
      accountId,
      ...(threadId ? { threadId } : {}),
    },
  }
}

function mockExecFile(
  implementation: (
    command: string,
    args: string[],
    options: MockExecFileOptions,
    callback: ExecFileCallback,
  ) => void,
): void {
  const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn>
  mockedExecFile.mockImplementation(
    (
      command: string,
      args: string[],
      options: unknown,
      callback: ExecFileCallback,
    ) => {
      implementation(command, args, options as MockExecFileOptions, callback)
      return {} as never
    },
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('createCliRelayDispatcher', () => {
  it('maps reply input to openclaw CLI args including account and thread', async () => {
    const input = createDispatchInput('telegram', {
      to: 'tg-chat-42',
      accountId: 'bot-main',
      threadId: 'topic-7',
      message: 'Hello from commander',
    })

    mockExecFile((command, args, options, callback) => {
      expect(command).toBe('openclaw')
      expect(args).toEqual([
        'message',
        'send',
        '--channel',
        'telegram',
        '--target',
        'tg-chat-42',
        '-m',
        'Hello from commander',
        '--account',
        'bot-main',
        '--thread-id',
        'topic-7',
      ])
      expect(options).toEqual(expect.objectContaining({
        env: process.env,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }))
      callback(null, 'ok', '')
    })

    const dispatcher = createCliRelayDispatcher('telegram')
    await expect(dispatcher(input)).resolves.toBeUndefined()
  })

  it('omits thread-id when the route has no thread', async () => {
    const input = createDispatchInput('whatsapp', {
      to: '120363012345@g.us',
      accountId: 'default',
      message: 'Group reply',
    })

    mockExecFile((_command, args, _options, callback) => {
      expect(args).toEqual([
        'message',
        'send',
        '--channel',
        'whatsapp',
        '--target',
        '120363012345@g.us',
        '-m',
        'Group reply',
        '--account',
        'default',
      ])
      callback(null, 'ok', '')
    })

    const dispatcher = createCliRelayDispatcher('whatsapp')
    await expect(dispatcher(input)).resolves.toBeUndefined()
  })

  it('throws a descriptive error when relay command exits non-zero', async () => {
    const input = createDispatchInput('discord', {
      to: 'chan-ops',
      accountId: 'bot-default',
      message: 'Dispatch me',
    })

    mockExecFile((_command, _args, _options, callback) => {
      callback(new Error('Command failed'), '', 'gateway unavailable')
    })

    const dispatcher = createCliRelayDispatcher('discord')
    await expect(dispatcher(input)).rejects.toThrow(
      'Failed to dispatch discord channel reply: gateway unavailable',
    )
  })
})

describe('createChannelReplyDispatchers', () => {
  it('creates only enabled provider dispatchers and warns for disabled providers', () => {
    const warn = vi.fn()

    const dispatchers = createChannelReplyDispatchers({
      env: {
        COMMANDER_WHATSAPP_ENABLED: '0',
        COMMANDER_TELEGRAM_ENABLED: 'true',
        COMMANDER_DISCORD_ENABLED: 'false',
      },
      logger: { warn },
    })

    expect(dispatchers.whatsapp).toBeUndefined()
    expect(typeof dispatchers.telegram).toBe('function')
    expect(dispatchers.discord).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]?.[0]).toContain('COMMANDER_WHATSAPP_ENABLED')
    expect(warn.mock.calls[1]?.[0]).toContain('COMMANDER_DISCORD_ENABLED')
  })
})

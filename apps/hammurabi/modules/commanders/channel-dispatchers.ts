import { execFile } from 'node:child_process'
import type { CommanderChannelReplyDispatcher } from './routes.js'
import type { CommanderChannelMeta } from './store.js'

const OPENCLAW_COMMAND = 'openclaw'
const OPENCLAW_TIMEOUT_MS = 30_000
const OPENCLAW_MAX_BUFFER_BYTES = 1024 * 1024

type CommanderProvider = CommanderChannelMeta['provider']

interface CliRelayOptions {
  command?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  maxBuffer?: number
}

interface ChannelReplyDispatcherFactoryOptions extends CliRelayOptions {
  logger?: Pick<Console, 'warn'>
}

function parseEnabledFlag(value: string | undefined): boolean {
  if (!value) {
    return true
  }
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false' && normalized !== 'no' && normalized !== 'off'
}

function trimMessage(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function createCliRelayDispatcher(
  provider: CommanderProvider,
  options: CliRelayOptions = {},
): CommanderChannelReplyDispatcher {
  const command = trimMessage(options.command) ?? OPENCLAW_COMMAND
  const env = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? OPENCLAW_TIMEOUT_MS
  const maxBuffer = options.maxBuffer ?? OPENCLAW_MAX_BUFFER_BYTES

  return async (input) => {
    const args = [
      'message',
      'send',
      '--channel',
      input.lastRoute.channel,
      '--target',
      input.lastRoute.to,
      '-m',
      input.message,
      '--account',
      input.lastRoute.accountId,
    ]

    if (input.lastRoute.threadId) {
      args.push('--thread-id', input.lastRoute.threadId)
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        command,
        args,
        {
          env,
          timeout: timeoutMs,
          maxBuffer,
        },
        (error, _stdout, stderr) => {
          if (error) {
            const details = trimMessage(stderr) ?? trimMessage(error.message) ?? 'unknown error'
            reject(new Error(`Failed to dispatch ${provider} channel reply: ${details}`))
            return
          }

          resolve()
        },
      )
    })
  }
}

export function createChannelReplyDispatchers(
  options: ChannelReplyDispatcherFactoryOptions = {},
): Partial<Record<CommanderProvider, CommanderChannelReplyDispatcher>> {
  const env = options.env ?? process.env
  const logger = options.logger ?? console
  const providers: Array<{ provider: CommanderProvider; envVar: string }> = [
    { provider: 'whatsapp', envVar: 'COMMANDER_WHATSAPP_ENABLED' },
    { provider: 'telegram', envVar: 'COMMANDER_TELEGRAM_ENABLED' },
    { provider: 'discord', envVar: 'COMMANDER_DISCORD_ENABLED' },
  ]
  const dispatchers: Partial<Record<CommanderProvider, CommanderChannelReplyDispatcher>> = {}

  for (const { provider, envVar } of providers) {
    if (!parseEnabledFlag(env[envVar])) {
      logger.warn(
        `[commanders] Outbound ${provider} channel replies disabled (${envVar}=0)`,
      )
      continue
    }

    dispatchers[provider] = createCliRelayDispatcher(provider, {
      command: options.command,
      env,
      timeoutMs: options.timeoutMs,
      maxBuffer: options.maxBuffer,
    })
  }

  return dispatchers
}

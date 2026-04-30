import type { EmailPoller } from './email-poller.js'
import { CommanderSessionStore } from './store.js'
import {
  maintainCommanderTranscriptIndex,
} from './transcript-index.js'

export const COMMANDER_TRANSCRIPT_MAINTENANCE_CRON = '20 2 * * *'
export const COMMANDER_EMAIL_POLL_CRON = '*/5 * * * *'

type CommanderTranscriptMaintenanceRunner = (commanderId: string) => Promise<void>

export interface CronEngine {
  schedule(
    expression: string,
    task: () => void | Promise<void>,
    options?: { name?: string },
  ): unknown
}

export interface CommanderCronOptions {
  basePath?: string
  commanderIdsForCron?: string[]
  commanderIdsForCronResolver?: () => Promise<string[]>
  commanderSessionStorePath?: string
  // Legacy no-op until out-of-scope wiring is deleted from module-registry.
  enableS3Sync?: boolean
  enableEmailPoll?: boolean
  emailPollCron?: string
  transcriptMaintenanceCron?: string
  transcriptMaintenanceRunner?: CommanderTranscriptMaintenanceRunner
  emailPoller?: Pick<EmailPoller, 'pollAll'>
}

async function defaultCommanderTranscriptMaintenanceRunner(
  commanderId: string,
  basePath?: string,
): Promise<void> {
  await maintainCommanderTranscriptIndex(commanderId, { basePath })
}

export function registerCommanderCron(
  cronEngine: CronEngine,
  options: CommanderCronOptions = {},
): void {
  if (options.enableEmailPoll && options.emailPoller) {
    const emailPoller = options.emailPoller
    let emailPollInFlight: Promise<void> | null = null
    cronEngine.schedule(
      options.emailPollCron ?? COMMANDER_EMAIL_POLL_CRON,
      () => {
        if (emailPollInFlight) {
          return
        }
        emailPollInFlight = emailPoller.pollAll()
          .catch((error) => {
            console.error('[commanders] Failed commander email poll:', error)
          })
          .finally(() => {
            emailPollInFlight = null
          })
      },
      { name: 'commander-email-poll' },
    )
  }

  const transcriptMaintenanceRunner = options.transcriptMaintenanceRunner ?? ((commanderId: string) => (
    defaultCommanderTranscriptMaintenanceRunner(commanderId, options.basePath)
  ))

  const resolveCommanderIdsForCron = async (): Promise<string[]> => {
    const source = options.commanderIdsForCronResolver
      ? await options.commanderIdsForCronResolver()
      : options.commanderIdsForCron
        ?? (options.commanderSessionStorePath
          ? (await new CommanderSessionStore(options.commanderSessionStorePath).list()).map((session) => session.id)
          : [])

    const deduped = new Set<string>()
    for (const entry of source) {
      const commanderId = entry.trim()
      if (!commanderId) {
        continue
      }
      deduped.add(commanderId)
    }
    return [...deduped]
  }

  cronEngine.schedule(
    options.transcriptMaintenanceCron ?? COMMANDER_TRANSCRIPT_MAINTENANCE_CRON,
    async () => {
      const commanderIds = await resolveCommanderIdsForCron()
      for (const commanderId of commanderIds) {
        await transcriptMaintenanceRunner(commanderId).catch((error) => {
          console.error(`[commanders] Failed transcript maintenance for ${commanderId}:`, error)
        })
      }
    },
    { name: 'commander-transcript-maintenance' },
  )
}

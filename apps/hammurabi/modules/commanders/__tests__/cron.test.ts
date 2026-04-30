import { describe, expect, it, vi } from 'vitest'
import {
  COMMANDER_EMAIL_POLL_CRON,
  COMMANDER_TRANSCRIPT_MAINTENANCE_CRON,
  registerCommanderCron,
} from '../cron.js'
import { CommanderSessionStore } from '../store.js'

describe('registerCommanderCron()', () => {
  it('registers transcript maintenance by default', () => {
    const schedule = vi.fn()

    registerCommanderCron(
      { schedule },
      { commanderIdsForCron: ['commander-1'] },
    )

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledWith(
      COMMANDER_TRANSCRIPT_MAINTENANCE_CRON,
      expect.any(Function),
      { name: 'commander-transcript-maintenance' },
    )
  })

  it('uses CommanderSessionStore list at cron runtime when ids are not provided', async () => {
    let transcriptJob: (() => Promise<void> | void) | null = null
    const schedule = vi.fn((expression: string, task: () => Promise<void> | void) => {
      if (expression === COMMANDER_TRANSCRIPT_MAINTENANCE_CRON) {
        transcriptJob = task
      }
    })

    const listSpy = vi.spyOn(CommanderSessionStore.prototype, 'list')
      .mockResolvedValueOnce([
        { id: 'commander-101' } as never,
        { id: 'commander-102' } as never,
      ])

    const transcriptMaintenanceRunner = vi.fn(async () => {})

    registerCommanderCron(
      { schedule },
      {
        commanderSessionStorePath: '/tmp/commanders/sessions.json',
        transcriptMaintenanceRunner,
      },
    )

    if (!transcriptJob) {
      throw new Error('transcript maintenance job was not registered')
    }

    await transcriptJob()
    expect(listSpy).toHaveBeenCalledTimes(1)
    expect(transcriptMaintenanceRunner).toHaveBeenCalledTimes(2)
    expect(transcriptMaintenanceRunner).toHaveBeenNthCalledWith(1, 'commander-101')
    expect(transcriptMaintenanceRunner).toHaveBeenNthCalledWith(2, 'commander-102')
  })

  it('does not register S3 sync jobs anymore', async () => {
    const schedule = vi.fn()

    registerCommanderCron(
      { schedule },
      {
        commanderIdsForCron: ['commander-1'],
      },
    )

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledWith(
      COMMANDER_TRANSCRIPT_MAINTENANCE_CRON,
      expect.any(Function),
      { name: 'commander-transcript-maintenance' },
    )
  })

  it('registers commander email polling when enabled', async () => {
    const schedule = vi.fn()
    const emailPoller = {
      pollAll: vi.fn(async () => undefined),
    }

    registerCommanderCron(
      { schedule },
      {
        commanderIdsForCron: ['commander-1'],
        enableEmailPoll: true,
        emailPoller,
      },
    )

    const pollJob = schedule.mock.calls.find(
      (call) => call[0] === COMMANDER_EMAIL_POLL_CRON,
    )?.[1]
    expect(typeof pollJob).toBe('function')

    if (!pollJob) {
      throw new Error('email poll job was not registered')
    }

    await pollJob()
    expect(emailPoller.pollAll).toHaveBeenCalledTimes(1)
  })
})

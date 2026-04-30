import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { main } from '../prune-orphan-commander-names'

const tempDirectories: string[] = []
const LEGIT_COMMANDER_ID = '00000000-0000-4000-a000-000000000021'
const ORPHAN_COMMANDER_ID = '00000000-0000-4000-a000-000000000099'

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirectories.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('prune-orphan-commander-names script', () => {
  it('removes only names whose commander ids are absent from sessions.json', async () => {
    const dir = await createTempDir('hammurabi-prune-commander-names-')
    const namesPath = path.join(dir, 'names.json')
    const sessionsPath = path.join(dir, 'sessions.json')

    await mkdir(dir, { recursive: true })
    await writeFile(
      namesPath,
      JSON.stringify(
        {
          [LEGIT_COMMANDER_ID]: 'Fixture Legit Commander',
          [ORPHAN_COMMANDER_ID]: 'worker-heartbeat-stop-log',
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(
      sessionsPath,
      JSON.stringify(
        {
          sessions: [
            {
              id: LEGIT_COMMANDER_ID,
              host: 'fixture-legit-commander',
              pid: null,
              state: 'idle',
              created: '2026-04-24T00:00:00.000Z',
              agentType: 'claude',
              heartbeat: {
                intervalMs: 300000,
                message: '[HEARTBEAT]',
                checklist: false,
                checklistPath: null,
                fatPin: false,
                lastSentAt: null,
              },
              lastHeartbeat: null,
              heartbeatTickCount: 0,
              taskSource: null,
              currentTask: null,
              completedTasks: 0,
              totalCostUsd: 0,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const stdoutWrites: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutWrites.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    })

    await main(['--data-dir', dir])

    const names = JSON.parse(await readFile(namesPath, 'utf8')) as Record<string, string>
    expect(names).toEqual({
      [LEGIT_COMMANDER_ID]: 'Fixture Legit Commander',
    })

    const report = JSON.parse(stdoutWrites.join('')) as {
      removedCommanderIds: string[]
      totalBefore: number
      totalAfter: number
    }
    expect(report.removedCommanderIds).toEqual([ORPHAN_COMMANDER_ID])
    expect(report.totalBefore).toBe(2)
    expect(report.totalAfter).toBe(1)
  })
})

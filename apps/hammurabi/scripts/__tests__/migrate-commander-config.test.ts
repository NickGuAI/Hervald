import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_HEARTBEAT_MESSAGE } from '../../modules/commanders/heartbeat'
import { migrateCommanderConfig } from '../migrate-commander-config'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('migrateCommanderConfig', () => {
  it('back-fills sessions.json from legacy frontmatter and preserves non-deprecated markdown', async () => {
    const dataDir = await createTempDir('hammurabi-migrate-commander-config-')
    const commanderId = '72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3'
    await mkdir(path.join(dataDir, commanderId), { recursive: true })
    await writeFile(
      path.join(dataDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'arnold',
            pid: null,
            state: 'idle',
            created: '2026-04-24T00:00:00.000Z',
            heartbeat: {
              intervalMs: 900_000,
              messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
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
      }),
      'utf8',
    )
    await writeFile(
      path.join(dataDir, commanderId, 'COMMANDER.md'),
      [
        '---',
        'heartbeat.interval: 10800000',
        'heartbeat.message: "[LEGACY HB {{timestamp}}]"',
        'maxTurns: 8',
        'contextMode: thin',
        'fatPinInterval: 2',
        'customTag: keep-me',
        '---',
        '',
        'Legacy commander prompt body.',
      ].join('\n'),
      'utf8',
    )

    const summary = await migrateCommanderConfig({ dataDir })

    expect(summary.checked).toBe(1)
    expect(summary.sessionUpdates).toBe(1)
    expect(summary.workflowUpdates).toBe(1)

    const persisted = JSON.parse(await readFile(path.join(dataDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<Record<string, unknown>>
    }
    expect(persisted.sessions[0]).toMatchObject({
      heartbeat: {
        intervalMs: 10_800_000,
        messageTemplate: '[LEGACY HB {{timestamp}}]',
        intervalOverridden: true,
      },
      maxTurns: 8,
      contextMode: 'thin',
      contextConfig: {
        fatPinInterval: 2,
      },
    })

    expect(await readFile(path.join(dataDir, commanderId, 'COMMANDER.md'), 'utf8')).toBe([
      '---',
      'customTag: keep-me',
      '---',
      'Legacy commander prompt body.',
    ].join('\n'))
  })
})

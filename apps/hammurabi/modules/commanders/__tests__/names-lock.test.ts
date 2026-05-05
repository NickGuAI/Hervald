import { afterEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultHeartbeatConfig } from '../heartbeat'
import {
  setCommanderDisplayName,
  UnknownCommanderError,
} from '../names-lock'
import {
  CommanderSessionStore,
  type CommanderSession,
} from '../store'

const tempDirs: string[] = []
const REGISTERED_COMMANDER_ID = '00000000-0000-4000-a000-000000000011'
const ORPHAN_COMMANDER_ID = '00000000-0000-4000-a000-000000000099'
const NON_CANONICAL_COMMANDER_ID = 'fixture-not-a-uuid'

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createBaseSession(input: {
  id: string
  host: string
  created: string
}): CommanderSession {
  return {
    id: input.id,
    host: input.host,
    pid: null,
    state: 'idle',
    created: input.created,
    agentType: 'claude',
    heartbeat: createDefaultHeartbeatConfig(),
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    taskSource: null,
    currentTask: null,
    completedTasks: 0,
    totalCostUsd: 0,
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('commander name writes', () => {
  it('persists display names for registered canonical commander ids', async () => {
    const dir = await createTempDir('hammurabi-commander-names-')
    const sessionStore = new CommanderSessionStore(join(dir, 'sessions.json'))
    await sessionStore.create(createBaseSession({
      id: REGISTERED_COMMANDER_ID,
      host: 'fixture-registered-commander',
      created: '2026-04-24T00:00:00.000Z',
    }))

    await setCommanderDisplayName(dir, REGISTERED_COMMANDER_ID, 'Fixture Commander')

    const names = JSON.parse(
      await readFile(join(dir, 'names.json'), 'utf8'),
    ) as Record<string, string>
    expect(names).toEqual({
      [REGISTERED_COMMANDER_ID]: 'Fixture Commander',
    })
  })

  it('rejects orphan and non-canonical commander ids without touching names.json', async () => {
    const dir = await createTempDir('hammurabi-commander-name-reject-')
    const sessionStore = new CommanderSessionStore(join(dir, 'sessions.json'))
    await sessionStore.create(createBaseSession({
      id: REGISTERED_COMMANDER_ID,
      host: 'fixture-registered-commander',
      created: '2026-04-24T00:00:00.000Z',
    }))
    await sessionStore.create(createBaseSession({
      id: NON_CANONICAL_COMMANDER_ID,
      host: 'fixture-non-canonical-commander',
      created: '2026-04-24T00:00:01.000Z',
    }))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      setCommanderDisplayName(dir, ORPHAN_COMMANDER_ID, 'Fixture Orphan'),
    ).rejects.toBeInstanceOf(UnknownCommanderError)
    await expect(
      setCommanderDisplayName(dir, NON_CANONICAL_COMMANDER_ID, 'Fixture Bad Id'),
    ).rejects.toBeInstanceOf(UnknownCommanderError)

    expect(warnSpy).toHaveBeenCalledTimes(2)
    await expect(access(join(dir, 'names.json'), constants.F_OK)).rejects.toBeTruthy()
  })
})

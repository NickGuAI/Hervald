import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest-store.js'

describe('QuestStore', () => {
  let tmpDir = ''
  let store: QuestStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hammurabi-quest-store-'))
    store = new QuestStore(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates, lists, updates, and deletes quests', async () => {
    const created = await store.create({
      commanderId: 'cmdr-1',
      status: 'pending',
      source: 'manual',
      instruction: 'Investigate issue queue drift',
      contract: {
        cwd: '/tmp/monorepo-g',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: ['issue-finder'],
      },
    })

    expect(created.id).toBeTruthy()
    expect(created.commanderId).toBe('cmdr-1')
    expect(created.status).toBe('pending')

    const listed = await store.list('cmdr-1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(created.id)

    const updated = await store.update('cmdr-1', created.id, {
      status: 'done',
      note: 'Implemented and verified with tests',
    })
    expect(updated).not.toBeNull()
    expect(updated?.status).toBe('done')
    expect(updated?.note).toBe('Implemented and verified with tests')

    const noted = await store.appendNote('cmdr-1', created.id, 'Posted handoff in issue thread')
    expect(noted).not.toBeNull()
    expect(noted?.note).toBe('Implemented and verified with tests\nPosted handoff in issue thread')

    const deleted = await store.delete('cmdr-1', created.id)
    expect(deleted).toBe(true)
    expect(await store.list('cmdr-1')).toEqual([])
  })

  it('resets active quests back to pending', async () => {
    const active = await store.create({
      commanderId: 'cmdr-2',
      status: 'active',
      source: 'idea',
      instruction: 'Prototype quest picker',
      contract: {
        cwd: '/tmp/monorepo-g',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    })
    await store.create({
      commanderId: 'cmdr-2',
      status: 'done',
      source: 'manual',
      instruction: 'Ship API baseline',
      contract: {
        cwd: '/tmp/monorepo-g',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    })

    const changedCount = await store.resetActiveToPending('cmdr-2')
    expect(changedCount).toBe(1)

    const refreshed = await store.get('cmdr-2', active.id)
    expect(refreshed?.status).toBe('pending')
  })

  it('sets completedAt on completion and clears it when reopened', async () => {
    const created = await store.create({
      commanderId: 'cmdr-4',
      status: 'pending',
      source: 'manual',
      instruction: 'Implement commander board grouping',
      contract: {
        cwd: '/tmp/monorepo-g',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    })

    expect(created.completedAt).toBeUndefined()

    const completed = await store.update('cmdr-4', created.id, { status: 'done' })
    expect(completed).not.toBeNull()
    expect(completed?.completedAt).toBeTruthy()
    const completedAt = completed?.completedAt
    expect(completedAt).toBeTruthy()

    const reloadedStore = new QuestStore(tmpDir)
    const persistedCompleted = await reloadedStore.get('cmdr-4', created.id)
    expect(persistedCompleted?.completedAt).toBe(completedAt)

    const reopened = await store.update('cmdr-4', created.id, { status: 'pending' })
    expect(reopened).not.toBeNull()
    expect(reopened?.completedAt).toBeUndefined()

    const persistedReopened = await reloadedStore.get('cmdr-4', created.id)
    expect(persistedReopened?.completedAt).toBeUndefined()
  })

  it('persists and updates quest artifacts', async () => {
    const created = await store.create({
      commanderId: 'cmdr-3',
      status: 'pending',
      source: 'manual',
      instruction: 'Link implementation outputs',
      artifacts: [
        {
          type: 'github_issue',
          label: 'Issue #101',
          href: 'https://github.com/NickGuAI/Hervald/issues/101',
        },
        {
          type: 'file',
          label: 'Quest notes',
          href: 'apps/hammurabi/modules/commanders/quest-store.ts',
        },
      ],
      contract: {
        cwd: '/tmp/monorepo-g',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    })

    expect(created.artifacts).toEqual([
      {
        type: 'github_issue',
        label: 'Issue #101',
        href: 'https://github.com/NickGuAI/Hervald/issues/101',
      },
      {
        type: 'file',
        label: 'Quest notes',
        href: 'apps/hammurabi/modules/commanders/quest-store.ts',
      },
    ])

    const updated = await store.update('cmdr-3', created.id, {
      artifacts: [
        {
          type: 'github_pr',
          label: 'PR #202',
          href: 'https://github.com/NickGuAI/Hervald/pull/202',
        },
      ],
    })
    expect(updated?.artifacts).toEqual([
      {
        type: 'github_pr',
        label: 'PR #202',
        href: 'https://github.com/NickGuAI/Hervald/pull/202',
      },
    ])

    const cleared = await store.update('cmdr-3', created.id, { artifacts: null })
    expect(cleared?.artifacts).toEqual([])
  })

  // -----------------------------------------------------------------
  // Legacy permissionMode migration — issue/1222
  // Quest contracts on disk pre-#1186 carry deprecated literals; the strict
  // parser dropped them silently. Now they migrate to 'default', warn once,
  // and persist the upgraded file.
  // -----------------------------------------------------------------

  it('migrates a quest with legacy contract.permissionMode to default and warns', async () => {
    const { mkdir } = await import('node:fs/promises')
    const questId = 'quest-legacy'
    const commanderId = 'cmdr-legacy'
    const filePath = join(tmpDir, commanderId, 'quests.json')
    await mkdir(join(tmpDir, commanderId), { recursive: true })
    const persisted = {
      quests: [
        {
          id: questId,
          commanderId,
          createdAt: '2026-04-01T00:00:00.000Z',
          status: 'pending',
          source: 'manual',
          instruction: 'do the thing',
          artifacts: [],
          contract: {
            cwd: '/tmp',
            permissionMode: 'bypassPermissions',
            agentType: 'claude',
            skillsToUse: [],
          },
        },
      ],
    }
    await writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const quests = await store.list(commanderId)
      expect(quests).toHaveLength(1)
      expect(quests[0]?.contract.permissionMode).toBe('default')

      const migrationWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(migrationWarns).toHaveLength(1)
      expect(migrationWarns[0]?.[1]).toMatchObject({
        questId,
        commanderId,
        from: 'bypassPermissions',
        to: 'default',
      })

      const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as {
        quests: Array<{ contract: { permissionMode: string } }>
      }
      expect(onDisk.quests[0]?.contract.permissionMode).toBe('default')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('is idempotent — second list call after migration produces zero warns and no rewrite', async () => {
    const { mkdir } = await import('node:fs/promises')
    const commanderId = 'cmdr-idem'
    const filePath = join(tmpDir, commanderId, 'quests.json')
    await mkdir(join(tmpDir, commanderId), { recursive: true })
    const persisted = {
      quests: [
        {
          id: 'q1',
          commanderId,
          createdAt: '2026-04-01T00:00:00.000Z',
          status: 'pending',
          source: 'manual',
          instruction: 'a',
          artifacts: [],
          contract: {
            cwd: '/tmp',
            permissionMode: 'acceptEdits',
            agentType: 'claude',
            skillsToUse: [],
          },
        },
      ],
    }
    await writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await store.list(commanderId)
      const firstWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      ).length
      expect(firstWarns).toBe(1)

      const afterFirst = await readFile(filePath, 'utf8')

      warnSpy.mockClear()
      await store.list(commanderId)
      const secondWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      ).length
      expect(secondWarns).toBe(0)

      const afterSecond = await readFile(filePath, 'utf8')
      expect(afterSecond).toBe(afterFirst)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

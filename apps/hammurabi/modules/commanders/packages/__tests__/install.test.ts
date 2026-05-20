import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationStore } from '../../conversation-store'
import { resolveCommanderPaths } from '../../paths'
import { CommanderSessionStore } from '../../store'
import { installCommanderPackage } from '../install'
import { STARTER_COMMANDER_PACKAGE_IDS, listCommanderPackages, loadCommanderPackage } from '../registry'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('commander package registry and install', () => {
  it('loads the bundled starter workforce from inspectable package directories', async () => {
    const packages = await listCommanderPackages()

    expect(packages.map((pkg) => pkg.id).sort()).toEqual([...STARTER_COMMANDER_PACKAGE_IDS].sort())
    for (const pkg of packages) {
      expect(pkg.commanderMd).not.toMatch(/NickGuAI|\/home\/builder\/PKMS|private PKMS/u)
      expect(pkg.skills.length).toBeGreaterThan(0)
      expect(pkg.examples.length).toBeGreaterThan(0)
    }
  })

  it('installs a commander package idempotently with workflow, profile, package snapshot, and conversation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-package-install-'))
    tempDirs.push(dataDir)
    const commanderDataDir = join(dataDir, 'commander')
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    const conversationStore = new ConversationStore(commanderDataDir)
    const definition = await loadCommanderPackage('engineering-manager')
    expect(definition).not.toBeNull()

    const first = await installCommanderPackage(definition!, {
      sessionStore,
      conversationStore,
      commanderDataDir,
      now: () => new Date('2026-05-20T00:00:00.000Z'),
    })
    const second = await installCommanderPackage(definition!, {
      sessionStore,
      conversationStore,
      commanderDataDir,
      now: () => new Date('2026-05-20T00:00:01.000Z'),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.commander.id).toBe(first.commander.id)
    expect(await sessionStore.list()).toHaveLength(1)
    expect(await conversationStore.listByCommander(first.commander.id)).toHaveLength(1)

    const { commanderRoot, memoryRoot } = resolveCommanderPaths(first.commander.id, commanderDataDir)
    await expect(readFile(join(commanderRoot, '.package', 'package.json'), 'utf8')).resolves.toContain('"id": "engineering-manager"')
    await expect(readFile(join(commanderRoot, 'COMMANDER.md'), 'utf8')).resolves.toContain('Asina is an engineering manager commander')
    await expect(readFile(join(memoryRoot, 'profile.json'), 'utf8')).resolves.toContain('Precise engineering commander')
  })
})

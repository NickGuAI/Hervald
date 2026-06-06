import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationStore } from '../../../automations/store'
import { OperatorStore } from '../../../operators/store'
import {
  ALFRED_COMMANDER_AVATAR_URL,
  ASINA_COMMANDER_AVATAR_URL,
  EINSTEIN_COMMANDER_AVATAR_URL,
} from '../../commander-profile'
import { ConversationStore } from '../../conversation-store'
import { resolveCommanderPaths } from '../../paths'
import { CommanderSessionStore } from '../../store'
import { installCommanderPackage } from '../install'
import {
  STARTER_COMMANDER_PACKAGE_IDS,
  listCommanderPackages,
  loadCommanderPackage,
  resolveBundledPackagesRoot,
} from '../registry'

const tempDirs: string[] = []
const previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR

afterEach(async () => {
  if (previousHammurabiDataDir === undefined) {
    delete process.env.HAMMURABI_DATA_DIR
  } else {
    process.env.HAMMURABI_DATA_DIR = previousHammurabiDataDir
  }
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createAutomationStore(dataDir: string, commanderDataDir: string): Promise<AutomationStore> {
  process.env.HAMMURABI_DATA_DIR = dataDir
  await new OperatorStore(join(dataDir, 'operators.json')).saveFounder({
    id: 'founder-test',
    kind: 'founder',
    displayName: 'Founder Test',
    email: 'founder@example.com',
    avatarUrl: null,
    createdAt: '2026-05-20T00:00:00.000Z',
  })
  return new AutomationStore({
    dirPath: join(dataDir, 'automations'),
    commanderDataDir,
  })
}

describe('commander package registry and install', () => {
  it('falls back to the source bundled package root when built assets are not emitted', async () => {
    const sourceRoot = join(process.cwd(), 'modules', 'commanders', 'packages', 'bundled')

    await expect(resolveBundledPackagesRoot([
      join(tmpdir(), 'missing-dist-server-bundled-assets'),
      sourceRoot,
    ])).resolves.toBe(sourceRoot)
  })

  it('loads the bundled starter workforce from inspectable package directories', async () => {
    const packages = await listCommanderPackages()
    const publicStarterSkillRoot = join(
      process.cwd(),
      'public',
      'repo-root',
      'agent-skills',
      'hervald-starter',
    )

    expect(packages.map((pkg) => pkg.id).sort()).toEqual([...STARTER_COMMANDER_PACKAGE_IDS].sort())
    expect(Object.fromEntries(packages.map((pkg) => [pkg.id, pkg.uiProfile.avatar]))).toEqual({
      'engineering-manager': ASINA_COMMANDER_AVATAR_URL,
      'general-assistant': ALFRED_COMMANDER_AVATAR_URL,
      'research-intelligence-analyst': EINSTEIN_COMMANDER_AVATAR_URL,
    })
    for (const pkg of packages) {
      expect(pkg.commanderMd).not.toMatch(/NickGuAI|\/home\/builder\/PKMS|private PKMS/u)
      expect(pkg.skills.length).toBeGreaterThan(0)
      expect(pkg.examples.length).toBeGreaterThan(0)
      for (const skill of pkg.skills) {
        await expect(access(join(publicStarterSkillRoot, skill.id, 'SKILL.md'))).resolves.toBeUndefined()
      }
    }
  })

  it('installs a commander package idempotently with workflow, profile, package snapshot, and conversation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-package-install-'))
    tempDirs.push(dataDir)
    const commanderDataDir = join(dataDir, 'commander')
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    const conversationStore = new ConversationStore(commanderDataDir)
    const automationStore = await createAutomationStore(dataDir, commanderDataDir)
    const definition = await loadCommanderPackage('engineering-manager')
    expect(definition).not.toBeNull()
    expect(definition!.automations.map((automation) => automation.id)).toEqual([
      'issue-triage-sweep',
      'release-drift-review',
    ])

    const first = await installCommanderPackage(definition!, {
      sessionStore,
      conversationStore,
      automationStore,
      commanderDataDir,
      now: () => new Date('2026-05-20T00:00:00.000Z'),
    })
    const second = await installCommanderPackage(definition!, {
      sessionStore,
      conversationStore,
      automationStore,
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
    await expect(readFile(join(commanderRoot, '.package', 'automations.manifest.json'), 'utf8')).resolves.toContain('issue-triage-sweep')
    await expect(readFile(join(commanderRoot, 'COMMANDER.md'), 'utf8')).resolves.toContain('Asina is an engineering manager commander')
    const automations = await automationStore.list({ parentCommanderId: first.commander.id })
    expect(automations).toHaveLength(2)
    expect(automations.map((automation) => automation.templateId).sort()).toEqual([
      'engineering-manager:issue-triage-sweep',
      'engineering-manager:release-drift-review',
    ])
    expect(automations.every((automation) => automation.status === 'paused')).toBe(true)
    const profile = JSON.parse(await readFile(join(memoryRoot, 'profile.json'), 'utf8')) as {
      avatar?: string
      portraitStyleId?: string
      speakingTone?: string
    }
    expect(profile).toMatchObject({
      avatar: ASINA_COMMANDER_AVATAR_URL,
      portraitStyleId: 'sumi-e',
      speakingTone: 'Precise engineering commander',
    })
  })

  it('serializes concurrent installs so one package creates one commander', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-package-concurrent-install-'))
    tempDirs.push(dataDir)
    const commanderDataDir = join(dataDir, 'commander')
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    const conversationStore = new ConversationStore(commanderDataDir)
    const automationStore = await createAutomationStore(dataDir, commanderDataDir)
    const definition = await loadCommanderPackage('engineering-manager')
    expect(definition).not.toBeNull()

    const results = await Promise.all([
      installCommanderPackage(definition!, {
        sessionStore,
        conversationStore,
        automationStore,
        commanderDataDir,
        now: () => new Date('2026-05-20T00:00:00.000Z'),
      }),
      installCommanderPackage(definition!, {
        sessionStore,
        conversationStore,
        automationStore,
        commanderDataDir,
        now: () => new Date('2026-05-20T00:00:01.000Z'),
      }),
    ])

    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(new Set(results.map((result) => result.commander.id)).size).toBe(1)

    const sessions = await sessionStore.list()
    const installed = sessions.filter((session) => session.templateId === 'engineering-manager')
    expect(installed).toHaveLength(1)
    expect(await conversationStore.listByCommander(installed[0].id)).toHaveLength(1)
    expect(await automationStore.list({ parentCommanderId: installed[0].id })).toHaveLength(2)
  })

  it('rolls back automations created before a later preset automation fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-package-automation-rollback-'))
    tempDirs.push(dataDir)
    const commanderDataDir = join(dataDir, 'commander')
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    const conversationStore = new ConversationStore(commanderDataDir)
    const definition = await loadCommanderPackage('engineering-manager')
    expect(definition).not.toBeNull()
    expect(definition!.automations).toHaveLength(2)

    let createCount = 0
    const automationStore = {
      create: vi.fn(async () => {
        createCount += 1
        if (createCount === 2) {
          throw new Error('preset automation create failed')
        }
        return { id: `automation-${createCount}` }
      }),
      delete: vi.fn(async () => true),
    }

    await expect(installCommanderPackage(definition!, {
      sessionStore,
      conversationStore,
      automationStore: automationStore as unknown as AutomationStore,
      commanderDataDir,
      now: () => new Date('2026-05-20T00:00:00.000Z'),
    })).rejects.toThrow('preset automation create failed')

    expect(automationStore.delete).toHaveBeenCalledWith('automation-1', { removeFiles: true })
    expect(await sessionStore.list()).toHaveLength(0)
  })
})

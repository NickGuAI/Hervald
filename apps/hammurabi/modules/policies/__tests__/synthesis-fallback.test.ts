import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PolicyStore } from '../store'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function writeStoreFile(rootDir: string, contents: unknown): Promise<string> {
  const filePath = path.join(rootDir, 'policies.json')
  await writeFile(filePath, JSON.stringify(contents, null, 2), 'utf8')
  return filePath
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('PolicyStore.buildView synthesis respects storedScope.fallbackPolicy (#1267 Bug A)', () => {
  it('synthesizes built-in records using fallbackPolicy=auto when no explicit record exists', async () => {
    const rootDir = await createTempDir('hammurabi-policy-synth-')
    const filePath = await writeStoreFile(rootDir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: {},
      global: {
        fallbackPolicy: 'auto',
        records: [],
      },
      commanders: {},
    })

    const store = new PolicyStore({ filePath })
    const view = await store.getGlobal()

    expect(view.fallbackPolicy).toBe('auto')
    const destructiveGit = view.records.find((r) => r.actionId === 'destructive-git')
    expect(destructiveGit, 'destructive-git is a built-in action and must be present in the synthesized view').toBeTruthy()
    expect(destructiveGit?.policy).toBe('auto')
  })

  it('explicit record wins over the synthesized fallback', async () => {
    const rootDir = await createTempDir('hammurabi-policy-synth-')
    const filePath = await writeStoreFile(rootDir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: {},
      global: {
        fallbackPolicy: 'auto',
        records: [
          {
            actionId: 'destructive-git',
            policy: 'review',
            allowlist: [],
            blocklist: [],
            updatedAt: new Date().toISOString(),
            updatedBy: 'test',
          },
        ],
      },
      commanders: {},
    })

    const store = new PolicyStore({ filePath })
    const view = await store.getGlobal()

    const destructiveGit = view.records.find((r) => r.actionId === 'destructive-git')
    expect(destructiveGit?.policy).toBe('review')

    // Other built-ins (e.g. send-email) still respect the auto fallback.
    const sendEmail = view.records.find((r) => r.actionId === 'send-email')
    expect(sendEmail?.policy).toBe('auto')
  })

  it('falls back to constructor defaultPolicy when storedScope.fallbackPolicy is unset', async () => {
    const rootDir = await createTempDir('hammurabi-policy-synth-')
    const filePath = await writeStoreFile(rootDir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: {},
      global: {
        // no fallbackPolicy
        records: [],
      },
      commanders: {},
    })

    const store = new PolicyStore({ filePath })
    const view = await store.getGlobal()

    expect(view.fallbackPolicy).toBe('review') // constructor default
    const destructiveGit = view.records.find((r) => r.actionId === 'destructive-git')
    expect(destructiveGit?.policy).toBe('review')
  })

  it('honors a constructor-supplied defaultPolicy when storedScope has no fallbackPolicy', async () => {
    const rootDir = await createTempDir('hammurabi-policy-synth-')
    const filePath = await writeStoreFile(rootDir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: {},
      global: {
        records: [],
      },
      commanders: {},
    })

    const store = new PolicyStore({ filePath, defaultPolicy: 'auto' })
    const view = await store.getGlobal()

    const destructiveGit = view.records.find((r) => r.actionId === 'destructive-git')
    expect(destructiveGit?.policy).toBe('auto')
  })

  it('commander resolveEffective inherits global fallbackPolicy when commander scope has no override', async () => {
    const rootDir = await createTempDir('hammurabi-policy-synth-')
    const filePath = await writeStoreFile(rootDir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: {},
      global: {
        fallbackPolicy: 'auto',
        records: [],
      },
      commanders: {
        'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e': {
          // no fallbackPolicy override
          records: [],
        },
      },
    })

    const store = new PolicyStore({ filePath })
    const view = await store.resolveEffective('d66a5217-ace6-4f00-b2ac-bbd64a9a7e7e')

    expect(view.fallbackPolicy).toBe('auto')
    const destructiveGit = view.records.find((r) => r.actionId === 'destructive-git')
    expect(destructiveGit?.policy).toBe('auto')
  })
})

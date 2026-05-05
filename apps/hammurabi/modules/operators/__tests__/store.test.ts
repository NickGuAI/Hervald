import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Operator } from '../types'
import { OperatorStore } from '../store'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createFounder(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 'founder-1',
    kind: 'founder',
    displayName: 'Nick Gu',
    email: 'nick@example.com',
    avatarUrl: 'https://example.com/avatar.png',
    createdAt: '2026-05-01T22:30:09.000Z',
    ...overrides,
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

type RawOperatorReadForTest = {
  operator: Operator
  rawEmail: string | null
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  )
})

describe('OperatorStore', () => {
  it('treats a missing operators.json file as no founder persisted yet', async () => {
    const dir = await createTempDir('hammurabi-operator-missing-')
    const storePath = join(dir, '.hammurabi', 'operators.json')
    const store = new OperatorStore(storePath)

    await expect(store.getFounderById('founder-1')).resolves.toBeNull()
    await expect(access(storePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists a founder and reloads it by id', async () => {
    const dir = await createTempDir('hammurabi-operator-persist-')
    const storePath = join(dir, '.hammurabi', 'operators.json')
    const store = new OperatorStore(storePath)
    const founder = createFounder()

    await expect(store.saveFounder(founder)).resolves.toEqual(founder)
    await expect(stat(storePath)).resolves.toBeDefined()

    const rawFile = await readFile(storePath, 'utf8')
    expect(JSON.parse(rawFile)).toEqual(founder)

    const reloaded = new OperatorStore(storePath)
    await expect(reloaded.getFounderById(founder.id)).resolves.toEqual(founder)
    await expect(reloaded.get('other-id')).resolves.toBeNull()
  })

  it('rejects persisted operators with unknown kind values', async () => {
    const dir = await createTempDir('hammurabi-operator-kind-')
    const storePath = join(dir, '.hammurabi', 'operators.json')
    await mkdir(join(dir, '.hammurabi'), { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        ...createFounder(),
        kind: 'user',
      }),
      'utf8',
    )

    const store = new OperatorStore(storePath)
    await expect(store.getFounderById('founder-1')).rejects.toThrow(
      'Invalid operator kind "user"',
    )
  })

  it('normalizes missing and blank emails to null', async () => {
    const dir = await createTempDir('hammurabi-operator-email-')
    const missingEmailPath = join(dir, '.hammurabi', 'operators-missing-email.json')
    const blankEmailPath = join(dir, '.hammurabi', 'operators-blank-email.json')
    await mkdir(join(dir, '.hammurabi'), { recursive: true })

    await writeFile(
      missingEmailPath,
      JSON.stringify({
        id: 'founder-1',
        kind: 'founder',
        displayName: 'Nick Gu',
        createdAt: '2026-05-01T22:30:09.000Z',
      }),
      'utf8',
    )
    await writeFile(
      blankEmailPath,
      JSON.stringify({
        ...createFounder(),
        email: '   ',
      }),
      'utf8',
    )

    await expect(new OperatorStore(missingEmailPath).getFounderById('founder-1')).resolves.toMatchObject({
      email: null,
    })
    await expect(new OperatorStore(blankEmailPath).getFounderById('founder-1')).resolves.toMatchObject({
      email: null,
    })
    await expect(new OperatorStore(join(dir, '.hammurabi', 'operators-save.json')).saveFounder(
      createFounder({ email: '   ' }),
    )).resolves.toMatchObject({ email: null })
  })

  it('migrates synthetic auth0.local emails to null and persists the migration once', async () => {
    const dir = await createTempDir('hammurabi-operator-synthetic-email-')
    const storePath = join(dir, '.hammurabi', 'operators.json')
    await mkdir(join(dir, '.hammurabi'), { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        ...createFounder(),
        email: 'google-oauth2|106050570920402391077@auth0.local',
      }),
      'utf8',
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const firstLoad = new OperatorStore(storePath)
    await expect(firstLoad.getFounderById('founder-1')).resolves.toMatchObject({
      email: null,
    })
    expect(warn).toHaveBeenCalledTimes(1)

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as Operator
    expect(persisted.email).toBeNull()

    const secondLoad = new OperatorStore(storePath)
    await expect(secondLoad.getFounderById('founder-1')).resolves.toMatchObject({
      email: null,
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('migration write does not clobber a concurrent saveFounder', async () => {
    const dir = await createTempDir('hammurabi-operator-synthetic-email-race-')
    const storePath = join(dir, '.hammurabi', 'operators.json')
    await mkdir(join(dir, '.hammurabi'), { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        ...createFounder(),
        email: 'google-oauth2|106050570920402391077@auth0.local',
      }),
      'utf8',
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const loadingStore = new OperatorStore(storePath)
    const savingStore = new OperatorStore(storePath)
    const realFounder = createFounder({ email: 'real@example.com' })
    const originalReadRawOperator = (
      loadingStore as unknown as {
        readRawOperator: () => Promise<RawOperatorReadForTest | null>
      }
    ).readRawOperator.bind(loadingStore)
    let readCount = 0
    const readRawOperator = vi.fn(async () => {
      readCount += 1
      if (readCount === 2) {
        await savingStore.saveFounder(realFounder)
      }
      return originalReadRawOperator()
    })
    ;(
      loadingStore as unknown as {
        readRawOperator: () => Promise<RawOperatorReadForTest | null>
      }
    ).readRawOperator = readRawOperator

    await expect(loadingStore.getFounderById('founder-1')).resolves.toMatchObject({
      email: 'real@example.com',
    })

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as Operator
    expect(persisted).toEqual(realFounder)
    expect(readRawOperator).toHaveBeenCalledTimes(2)
  })

  it('uses a single in-flight load across concurrent cold reads and a save', async () => {
    const dir = await createTempDir('hammurabi-operator-single-flight-')
    const storePath = join(dir, '.hammurabi', 'operators.json')
    const store = new OperatorStore(storePath)
    const founder = createFounder()
    const loads: Deferred<Operator | null>[] = []

    const readFromDisk = vi.fn(async () => {
      const deferred = createDeferred<Operator | null>()
      loads.push(deferred)
      return deferred.promise
    })
    ;(store as unknown as { readFromDisk: typeof readFromDisk }).readFromDisk = readFromDisk

    const firstRead = store.getFounderById(founder.id)
    await Promise.resolve()
    const secondRead = store.getFounderById(founder.id)
    await Promise.resolve()
    const save = store.saveFounder(founder)
    await Promise.resolve()

    expect(readFromDisk).toHaveBeenCalledTimes(1)
    expect(loads).toHaveLength(1)

    loads[0]?.resolve(null)

    await expect(firstRead).resolves.toBeNull()
    await expect(secondRead).resolves.toBeNull()
    await expect(save).resolves.toEqual(founder)
    await expect(store.getFounderById(founder.id)).resolves.toEqual(founder)
  })
})

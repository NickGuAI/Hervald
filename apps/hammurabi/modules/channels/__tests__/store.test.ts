import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommanderChannelBindingStore } from '../store'

const tempDirs: string[] = []

async function createTempStore(): Promise<{
  store: CommanderChannelBindingStore
  storePath: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-channels-store-'))
  tempDirs.push(dir)
  const storePath = join(dir, 'channels.json')
  return {
    store: new CommanderChannelBindingStore(storePath),
    storePath,
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('CommanderChannelBindingStore', () => {
  it('creates, lists, updates, deletes, and persists commander channel bindings', async () => {
    const { store, storePath } = await createTempStore()

    const created = await store.create({
      commanderId: 'cmd-1',
      provider: 'telegram',
      accountId: 'bot-main',
      displayName: 'PM AI Telegram',
      enabled: true,
      config: { chatId: '123' },
    })

    expect(await store.listByCommander('cmd-1')).toEqual([created])

    const updated = await store.update('cmd-1', created.id, {
      displayName: 'PM AI Telegram Primary',
      enabled: false,
    })
    expect(updated).toMatchObject({
      id: created.id,
      displayName: 'PM AI Telegram Primary',
      enabled: false,
      config: { chatId: '123' },
    })

    const reloaded = new CommanderChannelBindingStore(storePath)
    await expect(reloaded.listByCommander('cmd-1')).resolves.toHaveLength(1)

    await expect(store.delete('cmd-1', created.id)).resolves.toBe(true)
    await expect(store.listByCommander('cmd-1')).resolves.toEqual([])

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as { bindings: unknown[] }
    expect(persisted.bindings).toEqual([])
  })

  it('rejects unknown providers', async () => {
    const { store } = await createTempStore()

    await expect(store.create({
      commanderId: 'cmd-1',
      provider: 'signal' as 'telegram',
      accountId: 'bot-main',
      displayName: 'Signal',
    })).rejects.toThrow('provider must be whatsapp, telegram, or discord')
  })
})

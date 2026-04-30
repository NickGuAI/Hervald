import { describe, expect, it } from 'vitest'
import { withCommanderMemoryMutationLock } from '../mutation-lock.js'

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('withCommanderMemoryMutationLock', () => {
  it('serializes concurrent mutations for the same commander', async () => {
    const order: string[] = []
    const firstStarted = createDeferred()
    const allowFirstFinish = createDeferred()

    const first = withCommanderMemoryMutationLock('cmdr-shared', async () => {
      order.push('first:start')
      firstStarted.resolve()
      await allowFirstFinish.promise
      order.push('first:end')
      return 'first'
    })

    await firstStarted.promise

    const second = withCommanderMemoryMutationLock('cmdr-shared', async () => {
      order.push('second:start')
      return 'second'
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])

    allowFirstFinish.resolve()

    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('continues processing after an earlier mutation fails', async () => {
    const order: string[] = []
    const allowFirstFinish = createDeferred()

    const first = withCommanderMemoryMutationLock('cmdr-error', async () => {
      order.push('first:start')
      await allowFirstFinish.promise
      order.push('first:throw')
      throw new Error('boom')
    })

    const second = withCommanderMemoryMutationLock('cmdr-error', async () => {
      order.push('second:start')
      return 'second'
    })

    allowFirstFinish.resolve()

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first:start', 'first:throw', 'second:start'])
  })
})

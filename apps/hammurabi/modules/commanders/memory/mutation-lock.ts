import path from 'node:path'

const memoryMutationQueues = new Map<string, Promise<void>>()

function withMutationLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = memoryMutationQueues.get(key) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  const settled = next.then(
    () => undefined,
    () => undefined,
  )

  memoryMutationQueues.set(key, settled)

  return next.finally(() => {
    if (memoryMutationQueues.get(key) === settled) {
      memoryMutationQueues.delete(key)
    }
  })
}

export function withCommanderMemoryMutationLock<T>(
  commanderId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withMutationLock(`commander:${commanderId}`, operation)
}

export function withMemoryMutationLock<T>(
  memoryRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withMutationLock(`memory-root:${path.resolve(memoryRoot)}`, operation)
}

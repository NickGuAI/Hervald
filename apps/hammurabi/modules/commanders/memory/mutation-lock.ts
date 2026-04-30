const commanderMemoryMutationLocks = new Map<string, Promise<void>>()

export async function withCommanderMemoryMutationLock<T>(
  commanderId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = commanderMemoryMutationLocks.get(commanderId) ?? Promise.resolve()
  const settledPrevious = previous.catch(() => undefined)

  let releaseCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = settledPrevious.then(() => current)
  commanderMemoryMutationLocks.set(commanderId, tail)

  await settledPrevious

  try {
    return await operation()
  } finally {
    releaseCurrent()
    if (commanderMemoryMutationLocks.get(commanderId) === tail) {
      commanderMemoryMutationLocks.delete(commanderId)
    }
  }
}

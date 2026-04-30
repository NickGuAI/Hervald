export interface QueueMutationCallbacks {
  onApplied?(): void
  onMutationError?(error: unknown): void
  onRefreshError?(error: unknown): void
}

export async function runQueueMutationRequest(
  request: () => Promise<unknown>,
  refreshQueueSnapshot: () => Promise<void>,
  callbacks: QueueMutationCallbacks = {},
): Promise<boolean> {
  try {
    await request()
  } catch (error) {
    callbacks.onMutationError?.(error)
    return false
  }

  callbacks.onApplied?.()

  try {
    await refreshQueueSnapshot()
  } catch (error) {
    callbacks.onRefreshError?.(error)
  }

  return true
}

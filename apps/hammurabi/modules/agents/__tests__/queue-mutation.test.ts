import { describe, expect, it, vi } from 'vitest'
import { runQueueMutationRequest } from '../queue-mutation'

describe('runQueueMutationRequest', () => {
  it('returns success when the mutation applies even if the refresh fails', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const refreshQueueSnapshot = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const onApplied = vi.fn()
    const onRefreshError = vi.fn()

    await expect(
      runQueueMutationRequest(request, refreshQueueSnapshot, {
        onApplied,
        onRefreshError,
      }),
    ).resolves.toBe(true)

    expect(request).toHaveBeenCalledTimes(1)
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(refreshQueueSnapshot).toHaveBeenCalledTimes(1)
    expect(onRefreshError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('returns false when the mutation request itself fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('mutation failed'))
    const refreshQueueSnapshot = vi.fn()
    const onApplied = vi.fn()
    const onMutationError = vi.fn()

    await expect(
      runQueueMutationRequest(request, refreshQueueSnapshot, {
        onApplied,
        onMutationError,
      }),
    ).resolves.toBe(false)

    expect(onMutationError).toHaveBeenCalledWith(expect.any(Error))
    expect(onApplied).not.toHaveBeenCalled()
    expect(refreshQueueSnapshot).not.toHaveBeenCalled()
  })
})

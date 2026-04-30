import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ApprovalCoordinator } from '../pending-store'
import * as shared from '../shared'
import { PolicyStore } from '../store'

const tempDirectories: string[] = []
const EARLY_WRITE_TIMEOUT_MS = 75

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function observeEarlySignal(signal: Promise<void>): Promise<boolean> {
  return Promise.race([
    signal.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), EARLY_WRITE_TIMEOUT_MS)
    }),
  ])
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('policy persistence', () => {
  it('serializes concurrent policy writes before the next mutation can persist', async () => {
    const rootDir = await createTempDir('hammurabi-policy-store-')
    const store = new PolicyStore({
      filePath: path.join(rootDir, 'policies.json'),
    })

    const originalWriteJsonFile = shared.writeJsonFile
    const firstWriteStarted = createDeferred()
    const firstWriteReleased = createDeferred()
    let resolveSecondWriteStarted: (() => void) | null = null
    const secondWriteStarted = new Promise<void>((resolve) => {
      resolveSecondWriteStarted = resolve
    })
    let writeCalls = 0

    vi.spyOn(shared, 'writeJsonFile').mockImplementation(async (filePath, value) => {
      writeCalls += 1
      if (writeCalls === 1) {
        firstWriteStarted.resolve()
        await firstWriteReleased.promise
      } else if (writeCalls === 2) {
        resolveSecondWriteStarted?.()
      }

      await originalWriteJsonFile(filePath, value)
    })

    const firstMutation = store.putPolicy('global', 'send-message', {
      policy: 'review',
      allowlist: ['ops-room'],
      blocklist: [],
    })
    await firstWriteStarted.promise

    const secondMutation = store.putPolicy('global', 'send-email', {
      policy: 'block',
      allowlist: [],
      blocklist: ['ceo@example.com'],
    })

    expect(await observeEarlySignal(secondWriteStarted)).toBe(false)

    firstWriteReleased.resolve()
    await Promise.all([firstMutation, secondMutation])

    const globalPolicyView = await store.getGlobal()
    expect(globalPolicyView.records.find((record) => record.actionId === 'send-message')).toEqual(
      expect.objectContaining({
        actionId: 'send-message',
        policy: 'review',
        allowlist: ['ops-room'],
        blocklist: [],
      }),
    )
    expect(globalPolicyView.records.find((record) => record.actionId === 'send-email')).toEqual(
      expect.objectContaining({
        actionId: 'send-email',
        policy: 'block',
        allowlist: [],
        blocklist: ['ceo@example.com'],
      }),
    )
  })

  it('uses HAMMURABI_DATA_DIR/policies as the default persistence root without consulting process.cwd', async () => {
    const dataDir = await createTempDir('hammurabi-policy-data-root-')
    const legacyCwd = await createTempDir('hammurabi-policy-legacy-cwd-')
    const originalDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = dataDir
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(legacyCwd)

    try {
      const store = new PolicyStore()
      const coordinator = new ApprovalCoordinator()

      await store.putPolicy('global', 'send-email', {
        policy: 'review',
        allowlist: ['teammate@example.com'],
        blocklist: [],
      })
      await coordinator.createPendingApproval({
        source: 'claude',
        sessionId: 'session-1',
        actionId: 'send-email',
        actionLabel: 'Send Email',
        toolName: 'Bash',
        context: {
          summary: 'Email teammate',
          details: { To: 'teammate@example.com' },
        },
      })

      expect(cwdSpy).not.toHaveBeenCalled()
      expect(
        JSON.parse(await readFile(path.join(dataDir, 'policies', 'policies.json'), 'utf8')) as {
          global?: { records?: unknown[] }
        },
      ).toEqual(expect.objectContaining({
        global: expect.objectContaining({
          records: expect.arrayContaining([
            expect.objectContaining({
              actionId: 'send-email',
            }),
          ]),
        }),
      }))
      expect(
        JSON.parse(await readFile(path.join(dataDir, 'policies', 'pending.json'), 'utf8')) as {
          approvals?: unknown[]
        },
      ).toEqual(expect.objectContaining({
        approvals: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'send-email',
          }),
        ]),
      }))
      await expect(readFile(path.join(legacyCwd, 'data', 'policies', 'policies.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(readFile(path.join(legacyCwd, 'data', 'policies', 'pending.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      process.env.HAMMURABI_DATA_DIR = originalDataDir
    }
  })
})

describe('approval persistence', () => {
  it('serializes concurrent pending-approval snapshot writes', async () => {
    const rootDir = await createTempDir('hammurabi-approval-coordinator-')
    const snapshotFilePath = path.join(rootDir, 'pending.json')
    const auditFilePath = path.join(rootDir, 'audit.jsonl')
    const coordinator = new ApprovalCoordinator({
      snapshotFilePath,
      auditFilePath,
    })

    const originalWriteJsonFile = shared.writeJsonFile
    const firstSnapshotWriteStarted = createDeferred()
    const firstSnapshotWriteReleased = createDeferred()
    let resolveSecondSnapshotWriteStarted: (() => void) | null = null
    const secondSnapshotWriteStarted = new Promise<void>((resolve) => {
      resolveSecondSnapshotWriteStarted = resolve
    })
    let snapshotWriteCalls = 0

    vi.spyOn(shared, 'writeJsonFile').mockImplementation(async (filePath, value) => {
      if (filePath === snapshotFilePath) {
        snapshotWriteCalls += 1
        if (snapshotWriteCalls === 1) {
          firstSnapshotWriteStarted.resolve()
          await firstSnapshotWriteReleased.promise
        } else if (snapshotWriteCalls === 2) {
          resolveSecondSnapshotWriteStarted?.()
        }
      }

      await originalWriteJsonFile(filePath, value)
    })

    const firstEnqueue = coordinator.createPendingApproval({
      source: 'claude',
      sessionId: 'session-1',
      commanderId: 'commander-1',
      actionId: 'send-message',
      actionLabel: 'Send Message',
      toolName: 'bash',
      context: {
        summary: 'Post to ops room',
        details: { target: 'ops-room' },
      },
    })
    await firstSnapshotWriteStarted.promise

    const secondEnqueue = coordinator.createPendingApproval({
      source: 'claude',
      sessionId: 'session-2',
      commanderId: 'commander-1',
      actionId: 'send-email',
      actionLabel: 'Send Email',
      toolName: 'gmail.send',
      context: {
        summary: 'Email the CEO',
        details: { recipient: 'ceo@example.com' },
      },
    })

    expect(await observeEarlySignal(secondSnapshotWriteStarted)).toBe(false)

    firstSnapshotWriteReleased.resolve()
    await Promise.all([firstEnqueue, secondEnqueue])

    const reloadedCoordinator = new ApprovalCoordinator({
      snapshotFilePath,
      auditFilePath,
    })
    const pendingApprovals = await reloadedCoordinator.listPending()

    expect(pendingApprovals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'send-message',
          sessionId: 'session-1',
          source: 'claude',
        }),
        expect.objectContaining({
          actionId: 'send-email',
          sessionId: 'session-2',
          source: 'claude',
        }),
      ]),
    )
  })

  it('returns the real resolution when waiting begins after the approval already resolved', async () => {
    const rootDir = await createTempDir('hammurabi-approval-resolved-outcome-')
    const coordinator = new ApprovalCoordinator({
      snapshotFilePath: path.join(rootDir, 'pending.json'),
      auditFilePath: path.join(rootDir, 'audit.jsonl'),
    })

    const approval = await coordinator.createPendingApproval({
      source: 'claude',
      sessionId: 'session-1',
      commanderId: 'commander-1',
      actionId: 'send-email',
      actionLabel: 'Send Email',
      toolName: 'gmail.send',
      context: {
        summary: 'Email the CEO',
        details: { recipient: 'ceo@example.com' },
      },
      onResolve: (decision, options) => ({
        decision,
        allowed: decision === 'approve',
        reason: options?.timedOut ? 'Approval timed out.' : 'Resolved before wait started.',
        timedOut: options?.timedOut,
      }),
    })

    const resolved = await coordinator.resolvePendingApproval(approval.id, 'reject')
    expect(resolved).toEqual(expect.objectContaining({
      ok: true,
      outcome: {
        decision: 'reject',
        allowed: false,
        reason: 'Resolved before wait started.',
        timedOut: undefined,
      },
    }))

    const outcome = await coordinator.waitForResolution(approval.id, {
      timeoutMs: 1,
      timeoutAction: 'approve',
    })

    expect(outcome).toEqual({
      decision: 'reject',
      allowed: false,
      reason: 'Resolved before wait started.',
      timedOut: undefined,
    })
  })
})

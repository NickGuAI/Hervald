import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { buildFallbackClaudeApprovalSession } from '../modules/agents/adapters/claude/approval-adapter.js'
import { ActionPolicyGate } from '../modules/policies/action-policy-gate.js'
import { ApprovalCoordinator } from '../modules/policies/pending-store.js'
import { handleProviderApproval } from '../modules/policies/provider-approval-adapter.js'
import { PolicyStore } from '../modules/policies/store.js'

const ITERATIONS = 1000
const WARMUP_ITERATIONS = 50

function percentile(sortedDurations: number[], value: number): number {
  if (sortedDurations.length === 0) {
    return 0
  }

  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil(sortedDurations.length * value) - 1),
  )
  return sortedDurations[index] ?? 0
}

async function main(): Promise<void> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-approval-bench-'))

  try {
    const approvalCoordinator = new ApprovalCoordinator({
      snapshotFilePath: path.join(rootDir, 'pending.json'),
      auditFilePath: path.join(rootDir, 'audit.jsonl'),
    })
    const policyStore = new PolicyStore({
      filePath: path.join(rootDir, 'policies.json'),
    })
    const actionPolicyGate = new ActionPolicyGate({
      approvalCoordinator,
      policyStore,
      getApprovalSessionsInterface: () => null,
    })
    const session = {
      ...buildFallbackClaudeApprovalSession('benchmark-fast-path'),
      cwd: '/tmp/benchmark-fast-path',
    }
    const adapter = {
      source: 'benchmark',
      toUnifiedRequest() {
        return {
          source: 'benchmark',
          toolName: 'Bash',
          toolInput: {
            command: 'ls -la',
          },
          sessionName: session.name,
          fallbackSessionName: session.name,
        }
      },
      async sendReply() {
        return
      },
    }

    for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
      await handleProviderApproval(adapter, {}, session, { actionPolicyGate })
    }

    const durations: number[] = []
    for (let index = 0; index < ITERATIONS; index += 1) {
      const startedAt = performance.now()
      await handleProviderApproval(adapter, {}, session, { actionPolicyGate })
      durations.push(performance.now() - startedAt)
    }

    const sorted = [...durations].sort((left, right) => left - right)
    const meanMs = durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    const summary = {
      iterations: ITERATIONS,
      warmupIterations: WARMUP_ITERATIONS,
      p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
      p99Ms: Number(percentile(sorted, 0.99).toFixed(3)),
      meanMs: Number(meanMs.toFixed(3)),
    }

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

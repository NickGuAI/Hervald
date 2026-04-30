import type { AgentSession, AgentType } from '@/types'

export type WorkerStatus = 'running' | 'down' | 'starting' | 'done'

export interface WorkerInfo {
  name: string
  status: WorkerStatus
  phase: 'starting' | 'running' | 'exited'
}

export interface WorkerSummary {
  total: number
  running: number
  down: number
  starting: number
  done: number
}

export type AgentSessionWithWorkers = AgentSession & {
  processAlive?: boolean
  hadResult?: boolean
  resumedFrom?: string
  spawnedWorkers?: string[]
  workerSummary?: WorkerSummary
  queuedMessageCount?: number
}

export function summarizeWorkers(workers: WorkerInfo[]): WorkerSummary {
  const summary: WorkerSummary = {
    total: workers.length,
    running: 0,
    down: 0,
    starting: 0,
    done: 0,
  }

  for (const worker of workers) {
    if (worker.status === 'running') summary.running += 1
    if (worker.status === 'down') summary.down += 1
    if (worker.status === 'starting') summary.starting += 1
    if (worker.status === 'done') summary.done += 1
  }

  return summary
}

export function fallbackWorkerSummary(workerCount: number): WorkerSummary {
  return {
    total: workerCount,
    running: 0,
    down: 0,
    starting: workerCount,
    done: 0,
  }
}

export function isWorkerOrchestrationComplete(summary: WorkerSummary | null): boolean {
  if (!summary) return false

  return (
    summary.total > 0
    && summary.done === summary.total
    && summary.running === 0
    && summary.starting === 0
    && summary.down === 0
  )
}

export function workerStatusSymbol(status: WorkerStatus): string {
  if (status === 'running') return '●'
  if (status === 'down') return '⊘'
  if (status === 'done') return '✓'
  return '○'
}

export function workerStatusClass(status: WorkerStatus): string {
  if (status === 'running') return 'text-emerald-500'
  if (status === 'down') return 'text-accent-vermillion'
  if (status === 'done') return 'text-sumi-diluted'
  return 'text-sumi-mist'
}

export function shouldAttemptDebriefOnKill(_agentType?: AgentType | null): boolean {
  return true
}

export function getKillConfirmationMessage(sessionName: string, agentType?: AgentType | null): string {
  if (!shouldAttemptDebriefOnKill(agentType)) {
    return `Kill session "${sessionName}"?`
  }

  return `Kill session "${sessionName}"?\n\nIf available, a debrief will be attempted before termination.`
}

export function isNotFoundRequestFailure(caughtError: unknown): boolean {
  return caughtError instanceof Error && caughtError.message.includes('Request failed (404):')
}

export function formatError(caughtError: unknown, fallback: string): string {
  if (caughtError instanceof Error && caughtError.message) {
    return caughtError.message
  }

  return fallback
}

export const EVAL_BENCHES = [
  'terminal-bench',
  'locomo',
  'marble',
  'hal-reliability',
  'tau-bench',
] as const

export const EVAL_PROFILES = ['smoke', 'full', 'release-gate'] as const

export const EVAL_RUNNER_MODES = [
  'subscription-host-cli',
  'subscription-sbx',
  'api-key',
  'proxy-experimental',
] as const

export const EVAL_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'blocked',
  'submitted',
] as const

export type EvalBench = (typeof EVAL_BENCHES)[number]
export type EvalProfile = (typeof EVAL_PROFILES)[number]
export type EvalRunnerMode = (typeof EVAL_RUNNER_MODES)[number]
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number]

export interface EvalTelemetryMetadata {
  source: string
  run_id: string
  bench: EvalBench
  task_id?: string
  turn?: number
  runner_mode: EvalRunnerMode
}

export interface EvalRunConfig {
  runId: string
  bench: EvalBench
  source: string
  profile: EvalProfile
  runnerMode: EvalRunnerMode
  authMode: 'subscription' | 'api-key' | 'proxy-experimental'
  commanderId?: string
  model?: string
  provider?: string
  host?: string
  gitSha?: string
  datasetVersion?: string
  adapterVersion?: string
  environmentHash?: string
  createdAt: string
}

export interface EvalTaskResult {
  taskId: string
  status: 'passed' | 'failed' | 'blocked' | 'skipped'
  score?: number
  runtimeMs?: number
  failure?: string
}

export interface EvalRunResult {
  runId: string
  bench: EvalBench
  status: EvalRunStatus
  score?: number
  passRate?: number
  costUsd?: number
  subscriptionLimitUsage?: string
  runtimeMs?: number
  failures: string[]
  tasks: EvalTaskResult[]
  completedAt?: string
}

export interface EvalLeaderboardState {
  status: 'not-submitted' | 'blocked' | 'submitted'
  publicUrl?: string
  blocker?: string
  updatedAt: string
}

export interface EvalRunManifest {
  runId: string
  bench: EvalBench
  source: string
  profile: EvalProfile
  runnerMode: EvalRunnerMode
  authMode: EvalRunConfig['authMode']
  status: EvalRunStatus
  createdAt: string
  updatedAt: string
  rootPath: string
  configPath: string
  resultPath: string
  summaryPath: string
  trajectoriesPath: string
  leaderboardPath: string
  score?: number
  passRate?: number
  costUsd?: number
  subscriptionLimitUsage?: string
  runtimeMs?: number
  failures: string[]
  tasks: EvalTaskResult[]
  telemetryMetadata: EvalTelemetryMetadata
  leaderboard: EvalLeaderboardState
  summaryMarkdown?: string
}

export interface EvalRunManifestFilters {
  source?: string
  bench?: EvalBench
  runnerMode?: EvalRunnerMode
}

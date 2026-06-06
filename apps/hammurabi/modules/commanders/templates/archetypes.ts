export type CommanderContextMode = 'thin' | 'fat'

export interface CommanderArchetypeTaskSource {
  owner: string
  repo: string
  label?: string
}

export interface CommanderArchetype {
  id: string
  label: string
  description: string
  defaultDisplayName?: string
  defaultAgentType?: string
  defaultCwd?: string
  defaultIdentityOperatingStyle: string
  defaultHeartbeatMinutes: number
  defaultMaxTurns?: number
  defaultContextMode: CommanderContextMode
  defaultContextConfig?: {
    fatPinInterval?: number
  }
  suggestedTaskSource?: CommanderArchetypeTaskSource
}

export const COMMANDER_ARCHETYPES: CommanderArchetype[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    description: 'Code review, PR management, and issue triage.',
    defaultIdentityOperatingStyle:
      'Senior engineer who owns code quality, reviews pull requests, triages issues, and ships reliable changes.',
    defaultHeartbeatMinutes: 15,
    defaultContextMode: 'thin',
    suggestedTaskSource: {
      owner: 'NickGuAI',
      repo: 'example-repo',
    },
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Web research, report generation, and synthesis.',
    defaultIdentityOperatingStyle:
      'Research analyst who decomposes questions, gathers evidence, and produces concise, decision-ready summaries.',
    defaultHeartbeatMinutes: 60,
    defaultContextMode: 'fat',
  },
  {
    id: 'ops',
    label: 'Operations',
    description: 'Monitoring, deployment workflows, and incident response.',
    defaultIdentityOperatingStyle:
      'Operations engineer who monitors system health, manages deployments, and drives incident response with clear updates.',
    defaultHeartbeatMinutes: 5,
    defaultContextMode: 'thin',
  },
  {
    id: 'benchmark',
    label: 'Benchmark',
    description: 'Benchmark-only evaluation runs against the Hammurabi benchmark adapters workspace.',
    defaultDisplayName: 'Benchmark Commander',
    defaultAgentType: 'codex',
    defaultCwd: '/home/builder/App/benchmarks/hammurabi',
    defaultIdentityOperatingStyle:
      'Benchmark-only commander. Run benchmark tasks exactly as assigned, keep scope limited to benchmark execution and reporting, and avoid taking on unrelated product or operations work.',
    defaultHeartbeatMinutes: 30,
    defaultMaxTurns: 300,
    defaultContextMode: 'fat',
    defaultContextConfig: {
      fatPinInterval: 2,
    },
    suggestedTaskSource: {
      owner: 'NickGuAI',
      repo: 'Hervald',
      label: 'benchmark',
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Start from scratch with a blank configuration.',
    defaultIdentityOperatingStyle: '',
    defaultHeartbeatMinutes: 15,
    defaultContextMode: 'thin',
  },
]

export function findCommanderArchetype(id: string): CommanderArchetype | undefined {
  return COMMANDER_ARCHETYPES.find((archetype) => archetype.id === id)
}

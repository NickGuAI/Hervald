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
  defaultPersona: string
  defaultHeartbeatMinutes: number
  defaultContextMode: CommanderContextMode
  suggestedTaskSource?: CommanderArchetypeTaskSource
}

export const COMMANDER_ARCHETYPES: CommanderArchetype[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    description: 'Code review, PR management, and issue triage.',
    defaultPersona:
      'Senior engineer who owns code quality, reviews pull requests, triages issues, and ships reliable changes.',
    defaultHeartbeatMinutes: 15,
    defaultContextMode: 'thin',
    suggestedTaskSource: {
      owner: 'NickGuAI',
      repo: 'monorepo-g',
    },
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Web research, report generation, and synthesis.',
    defaultPersona:
      'Research analyst who decomposes questions, gathers evidence, and produces concise, decision-ready summaries.',
    defaultHeartbeatMinutes: 60,
    defaultContextMode: 'fat',
  },
  {
    id: 'ops',
    label: 'Operations',
    description: 'Monitoring, deployment workflows, and incident response.',
    defaultPersona:
      'Operations engineer who monitors system health, manages deployments, and drives incident response with clear updates.',
    defaultHeartbeatMinutes: 5,
    defaultContextMode: 'thin',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Start from scratch with a blank persona.',
    defaultPersona: '',
    defaultHeartbeatMinutes: 15,
    defaultContextMode: 'thin',
  },
]

export function findCommanderArchetype(id: string): CommanderArchetype | undefined {
  return COMMANDER_ARCHETYPES.find((archetype) => archetype.id === id)
}

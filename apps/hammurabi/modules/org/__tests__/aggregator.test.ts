import { describe, expect, it } from 'vitest'
import type { Automation } from '../../automations/types'
import type { Operator } from '../../operators/types'
import {
  buildOrgTree,
  type BuildOrgTreeDependencies,
  type OrgCommanderRecord,
  type OrgConversationRecord,
  type OrgQuestRecord,
} from '../aggregator'

function createFounder(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 'founder-1',
    kind: 'founder',
    displayName: 'Nick Gu',
    email: 'nick@example.com',
    avatarUrl: 'https://example.com/founder.png',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function createCommander(overrides: Partial<OrgCommanderRecord> = {}): OrgCommanderRecord {
  return {
    id: 'cmdr-1',
    displayName: 'Atlas',
    operatorId: 'founder-1',
    state: 'running',
    created: '2026-05-01T01:00:00.000Z',
    roleKey: 'engineering',
    templateId: 'template-atlas',
    replicatedFromCommanderId: null,
    ...overrides,
  }
}

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    operatorId: 'founder-1',
    parentCommanderId: null,
    name: 'daily-briefing',
    trigger: 'schedule',
    schedule: '0 9 * * *',
    instruction: 'Send the daily brief.',
    agentType: 'claude',
    permissionMode: 'default',
    skills: [],
    templateId: null,
    status: 'enabled',
    ...overrides,
  }
}

function createQuest(status: OrgQuestRecord['status']): OrgQuestRecord {
  return { status }
}

function createConversation(overrides: Partial<OrgConversationRecord> = {}): OrgConversationRecord {
  return {
    surface: 'ui',
    status: 'idle',
    currentTask: null,
    totalCostUsd: 0,
    lastHeartbeat: null,
    lastMessageAt: '2026-05-01T01:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function createDeps(input: {
  founder?: Operator | null
  commanders?: ReadonlyArray<OrgCommanderRecord>
  automations?: ReadonlyArray<Automation>
  conversationsByCommander?: Record<string, ReadonlyArray<OrgConversationRecord>>
  questsByCommander?: Record<string, ReadonlyArray<OrgQuestRecord>>
  avatarsByCommander?: Record<string, string | null>
  conversationErrorCommanderIds?: string[]
} = {}): BuildOrgTreeDependencies {
  const founder = input.founder ?? createFounder()
  const commanders = input.commanders ?? []
  const automations = input.automations ?? []
  const conversationsByCommander = input.conversationsByCommander ?? {}
  const questsByCommander = input.questsByCommander ?? {}
  const avatarsByCommander = input.avatarsByCommander ?? {}
  const conversationErrorCommanderIds = new Set(input.conversationErrorCommanderIds ?? [])

  return {
    operatorStore: {
      async getFounder() {
        return founder
      },
    },
    commanderSessionStore: {
      async list() {
        return commanders
      },
    },
    automationStore: {
      async list() {
        return automations
      },
    },
    conversationStore: {
      async listByCommander(commanderId: string) {
        if (conversationErrorCommanderIds.has(commanderId)) {
          throw new Error(`conversation store failed for ${commanderId}`)
        }
        return conversationsByCommander[commanderId] ?? []
      },
    },
    questStore: {
      async list(commanderId: string) {
        return questsByCommander[commanderId] ?? []
      },
    },
    profileStore: {
      async getAvatarUrl(commanderId: string) {
        return avatarsByCommander[commanderId] ?? null
      },
    },
  }
}

describe('buildOrgTree', () => {
  it('returns an empty tree when the founder exists with no commanders or automations', async () => {
    const tree = await buildOrgTree(createDeps())

    expect(tree.operator).toEqual(createFounder())
    expect(tree.commanders).toEqual([])
    expect(tree.automations).toEqual([])
  })

  it('aggregates commander channels, UI chats, cost, recent activity, and quests', async () => {
    const commander = createCommander()
    const tree = await buildOrgTree(createDeps({
      commanders: [commander],
      conversationsByCommander: {
        [commander.id]: [
          createConversation({
            surface: 'whatsapp',
            status: 'active',
            totalCostUsd: 1.25,
            lastHeartbeat: '2026-05-01T03:00:00.000Z',
            lastMessageAt: '2026-05-01T02:30:00.000Z',
          }),
          createConversation({
            surface: 'telegram',
            status: 'idle',
            totalCostUsd: 2.75,
            lastMessageAt: '2026-05-01T02:45:00.000Z',
          }),
          createConversation({
            surface: 'ui',
            status: 'active',
            totalCostUsd: 3.5,
            currentTask: { issueUrl: 'https://github.com/NickGuAI/Hervald/issues/1198' },
            lastHeartbeat: '2026-05-01T04:00:00.000Z',
          }),
          createConversation({
            surface: 'cli',
            status: 'active',
            totalCostUsd: 0.5,
            lastMessageAt: '2026-05-01T03:30:00.000Z',
          }),
        ],
      },
      questsByCommander: {
        [commander.id]: [createQuest('active'), createQuest('pending'), createQuest('done')],
      },
      avatarsByCommander: {
        [commander.id]: '/api/commanders/cmdr-1/avatar',
      },
    }))

    expect(tree.commanders).toEqual([
      {
        id: 'cmdr-1',
        kind: 'commander',
        parentId: 'founder-1',
        displayName: 'Atlas',
        roleKey: 'engineering',
        avatarUrl: '/api/commanders/cmdr-1/avatar',
        status: 'running',
        costUsd: 8,
        recentActivityAt: '2026-05-01T04:00:00.000Z',
        questsInFlight: { active: 1, pending: 1 },
        channels: { whatsapp: 1, telegram: 1, discord: 0 },
        activeUiChats: 2,
        counts: { activeQuests: 1, activeWorkers: 0, activeChats: 2 },
        archived: false,
        archivedAt: undefined,
        templateId: 'template-atlas',
        replicatedFromCommanderId: null,
      },
    ])
  })

  it('preserves mixed commander states and defaults avatarUrl to null when profile data is missing', async () => {
    const atlas = createCommander({ id: 'cmdr-atlas', displayName: 'Atlas', state: 'running' })
    const hermes = createCommander({
      id: 'cmdr-hermes',
      displayName: 'Hermes',
      state: 'paused',
      roleKey: 'validator',
      templateId: null,
      replicatedFromCommanderId: 'cmdr-atlas',
    })

    const tree = await buildOrgTree(createDeps({
      commanders: [atlas, hermes],
      questsByCommander: {
        [atlas.id]: [createQuest('active')],
        [hermes.id]: [createQuest('pending'), createQuest('pending')],
      },
    }))

    expect(tree.commanders).toEqual([
      expect.objectContaining({
        id: 'cmdr-atlas',
        status: 'running',
        avatarUrl: null,
        questsInFlight: { active: 1, pending: 0 },
      }),
      expect.objectContaining({
        id: 'cmdr-hermes',
        status: 'paused',
        roleKey: 'validator',
        avatarUrl: null,
        questsInFlight: { active: 0, pending: 2 },
        replicatedFromCommanderId: 'cmdr-atlas',
      }),
    ])
  })

  it('attaches automations either to the founder root or to their parent commander', async () => {
    const commander = createCommander()
    const tree = await buildOrgTree(createDeps({
      commanders: [commander],
      automations: [
        createAutomation({
          id: 'auto-root',
          parentCommanderId: null,
          name: 'daily-briefing',
          trigger: 'schedule',
        }),
        createAutomation({
          id: 'auto-child',
          parentCommanderId: commander.id,
          name: 'validator-on-quest-done',
          trigger: 'quest',
          questTrigger: { event: 'completed', commanderId: commander.id },
        }),
      ],
    }))

    expect(tree.automations).toEqual([
      {
        id: 'auto-root',
        kind: 'automation',
        parentId: 'founder-1',
        displayName: 'daily-briefing',
        status: 'enabled',
        costUsd: 0,
        recentActivityAt: null,
        templateId: null,
        trigger: 'schedule',
      },
      {
        id: 'auto-child',
        kind: 'automation',
        parentId: 'cmdr-1',
        displayName: 'validator-on-quest-done',
        status: 'enabled',
        costUsd: 0,
        recentActivityAt: null,
        templateId: null,
        trigger: 'quest',
      },
    ])
  })

  it('falls back to zeroed conversation aggregates when the conversation store fails', async () => {
    const commander = createCommander()
    const tree = await buildOrgTree(createDeps({
      commanders: [commander],
      questsByCommander: {
        [commander.id]: [createQuest('pending')],
      },
      conversationErrorCommanderIds: [commander.id],
    }))

    expect(tree.commanders).toEqual([
      expect.objectContaining({
        id: 'cmdr-1',
        channels: { whatsapp: 0, telegram: 0, discord: 0 },
        activeUiChats: 0,
        costUsd: 0,
        recentActivityAt: null,
        questsInFlight: { active: 0, pending: 1 },
      }),
    ])
  })
})

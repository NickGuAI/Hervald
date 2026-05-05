import { aggregateCommanderWorldAgentSource } from '../agents/session/state.js'
import type { Automation } from '../automations/types.js'
import type { Operator } from '../operators/types.js'
import type {
  OrgChannelsByProvider,
  OrgCommanderRoleKey,
  OrgNode,
  OrgQuestsInFlight,
  OrgTree,
} from './types.js'

const CHANNEL_SURFACES = new Set(['whatsapp', 'telegram', 'discord'])
const ACTIVE_UI_CHAT_SURFACES = new Set(['ui', 'cli', 'api'])

function zeroChannels(): OrgChannelsByProvider {
  return {
    whatsapp: 0,
    telegram: 0,
    discord: 0,
  }
}

function zeroQuestsInFlight(): OrgQuestsInFlight {
  return {
    active: 0,
    pending: 0,
  }
}

export interface OrgCommanderRecord {
  id: string
  displayName: string
  operatorId: string
  state: string
  created: string
  roleKey?: OrgCommanderRoleKey
  templateId?: string | null
  replicatedFromCommanderId?: string | null
  activeWorkers?: number
  archived?: boolean
  archivedAt?: string
}

export interface OrgConversationRecord {
  surface?: string
  status?: string
  currentTask?: { issueUrl?: string | null } | null
  totalCostUsd?: number
  lastHeartbeat?: string | null
  lastMessageAt?: string
  createdAt?: string
}

export interface OrgQuestRecord {
  status: string
}

export interface BuildOrgTreeDependencies {
  operatorStore: {
    getFounder(): Promise<Operator | null>
  }
  commanderSessionStore: {
    list(): Promise<ReadonlyArray<OrgCommanderRecord>>
  }
  automationStore: {
    list(): Promise<ReadonlyArray<Automation>>
  }
  conversationStore: {
    listByCommander(commanderId: string): Promise<ReadonlyArray<OrgConversationRecord>>
  }
  questStore: {
    list(commanderId: string): Promise<ReadonlyArray<OrgQuestRecord>>
  }
  profileStore: {
    getAvatarUrl(commanderId: string): Promise<string | null>
  }
}

export class OrgOperatorNotFoundError extends Error {
  constructor() {
    super('Founder operator not found')
    this.name = 'OrgOperatorNotFoundError'
  }
}

function countChannels(conversations: ReadonlyArray<OrgConversationRecord>): OrgChannelsByProvider {
  return conversations.reduce<OrgChannelsByProvider>((channels, conversation) => {
    if (!conversation.surface || !CHANNEL_SURFACES.has(conversation.surface)) {
      return channels
    }

    channels[conversation.surface as keyof OrgChannelsByProvider] += 1
    return channels
  }, zeroChannels())
}

function countActiveUiChats(conversations: ReadonlyArray<OrgConversationRecord>): number {
  return conversations.filter((conversation) => (
    typeof conversation.surface === 'string'
      && ACTIVE_UI_CHAT_SURFACES.has(conversation.surface)
      && conversation.status === 'active'
  )).length
}

function countQuestsInFlight(quests: ReadonlyArray<OrgQuestRecord>): OrgQuestsInFlight {
  return quests.reduce<OrgQuestsInFlight>((summary, quest) => {
    if (quest.status === 'active') {
      summary.active += 1
    }
    if (quest.status === 'pending') {
      summary.pending += 1
    }
    return summary
  }, zeroQuestsInFlight())
}

function toAutomationNode(automation: Automation): OrgNode {
  return {
    id: automation.id,
    kind: 'automation',
    parentId: automation.parentCommanderId ?? automation.operatorId,
    displayName: automation.name,
    status: automation.status,
    costUsd: 0,
    recentActivityAt: null,
    templateId: automation.templateId ?? null,
    trigger: automation.trigger,
  }
}

export async function buildOrgTree({
  operatorStore,
  commanderSessionStore,
  automationStore,
  conversationStore,
  questStore,
  profileStore,
}: BuildOrgTreeDependencies): Promise<OrgTree> {
  const operator = await operatorStore.getFounder()
  if (!operator) {
    throw new OrgOperatorNotFoundError()
  }

  const [commanders, automations] = await Promise.all([
    commanderSessionStore.list(),
    automationStore.list(),
  ])

  const commanderNodes = await Promise.all(commanders.map(async (commander) => {
    let conversations: ReadonlyArray<OrgConversationRecord> = []
    try {
      conversations = await conversationStore.listByCommander(commander.id)
    } catch {
      conversations = []
    }

    const [quests, avatarUrl] = await Promise.all([
      questStore.list(commander.id),
      profileStore.getAvatarUrl(commander.id),
    ])

    const worldAgentSource = aggregateCommanderWorldAgentSource(conversations)
    const questsInFlight = countQuestsInFlight(quests)
    const activeUiChats = countActiveUiChats(conversations)
    return {
      id: commander.id,
      kind: 'commander',
      parentId: commander.operatorId,
      displayName: commander.displayName,
      roleKey: commander.roleKey,
      avatarUrl,
      status: commander.state,
      costUsd: worldAgentSource.totalCostUsd ?? 0,
      recentActivityAt: worldAgentSource.lastUpdatedAt ?? null,
      questsInFlight,
      channels: countChannels(conversations),
      activeUiChats,
      counts: {
        activeQuests: questsInFlight.active,
        activeWorkers: commander.activeWorkers ?? 0,
        activeChats: activeUiChats,
      },
      archived: commander.archived === true,
      archivedAt: commander.archivedAt,
      templateId: commander.templateId ?? null,
      replicatedFromCommanderId: commander.replicatedFromCommanderId ?? null,
    } satisfies OrgNode
  }))

  return {
    operator,
    orgIdentity: null,
    archivedCommandersCount: 0,
    commanders: commanderNodes,
    automations: automations.map((automation) => toAutomationNode(automation)),
  }
}

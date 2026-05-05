export type CommanderChannelProvider = 'whatsapp' | 'telegram' | 'discord'

export interface CommanderChannelBinding {
  id: string
  commanderId: string
  provider: CommanderChannelProvider
  accountId: string
  displayName: string
  enabled: boolean
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

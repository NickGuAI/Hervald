import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'

export function orderMobileConversations(
  conversations: readonly ConversationRecord[],
): ConversationRecord[] {
  return [...conversations].sort((left, right) => {
    const createdDelta = Date.parse(left.createdAt) - Date.parse(right.createdAt)
    if (Number.isFinite(createdDelta) && createdDelta !== 0) {
      return createdDelta
    }

    return left.id.localeCompare(right.id)
  })
}

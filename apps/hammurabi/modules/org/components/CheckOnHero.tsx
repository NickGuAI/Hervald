import { useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  ACTIVE_CONVERSATION_FETCH_STALE_MS,
  commanderActiveConversationQueryKey,
  fetchCommanderActiveConversation,
} from '@modules/conversation/hooks/use-conversations'
import type { OrgNode } from '../types'

export function CheckOnHero({
  commander,
}: {
  commander: OrgNode
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const handleClick = async () => {
    let activeConversationId: string | null = null
    try {
      const activeConversation = await queryClient.fetchQuery({
        queryKey: commanderActiveConversationQueryKey(commander.id),
        queryFn: () => fetchCommanderActiveConversation(commander.id),
        staleTime: ACTIVE_CONVERSATION_FETCH_STALE_MS,
      })
      activeConversationId = activeConversation?.id ?? null
    } catch {
      activeConversationId = null
    }

    const params = new URLSearchParams({ commander: commander.id })
    if (activeConversationId) {
      params.set('conversation', activeConversationId)
    }
    navigate(`/command-room?${params.toString()}`)
  }

  return (
    <button
      type="button"
      data-testid="commander-check-on-hero"
      data-commander-id={commander.id}
      onClick={() => {
        void handleClick()
      }}
      className="card-sumi flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-ink-wash"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-wash text-sumi-black">
          <MessageSquare size={16} aria-hidden="true" />
        </span>
        <span className="truncate text-lg font-medium text-sumi-black">
          Check On {commander.displayName}
        </span>
      </span>
    </button>
  )
}

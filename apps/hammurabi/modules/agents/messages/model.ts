import type { AskQuestion } from '@/types'

export const MAX_CLIENT_MESSAGES = 500
export const SUBAGENT_WORKING_LABEL = 'subagent working…'
export type PlanningAction = 'enter' | 'proposed' | 'decision'

export interface MsgItem {
  id: string
  kind: 'system' | 'user' | 'thinking' | 'agent' | 'tool' | 'ask' | 'planning'
  text: string
  timestamp?: string
  children?: MsgItem[]
  images?: { mediaType: string; data: string }[]
  toolId?: string
  toolName?: string
  toolFile?: string
  toolStatus?: 'running' | 'success' | 'error'
  toolInput?: string
  toolOutput?: string
  subagentDescription?: string
  oldString?: string
  newString?: string
  askQuestions?: AskQuestion[]
  askAnswered?: boolean
  askSubmitting?: boolean
  planningAction?: PlanningAction
  planningPlan?: string
  planningApproved?: boolean | null
  planningMessage?: string
}

export function capMessages(msgs: MsgItem[]): MsgItem[] {
  return msgs.length > MAX_CLIENT_MESSAGES ? msgs.slice(-MAX_CLIENT_MESSAGES) : msgs
}

export function createUserMessage(
  id: string,
  text: string,
  images?: { mediaType: string; data: string }[],
): MsgItem {
  return {
    id,
    kind: 'user',
    text,
    images: images && images.length > 0 ? images : undefined,
  }
}

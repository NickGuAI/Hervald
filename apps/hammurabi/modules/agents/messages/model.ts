import type { AskQuestion } from '@/types'
import type { TranscriptEnvelopeSource } from '../../../src/types/transcript-envelope.js'

export const MAX_CLIENT_MESSAGES = 500
export const SUBAGENT_WORKING_LABEL = 'subagent working…'
export type PlanningAction = 'enter' | 'proposed' | 'decision'
export type AskInteractionKind = 'ask_user_question' | 'plan_approval'

export interface TranscriptMessageMeta {
  envelopeId?: string
  time?: string
  source?: TranscriptEnvelopeSource
  turnId?: string
  itemId?: string
  parentId?: string
  subagentId?: string
  providerEventType?: string
  providerEventId?: string
  providerPayload?: unknown
}

export interface MessageImageAttachment {
  mediaType?: string
  data?: string
  url?: string
  alt?: string
}

export interface MsgItem {
  id: string
  kind: 'system' | 'user' | 'thinking' | 'agent' | 'tool' | 'ask' | 'planning' | 'provider'
  text: string
  timestamp?: string
  children?: MsgItem[]
  images?: MessageImageAttachment[]
  transcript?: TranscriptMessageMeta
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
  askInteractionKind?: AskInteractionKind
  askAnswered?: boolean
  askSubmitting?: boolean
  planningAction?: PlanningAction
  planningPlan?: string
  planningApproved?: boolean | null
  planningMessage?: string
  planApprovalPlan?: string
  planApprovalApproveLabel?: string
  planApprovalRejectLabel?: string
  planApprovalCustomResponseLabel?: string
}

export function capMessages(msgs: MsgItem[]): MsgItem[] {
  return msgs.length > MAX_CLIENT_MESSAGES ? msgs.slice(-MAX_CLIENT_MESSAGES) : msgs
}

export function createUserMessage(
  id: string,
  text: string,
  images?: MessageImageAttachment[],
): MsgItem {
  return {
    id,
    kind: 'user',
    text,
    images: images && images.length > 0 ? images : undefined,
  }
}

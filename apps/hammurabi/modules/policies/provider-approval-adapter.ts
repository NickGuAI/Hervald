import type { StreamSession } from '../agents/types.js'
import type {
  ActionPolicyGate,
  ActionPolicyGateRequest,
  ActionPolicyGateResult,
} from './action-policy-gate.js'

export interface ProviderApprovalAdapter<RawEvent, RawReply> {
  readonly source: string
  toUnifiedRequest(rawEvent: RawEvent, session: StreamSession): ActionPolicyGateRequest
  sendReply(
    result: ActionPolicyGateResult,
    rawEvent: RawEvent,
    session: StreamSession,
  ): Promise<RawReply> | RawReply
  emitTranscriptEvent?(
    kind: 'enqueued' | 'resolved',
    request: ActionPolicyGateRequest,
    result: ActionPolicyGateResult | undefined,
    session: StreamSession,
  ): void
}

export async function handleProviderApproval<RawEvent, RawReply>(
  adapter: ProviderApprovalAdapter<RawEvent, RawReply>,
  rawEvent: RawEvent,
  session: StreamSession,
  deps: { actionPolicyGate: ActionPolicyGate },
): Promise<void> {
  const request = adapter.toUnifiedRequest(rawEvent, session)
  adapter.emitTranscriptEvent?.('enqueued', request, undefined, session)
  const result = await deps.actionPolicyGate.enforceAndWait(request)
  adapter.emitTranscriptEvent?.('resolved', request, result, session)
  await adapter.sendReply(result, rawEvent, session)
}

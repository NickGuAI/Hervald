import type { SessionQueueSnapshot } from '@/types'
import type { MsgItem } from '@modules/agents/messages/model'

export function mapSessionMessagesToTranscript(messages: MsgItem[]): MsgItem[] {
  return messages
}

export function appendQueuedMessagesToTranscript(
  messages: MsgItem[],
  _queueSnapshot?: SessionQueueSnapshot | null,
): MsgItem[] {
  return messages
}

function messageSignature(message: MsgItem): string {
  return JSON.stringify({
    kind: message.kind,
    text: message.text,
    toolId: message.toolId ?? null,
    toolName: message.toolName ?? null,
    toolStatus: message.toolStatus ?? null,
    toolInput: message.toolInput ?? null,
    toolOutput: message.toolOutput ?? null,
    images: message.images ?? null,
    planningAction: message.planningAction ?? null,
    planningPlan: message.planningPlan ?? null,
    planningMessage: message.planningMessage ?? null,
  })
}

function transcriptIdentityKey(message: MsgItem): string | null {
  const transcript = message.transcript
  const itemId = transcript?.itemId
  if (!itemId) {
    return null
  }

  return JSON.stringify({
    kind: message.kind,
    provider: transcript.source?.provider ?? null,
    backend: transcript.source?.backend ?? null,
    sessionId: transcript.source?.sessionId ?? null,
    turnId: transcript.turnId ?? null,
    itemId,
    parentId: transcript.parentId ?? null,
    subagentId: transcript.subagentId ?? null,
  })
}

const TEXT_OVERLAP_SEARCH_WINDOW = 8
const TEXT_OVERLAP_MIN_LENGTH = 80

function comparableText(message: MsgItem): string {
  return message.text.replace(/\s+/gu, ' ').trim()
}

function canUseTextOverlap(message: MsgItem): boolean {
  return (
    message.kind === 'agent'
    && !message.toolId
    && !message.toolName
    && !message.toolInput
    && !message.toolOutput
    && !message.images?.length
    && !message.children?.length
  )
}

function textContainmentRedundancy(
  historicalMessage: MsgItem,
  liveMessage: MsgItem,
): 'historical' | 'live' | null {
  if (!canUseTextOverlap(historicalMessage) || !canUseTextOverlap(liveMessage)) {
    return null
  }

  const historicalText = comparableText(historicalMessage)
  const liveText = comparableText(liveMessage)
  const shorterLength = Math.min(historicalText.length, liveText.length)
  if (shorterLength < TEXT_OVERLAP_MIN_LENGTH) {
    return null
  }

  if (historicalText === liveText) {
    return 'historical'
  }
  if (historicalText.includes(liveText)) {
    return 'live'
  }
  if (liveText.includes(historicalText)) {
    return 'historical'
  }
  return null
}

function chooseFullerMessage(left: MsgItem, right: MsgItem): MsgItem {
  const leftText = comparableText(left)
  const rightText = comparableText(right)
  if (leftText.includes(rightText) && leftText.length >= rightText.length) {
    return left
  }
  if (rightText.includes(leftText) && rightText.length >= leftText.length) {
    return right
  }
  return rightText.length > leftText.length ? right : left
}

function mergeTranscriptIdentityAndBoundaryOverlap(
  historicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): MsgItem[] {
  const mergedHistorical = [...historicalMessages]
  const remainingLive: MsgItem[] = []

  for (const liveMessage of liveMessages) {
    const identityKey = transcriptIdentityKey(liveMessage)
    if (identityKey) {
      const matchingIndex = mergedHistorical.findIndex((historicalMessage) =>
        transcriptIdentityKey(historicalMessage) === identityKey,
      )
      if (matchingIndex !== -1) {
        mergedHistorical[matchingIndex] = chooseFullerMessage(
          mergedHistorical[matchingIndex],
          liveMessage,
        )
        continue
      }
    }

    const searchStart = Math.max(0, mergedHistorical.length - TEXT_OVERLAP_SEARCH_WINDOW)
    let overlapIndex = -1
    let redundancy: 'historical' | 'live' | null = null
    for (let index = mergedHistorical.length - 1; index >= searchStart; index -= 1) {
      redundancy = textContainmentRedundancy(mergedHistorical[index], liveMessage)
      if (redundancy) {
        overlapIndex = index
        break
      }
    }

    if (overlapIndex !== -1) {
      if (redundancy === 'historical') {
        mergedHistorical[overlapIndex] = chooseFullerMessage(
          mergedHistorical[overlapIndex],
          liveMessage,
        )
      }
      continue
    }

    remainingLive.push(liveMessage)
  }

  return [
    ...mergedHistorical,
    ...remainingLive,
  ]
}

export function mergeHistoricalAndLiveTranscript(
  historicalMessages: MsgItem[],
  liveMessages: MsgItem[],
): MsgItem[] {
  if (historicalMessages.length === 0) {
    return liveMessages
  }
  if (liveMessages.length === 0) {
    return historicalMessages
  }

  const liveSignatureCounts = new Map<string, number>()
  for (const message of liveMessages) {
    const signature = messageSignature(message)
    liveSignatureCounts.set(signature, (liveSignatureCounts.get(signature) ?? 0) + 1)
  }

  const historicalWithoutReplay: MsgItem[] = []
  for (let index = historicalMessages.length - 1; index >= 0; index -= 1) {
    const message = historicalMessages[index]
    const signature = messageSignature(message)
    const replayCount = liveSignatureCounts.get(signature) ?? 0
    if (replayCount > 0) {
      liveSignatureCounts.set(signature, replayCount - 1)
      continue
    }
    historicalWithoutReplay.push(message)
  }

  return mergeTranscriptIdentityAndBoundaryOverlap(
    historicalWithoutReplay.reverse(),
    liveMessages,
  )
}

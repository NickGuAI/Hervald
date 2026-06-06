import type { MsgItem } from '../../messages/model'

export type RenderItem =
  | { type: 'single'; msg: MsgItem }
  | { type: 'activity-group'; id: string; messages: MsgItem[] }

function isOperationalActivity(message: MsgItem): boolean {
  return message.kind === 'tool'
    || message.kind === 'provider'
    || message.kind === 'thinking'
}

export function groupMessages(messages: MsgItem[]): RenderItem[] {
  const result: RenderItem[] = []
  let activityBuffer: MsgItem[] = []

  function flushActivity() {
    if (activityBuffer.length === 0) {
      return
    }
    result.push({
      type: 'activity-group',
      id: `ag-${activityBuffer[0].id}`,
      messages: activityBuffer,
    })
    activityBuffer = []
  }

  for (const message of messages) {
    if (isOperationalActivity(message)) {
      activityBuffer.push(message)
    } else {
      flushActivity()
      result.push({ type: 'single', msg: message })
    }
  }

  flushActivity()
  return result
}

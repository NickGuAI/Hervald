import type { MsgItem } from '../../messages/model'

export type RenderItem =
  | { type: 'single'; msg: MsgItem }
  | { type: 'tool-group'; id: string; tools: MsgItem[] }

function isGenericGroupedTool(message: MsgItem): boolean {
  return message.kind === 'tool' && message.toolName !== 'Agent'
}

export function groupMessages(messages: MsgItem[]): RenderItem[] {
  const result: RenderItem[] = []
  let toolBuffer: MsgItem[] = []

  function flushTools() {
    if (toolBuffer.length === 0) {
      return
    }
    if (toolBuffer.length === 1) {
      result.push({ type: 'single', msg: toolBuffer[0] })
    } else {
      result.push({ type: 'tool-group', id: `tg-${toolBuffer[0].id}`, tools: toolBuffer })
    }
    toolBuffer = []
  }

  for (const message of messages) {
    if (isGenericGroupedTool(message)) {
      toolBuffer.push(message)
    } else {
      flushTools()
      result.push({ type: 'single', msg: message })
    }
  }

  flushTools()
  return result
}

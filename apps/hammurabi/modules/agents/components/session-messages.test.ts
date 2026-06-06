import { describe, expect, it } from 'vitest'
import { createUserMessage, groupMessages, type MsgItem } from './session-messages'

function makeTool(id: string, toolName: string): MsgItem {
  return {
    id,
    kind: 'tool',
    text: '',
    toolId: `tool-${id}`,
    toolName,
    toolStatus: 'running',
    toolInput: '',
  }
}

describe('groupMessages', () => {
  it('collapses operational activity into one activity group', () => {
    const messages: MsgItem[] = [
      makeTool('read', 'Read'),
      makeTool('bash', 'Bash'),
      makeTool('agent', 'Agent'),
      makeTool('edit', 'Edit'),
      makeTool('grep', 'Grep'),
    ]

    expect(groupMessages(messages)).toEqual([
      {
        type: 'activity-group',
        id: 'ag-read',
        messages,
      },
    ])
  })
})

describe('createUserMessage', () => {
  it('drops empty image arrays from local user messages', () => {
    expect(createUserMessage('user-1', 'queued prompt', [])).toEqual({
      id: 'user-1',
      kind: 'user',
      text: 'queued prompt',
    })
  })

  it('preserves image attachments when present', () => {
    expect(createUserMessage('user-2', '[image]', [{ mediaType: 'image/png', data: 'abc123' }])).toEqual({
      id: 'user-2',
      kind: 'user',
      text: '[image]',
      images: [{ mediaType: 'image/png', data: 'abc123' }],
    })
  })
})

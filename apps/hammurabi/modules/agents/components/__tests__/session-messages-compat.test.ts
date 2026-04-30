import { describe, expect, it } from 'vitest'
import {
  SUBAGENT_WORKING_LABEL,
  extractToolDetails,
  formatToolDisplayName,
  groupMessages,
  type MsgItem,
} from '../session-messages'

describe('session-messages compatibility facade', () => {
  it('re-exports the message helpers used by the agents UI', () => {
    expect(SUBAGENT_WORKING_LABEL).toBe('subagent working…')
    expect(formatToolDisplayName('mcp__tavily__tavily_search')).toEqual({
      displayName: 'Tavily Search',
      service: 'tavily',
    })
    expect(extractToolDetails('Bash', { command: 'pwd' }).toolInput).toBe('pwd')

    const messages: MsgItem[] = [
      {
        id: 'tool-1',
        kind: 'tool',
        text: '',
        toolId: 'tool-1',
        toolName: 'Read',
        toolStatus: 'running',
        toolInput: '',
      },
      {
        id: 'tool-2',
        kind: 'tool',
        text: '',
        toolId: 'tool-2',
        toolName: 'Bash',
        toolStatus: 'running',
        toolInput: '',
      },
    ]

    expect(groupMessages(messages)).toEqual([
      {
        type: 'tool-group',
        id: 'tg-tool-1',
        tools: messages,
      },
    ])
  })
})

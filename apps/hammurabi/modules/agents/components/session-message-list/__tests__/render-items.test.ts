import { describe, expect, it } from 'vitest'
import type { MsgItem } from '../../../messages/model'
import { groupMessages } from '../render-items'

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

function makeProvider(id: string, eventType: string): MsgItem {
  return {
    id,
    kind: 'provider',
    text: `codex raw: ${eventType}`,
    transcript: {
      source: { provider: 'codex', backend: 'rpc' },
      providerEventType: eventType,
    },
  }
}

describe('groupMessages', () => {
  it('collapses operational activity into one provider-agnostic group', () => {
    const messages: MsgItem[] = [
      { id: 'user-1', kind: 'user', text: 'Investigate this.' },
      makeTool('read', 'Read'),
      makeTool('agent', 'Agent'),
      makeProvider('token-1', 'thread/tokenUsage/updated'),
      makeTool('edit', 'Edit'),
      { id: 'agent-1', kind: 'agent', text: 'Done.' },
    ]

    expect(groupMessages(messages)).toEqual([
      {
        type: 'single',
        msg: messages[0],
      },
      {
        type: 'activity-group',
        id: 'ag-read',
        messages: [messages[1], messages[2], messages[3], messages[4]],
      },
      {
        type: 'single',
        msg: messages[5],
      },
    ])
  })

  it('keeps assistant text as the boundary between main-agent activity groups', () => {
    const messages: MsgItem[] = [
      makeProvider('token-1', 'thread/tokenUsage/updated'),
      makeProvider('delta-1', 'item/agentMessage/delta'),
      { id: 'agent-1', kind: 'agent', text: 'Done.' },
      makeProvider('token-2', 'thread/tokenUsage/updated'),
      makeProvider('status-1', 'thread/status/changed'),
    ]

    expect(groupMessages(messages)).toEqual([
      {
        type: 'activity-group',
        id: 'ag-token-1',
        messages: [messages[0], messages[1]],
      },
      {
        type: 'single',
        msg: messages[2],
      },
      {
        type: 'activity-group',
        id: 'ag-token-2',
        messages: [messages[3], messages[4]],
      },
    ])
  })
})

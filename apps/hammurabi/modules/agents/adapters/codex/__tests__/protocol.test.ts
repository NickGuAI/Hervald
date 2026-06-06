import { describe, expect, it } from 'vitest'
import { parseCodexProtocolPayload } from '../protocol'
import {
  getCodexApprovalRequestDetails,
  isCodexMcpElicitationMethod,
} from '../helpers'

describe('codex protocol routing helpers', () => {
  it('extracts nested thread identifiers defensively', () => {
    expect(parseCodexProtocolPayload(JSON.stringify({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: {
        thread: { id: 'thread-from-thread' },
      },
    }))).toEqual(expect.objectContaining({
      method: 'thread/started',
      threadId: 'thread-from-thread',
      threadIds: ['thread-from-thread'],
    }))

    expect(parseCodexProtocolPayload(JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/started',
      params: {
        turn: { id: 'turn-1', threadId: 'thread-from-turn' },
      },
    }))).toEqual(expect.objectContaining({
      threadId: 'thread-from-turn',
      threadIds: ['thread-from-turn'],
    }))

    expect(parseCodexProtocolPayload(JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        item: { id: 'item-1', threadId: 'thread-from-item' },
      },
    }))).toEqual(expect.objectContaining({
      threadId: 'thread-from-item',
      threadIds: ['thread-from-item'],
    }))

    expect(parseCodexProtocolPayload(JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/commandExecution/requestApproval',
      params: {
        conversationId: 'thread-from-conversation',
      },
    }))).toEqual(expect.objectContaining({
      threadId: 'thread-from-conversation',
      threadIds: ['thread-from-conversation'],
    }))
  })

  it('accepts both Codex MCP elicitation spellings and nested approval thread ids', () => {
    expect(isCodexMcpElicitationMethod('mcpserver/elicitation/request')).toBe(true)
    expect(isCodexMcpElicitationMethod('mcpServer/elicitation/request')).toBe(true)

    expect(getCodexApprovalRequestDetails({
      conversationId: 'thread-legacy',
      turn: { threadId: 'thread-turn' },
      item: { threadId: 'thread-item' },
      itemId: 'item-9',
      turnId: 'turn-9',
    })).toEqual({
      threadId: 'thread-legacy',
      itemId: 'item-9',
      turnId: 'turn-9',
      cwd: undefined,
      reason: undefined,
      risk: undefined,
      permissions: undefined,
    })
  })
})

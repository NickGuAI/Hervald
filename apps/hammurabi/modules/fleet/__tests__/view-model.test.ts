import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '@/types'
import {
  buildFleetActivitySlots,
  buildFleetViewModel,
  FLEET_TIMELINE_SLOT_COUNT,
  type FleetAgentSession,
  type FleetApproval,
  type FleetCommander,
  type FleetWorldAgent,
} from '../view-model'

const NOW_MS = Date.parse('2026-04-20T12:30:00.000Z')

describe('buildFleetViewModel', () => {
  it('groups commander lanes with nested worker depth and approval rollups', () => {
    const commanders: FleetCommander[] = [
      {
        id: 'alpha',
        host: 'workshop-mac',
        displayName: 'Test Commander',
        state: 'running',
        totalCostUsd: 12.4,
        currentTask: {
          issueNumber: 1032,
          title: 'Polish fleet',
        },
      },
      {
        id: 'beta',
        host: 'Test Operator',
        displayName: 'Test Operator',
        state: 'stopped',
        totalCostUsd: 2.1,
      },
    ]

    const sessions: FleetAgentSession[] = [
      {
        name: 'commander-alpha',
        created: '2026-04-20T12:00:00.000Z',
        sessionType: 'commander',
        transportType: 'stream',
        status: 'active',
      },
      {
        name: 'writer',
        created: '2026-04-20T12:10:00.000Z',
        sessionType: 'worker',
        transportType: 'stream',
        status: 'active',
        spawnedBy: 'commander-alpha',
      },
      {
        name: 'editor',
        created: '2026-04-20T12:12:00.000Z',
        sessionType: 'worker',
        transportType: 'stream',
        status: 'idle',
        spawnedBy: 'writer',
      },
    ]

    const worldAgents: FleetWorldAgent[] = [
      {
        id: 'commander-alpha',
        status: 'active',
        phase: 'thinking',
        lastUpdatedAt: '2026-04-20T12:29:00.000Z',
        usage: { costUsd: 1.25 },
      },
      {
        id: 'writer',
        status: 'active',
        phase: 'tool_use',
        lastUpdatedAt: '2026-04-20T12:28:00.000Z',
        lastToolUse: 'rg',
        usage: { costUsd: 0.72 },
      },
      {
        id: 'editor',
        status: 'idle',
        phase: 'idle',
        lastUpdatedAt: '2026-04-20T12:20:00.000Z',
        usage: { costUsd: 0.14 },
      },
    ]

    const approvals: FleetApproval[] = [
      { id: 'a1', commanderId: 'alpha', sessionName: null },
      { id: 'a2', commanderId: 'alpha', sessionName: 'editor' },
    ]

    const commanderEvent: StreamEvent = {
      type: 'assistant',
      message: {
        id: 'msg-alpha',
        role: 'assistant',
        content: [{ type: 'text', text: 'Working' }],
      },
    }
    const writerEvent: StreamEvent = {
      type: 'tool_use',
      id: 'tool-writer',
      name: 'Bash',
      input: { command: 'rg fleet' },
    }

    const view = buildFleetViewModel({
      commanders,
      sessions,
      worldAgents,
      approvals,
      streams: {
        'commander-alpha': { status: 'connected', events: [commanderEvent] },
        writer: { status: 'connected', events: [writerEvent] },
      },
      nowMs: NOW_MS,
      windowMinutes: 30,
    })

    expect(view.groups).toHaveLength(2)

    const alpha = view.groups[0]
    expect(alpha.commanderId).toBe('alpha')
    expect(alpha.rows.map((row) => row.sessionName)).toEqual(['commander-alpha', 'writer', 'editor'])
    expect(alpha.rows.map((row) => row.depth)).toEqual([0, 1, 2])
    expect(alpha.rows[0].pendingApprovalCount).toBe(1)
    expect(alpha.rows[2].pendingApprovalCount).toBe(1)
    expect(alpha.approvalCount).toBe(2)
    expect(alpha.rows[1].caption).toBe('rg')

    const beta = view.groups[1]
    expect(beta.commanderId).toBe('beta')
    expect(beta.rows).toHaveLength(1)
    expect(beta.rows[0].statusTone).toBe('stale')
  })
})

describe('buildFleetActivitySlots', () => {
  it('uses event timestamps and live phase fallback for the timeline window', () => {
    const assistantEvent: StreamEvent = {
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli', normalizedAt: '2026-04-20T12:25:00.000Z' },
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Thinking' }],
      },
    }
    const toolEvent: StreamEvent = {
      type: 'tool_use',
      source: { provider: 'codex', backend: 'rpc', normalizedAt: '2026-04-20T12:29:00.000Z' },
      id: 'tool-1',
      name: 'Bash',
      input: { command: 'ls' },
    }

    const slots = buildFleetActivitySlots({
      events: [assistantEvent, toolEvent],
      anchorAt: '2026-04-20T12:29:00.000Z',
      nowMs: NOW_MS,
      windowMinutes: 30,
      slotCount: FLEET_TIMELINE_SLOT_COUNT,
      phase: 'tool_use',
      status: 'active',
      pendingApprovalCount: 0,
    })

    expect(slots.at(-1)).toBe('tool')
    expect(slots.some((slot) => slot === 'active')).toBe(true)
  })
})

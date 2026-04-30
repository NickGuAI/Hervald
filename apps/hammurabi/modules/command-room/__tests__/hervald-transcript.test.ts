import { describe, expect, it } from 'vitest'
import { mapSessionMessagesToTranscript } from '../../../src/surfaces/hervald/transcript'

describe('mapSessionMessagesToTranscript', () => {
  it('preserves the rich MsgItem transcript shape for Hervald rendering parity', () => {
    const messages = [
      {
        id: 'user-1',
        kind: 'user',
        text: 'Brief the fleet',
        timestamp: '2026-04-19T12:00:00.000Z',
      },
      {
        id: 'agent-1',
        kind: 'agent',
        text: 'Fleet brief ready.',
      },
      {
        id: 'tool-1',
        kind: 'tool',
        text: 'Bash',
      },
      {
        id: 'plan-1',
        kind: 'planning',
        text: '1. Inspect\n2. Report',
      },
    ]

    expect(mapSessionMessagesToTranscript(messages)).toEqual(messages)
  })
})

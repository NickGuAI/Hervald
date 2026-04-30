import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '@/lib/api'
import {
  createSession,
  killSession,
  triggerPreKillDebrief,
  getDebriefStatus,
  sendSessionMessage,
} from '@/hooks/use-agents'

vi.mock('@/lib/api', () => ({
  fetchJson: vi.fn(),
}))

describe('killSession', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  it('sends DELETE without query params', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ killed: true })

    await expect(killSession('claude-alpha')).resolves.toEqual({ killed: true })

    expect(fetchJson).toHaveBeenCalledWith('/api/agents/sessions/claude-alpha', {
      method: 'DELETE',
    })
  })
})

describe('createSession', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  it('posts resumeFromSession when creating a resumed session', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      sessionName: 'claude-resumed',
      mode: 'default',
      sessionType: 'stream',
      created: true,
    })

    await expect(createSession({
      name: 'claude-resumed',
      mode: 'default',
      sessionType: 'stream',
      resumeFromSession: 'claude-original',
    })).resolves.toEqual({
      sessionName: 'claude-resumed',
      mode: 'default',
      sessionType: 'stream',
      created: true,
    })

    expect(fetchJson).toHaveBeenCalledWith('/api/agents/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'claude-resumed',
        mode: 'default',
        sessionType: 'stream',
        resumeFromSession: 'claude-original',
        transportType: 'stream',
      }),
    })
  })

  it('posts adaptiveThinking when explicitly provided', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      sessionName: 'claude-adaptive-disabled',
      mode: 'default',
      sessionType: 'stream',
      created: true,
    })

    await expect(createSession({
      name: 'claude-adaptive-disabled',
      mode: 'default',
      sessionType: 'stream',
      adaptiveThinking: 'disabled',
    })).resolves.toEqual({
      sessionName: 'claude-adaptive-disabled',
      mode: 'default',
      sessionType: 'stream',
      created: true,
    })

    expect(fetchJson).toHaveBeenCalledWith('/api/agents/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'claude-adaptive-disabled',
        mode: 'default',
        sessionType: 'stream',
        adaptiveThinking: 'disabled',
        transportType: 'stream',
      }),
    })
  })
})

describe('triggerPreKillDebrief', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  it('posts to pre-kill-debrief endpoint', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ debriefStarted: true, timeoutMs: 60000 })

    await expect(triggerPreKillDebrief('stream-session')).resolves.toEqual({
      debriefStarted: true,
      timeoutMs: 60000,
    })

    expect(fetchJson).toHaveBeenCalledWith('/api/agents/sessions/stream-session/pre-kill-debrief', {
      method: 'POST',
    })
  })
})

describe('sendSessionMessage', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  it('posts text to the session message endpoint', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ sent: true, queued: false, id: 'msg-1' })

    await expect(sendSessionMessage('commander-alpha', 'Ship it')).resolves.toEqual({
      sent: true,
      queued: false,
      id: 'msg-1',
    })

    expect(fetchJson).toHaveBeenCalledWith('/api/agents/sessions/commander-alpha/message', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'Ship it' }),
    })
  })
})

describe('getDebriefStatus', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  it('fetches debrief-status endpoint', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ status: 'completed' })

    await expect(getDebriefStatus('stream-session')).resolves.toEqual({ status: 'completed' })

    expect(fetchJson).toHaveBeenCalledWith('/api/agents/sessions/stream-session/debrief-status')
  })
})

import { useMemo } from 'react'
import { workerLifecycle } from '@gehirn/hammurabi-cli/session-contract'
import { useAgentSessions } from '@/hooks/use-agents'

export interface SessionLifecycleCounts {
  running: number
  stale: number
  exited: number
}

export function useSessionLifecycleCounts(): SessionLifecycleCounts {
  const { data: sessions = [] } = useAgentSessions()

  return useMemo(() => {
    let running = 0
    let stale = 0
    let exited = 0

    for (const session of sessions) {
      const lifecycle = workerLifecycle({
        status: session.status,
        processAlive: session.processAlive,
      })
      if (lifecycle === 'running') running += 1
      if (lifecycle === 'stale') stale += 1
      if (lifecycle === 'exited') exited += 1
    }

    return { running, stale, exited }
  }, [sessions])
}

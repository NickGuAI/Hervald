import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWorldState, type WorldAgent } from './use-world-state'
import { OverworldScreen } from './screens/OverworldScreen'
import { PartyScreen } from './screens/PartyScreen'
import { QuestsScreen } from './screens/QuestsScreen'

type RpgScreen = 'overworld' | 'party' | 'quests'

const SCREENS: RpgScreen[] = ['overworld', 'party', 'quests']

const SCREEN_LABELS: Record<RpgScreen, string> = {
  overworld: 'Overworld',
  party: 'Party',
  quests: 'Quests',
}

function normalizeScreen(raw: string | null): RpgScreen {
  if (raw && SCREENS.includes(raw as RpgScreen)) {
    return raw as RpgScreen
  }
  return 'overworld'
}

function formatScreenStatus(isLoading: boolean, isFetching: boolean, isError: boolean): 'live' | 'syncing' | 'offline' {
  if (isError) {
    return 'offline'
  }
  if (isLoading || isFetching) {
    return 'syncing'
  }
  return 'live'
}

export default function RpgScreenRouter() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawScreen = searchParams.get('screen')
  const screen = normalizeScreen(rawScreen)

  const {
    data: agents = [],
    isLoading,
    isFetching,
    isError,
    error,
  } = useWorldState()

  useEffect(() => {
    if (rawScreen !== screen) {
      const next = new URLSearchParams(searchParams)
      next.set('screen', screen)
      setSearchParams(next, { replace: true })
    }
  }, [rawScreen, screen, searchParams, setSearchParams])

  const worldStatus = formatScreenStatus(isLoading, isFetching, isError)
  const worldError = isError
    ? (error instanceof Error ? error.message : 'Failed to load world state')
    : undefined

  const screenNode = useMemo(() => {
    switch (screen) {
      case 'party':
        return <PartyScreen agents={agents} />
      case 'quests':
        return <QuestsScreen agents={agents} />
      default:
        return (
          <OverworldScreen
            agents={agents}
            worldStatus={worldStatus}
            worldError={worldError}
          />
        )
    }
  }, [agents, screen, worldError, worldStatus])

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
      {screenNode}

      <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-3">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-md border border-white/20 bg-black/60 p-1 backdrop-blur-[2px]">
          {SCREENS.map((name) => {
            const selected = name === screen
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.set('screen', name)
                  setSearchParams(next)
                }}
                className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition ${selected
                  ? 'bg-emerald-300/20 text-emerald-100'
                  : 'bg-black/40 text-white/70 hover:text-white'}`}
              >
                {SCREEN_LABELS[name]}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export type { WorldAgent }

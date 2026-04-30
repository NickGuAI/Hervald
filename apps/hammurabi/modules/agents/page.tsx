import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import {
  createSession,
  getDebriefStatus,
  killSession,
  resumeSession as resumeAgentSession,
  triggerPreKillDebrief,
  useAgentSessions,
  useMachines,
} from '@/hooks/use-agents'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-is-mobile'
import type { AgentType, SessionTransportType } from '@/types'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../claude-effort.js'
import { NewSessionForm } from './components/NewSessionForm'
import { DEFAULT_SESSION_TAB, filterSessionsByTab, SESSION_TABS, type SessionTab } from './session-tab'
import { MobileSessionView } from './page-shell/MobileSessionView'
import { SessionCard } from './page-shell/SessionCard'
import {
  formatError,
  isNotFoundRequestFailure,
  shouldAttemptDebriefOnKill,
  type AgentSessionWithWorkers,
} from './page-shell/session-helpers'
import { TerminalView } from './page-shell/TerminalView'

export default function AgentsPage() {
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: sessions, isLoading, isFetching } = useAgentSessions()
  const { data: machines } = useMachines()
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [showNewSessionForm, setShowNewSessionForm] = useState(false)
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [effort, setEffort] = useState<ClaudeEffortLevel>(DEFAULT_CLAUDE_EFFORT_LEVEL)
  const [adaptiveThinking, setAdaptiveThinking] = useState<ClaudeAdaptiveThinkingMode>(
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const [cwd, setCwd] = useState('')
  const [resumeFromSession, setResumeFromSession] = useState('')
  const [agentType, setAgentType] = useState<AgentType>('claude')
  const [transportType, setTransportType] = useState<Exclude<SessionTransportType, 'external'>>('stream')
  const [selectedHost, setSelectedHost] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionTab, setSessionTab] = useState<SessionTab>(DEFAULT_SESSION_TAB)

  const machineList = machines ?? []
  const sessionList = (sessions ?? []) as AgentSessionWithWorkers[]
  const machineMap = new Map(machineList.map((machine) => [machine.id, machine]))
  const resumableSessions = sessionList
    .filter((session) => session.resumeAvailable)
    .sort((left, right) => Date.parse(right.created) - Date.parse(left.created))
  const resumeSource = resumableSessions.find((session) => session.name === resumeFromSession) ?? null

  useEffect(() => {
    const paramCwd = searchParams.get('cwd')
    const paramName = searchParams.get('name')
    const paramSession = searchParams.get('session')
    const paramAgentType = searchParams.get('agentType')
    if (paramCwd || paramName || paramSession || paramAgentType) {
      if (paramCwd) setCwd(paramCwd)
      if (paramName) setName(paramName)
      if (paramSession) setSelectedSession(paramSession)
      if (paramAgentType === 'codex' || paramAgentType === 'claude' || paramAgentType === 'gemini') {
        setAgentType(paramAgentType)
      }
      if (paramCwd || paramName) setShowNewSessionForm(true)
      if (paramSession) {
        void queryClient.invalidateQueries({ queryKey: ['agents', 'sessions'] })
      }
      setSearchParams({}, { replace: true })
    }
  }, [queryClient, searchParams, setSearchParams])

  useEffect(() => {
    if (!selectedSession) {
      return
    }
    if (isLoading) {
      return
    }

    const stillExists = sessionList.some((session) => session.name === selectedSession)
    if (stillExists) {
      return
    }
    setSelectedSession(null)
  }, [isFetching, isLoading, selectedSession, sessionList])

  useEffect(() => {
    if (!resumeFromSession) {
      return
    }
    if (resumableSessions.some((session) => session.name === resumeFromSession)) {
      return
    }
    setResumeFromSession('')
  }, [resumeFromSession, resumableSessions])

  useEffect(() => {
    if (!resumeSource) {
      return
    }

    if (resumeSource.agentType && resumeSource.agentType !== agentType) {
      setAgentType(resumeSource.agentType)
    }
    if (transportType !== 'stream') {
      setTransportType('stream')
    }

    const nextCwd = resumeSource.cwd ?? ''
    if (cwd !== nextCwd) {
      setCwd(nextCwd)
    }

    if (resumeSource.agentType === 'claude') {
      const nextEffort = resumeSource.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
      if (effort !== nextEffort) {
        setEffort(nextEffort)
      }
      const nextAdaptiveThinking = resumeSource.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
      if (adaptiveThinking !== nextAdaptiveThinking) {
        setAdaptiveThinking(nextAdaptiveThinking)
      }
    }

    const nextHost = resumeSource.host ?? ''
    if (selectedHost !== nextHost) {
      setSelectedHost(nextHost)
    }
  }, [adaptiveThinking, agentType, cwd, effort, resumeSource, selectedHost, transportType])

  async function refreshSessions() {
    await queryClient.invalidateQueries({ queryKey: ['agents', 'sessions'] })
  }

  const handleCreateSession = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating) {
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      const result = await createSession({
        name: name.trim(),
        task: task.trim() || undefined,
        effort,
        adaptiveThinking,
        cwd: cwd.trim() || undefined,
        resumeFromSession: resumeFromSession || undefined,
        transportType,
        agentType,
        host: selectedHost || undefined,
      })

      setName('')
      setTask('')
      setEffort(DEFAULT_CLAUDE_EFFORT_LEVEL)
      setAdaptiveThinking(DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE)
      setCwd('')
      setResumeFromSession('')
      setAgentType('claude')
      setTransportType('stream')
      setSelectedHost('')
      setShowNewSessionForm(false)
      setSelectedSession(result.sessionName)
      await refreshSessions()
    } catch (caughtError) {
      setCreateError(formatError(caughtError, 'Failed to create session'))
    } finally {
      setIsCreating(false)
    }
  }, [
    adaptiveThinking,
    agentType,
    cwd,
    effort,
    isCreating,
    name,
    resumeFromSession,
    selectedHost,
    transportType,
    task,
  ])

  async function handleKillSession(
    sessionName: string,
    agentType?: AgentType,
    selectedSessionType?: SessionType,
  ) {
    setSessionActionError(null)

    try {
      const isStream = selectedSessionType === 'stream'
      const shouldDebrief = isStream && shouldAttemptDebriefOnKill(agentType)

      if (shouldDebrief) {
        try {
          const preResp = await triggerPreKillDebrief(sessionName)
          if (preResp.debriefStarted && preResp.timeoutMs) {
            const deadline = Date.now() + preResp.timeoutMs
            const pollIntervalMs = 2000
            while (Date.now() < deadline) {
              const { status } = await getDebriefStatus(sessionName)
              if (status === 'completed' || status === 'timed-out') break
              await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
            }
          }
        } catch (caughtError) {
          if (!isNotFoundRequestFailure(caughtError)) {
            throw caughtError
          }
        }
      }

      await killSession(sessionName)
      setSelectedSession((current) => (current === sessionName ? null : current))
      await refreshSessions()
    } catch (caughtError) {
      const message = formatError(caughtError, 'Failed to kill session')
      setSessionActionError(message)
      throw caughtError
    }
  }

  async function handleResumeSession(sessionName: string) {
    setSessionActionError(null)

    try {
      const resumed = await resumeAgentSession(sessionName)
      setSelectedSession(resumed.name)
      await refreshSessions()
    } catch (caughtError) {
      const message = formatError(caughtError, 'Failed to resume session')
      setSessionActionError(message)
      throw caughtError
    }
  }

  const selectedSessionData = sessionList.find((session) => session.name === selectedSession)
  const filteredSessions = filterSessionsByTab(sessionList, sessionTab)

  return (
    <div className="flex h-full">
      <div
        className={cn(
          'flex flex-col border-r border-ink-border transition-all duration-500 ease-gentle overflow-y-auto pb-20 md:pb-0',
          selectedSession && !isMobile ? 'w-80' : 'w-full max-w-2xl mx-auto',
        )}
      >
        <div className="px-4 py-6 md:px-6 md:py-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-display text-sumi-black">Agents</h2>
              <p className="mt-2 text-sm text-sumi-diluted leading-relaxed">
                Active PTY sessions across the system
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowNewSessionForm((current) => !current)
                setCreateError(null)
              }}
              className="btn-ghost inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              {showNewSessionForm ? 'Close' : 'New Session'}
            </button>
          </div>

          {isMobile ? (
            <>
              <div
                className={cn('sheet-backdrop', showNewSessionForm && 'visible')}
                onClick={() => setShowNewSessionForm(false)}
              />
              <div className={cn('sheet', showNewSessionForm && 'visible')}>
                <div className="sheet-handle">
                  <div className="sheet-handle-bar" />
                </div>
                <div className="px-5 pb-4">
                  <h3 className="font-display text-heading text-sumi-black mb-4">New Session</h3>
                  <NewSessionForm
                    name={name}
                    setName={setName}
                    cwd={cwd}
                    setCwd={setCwd}
                    resumeOptions={resumableSessions}
                    resumeSource={resumeSource}
                    resumeSourceName={resumeFromSession}
                    setResumeSourceName={setResumeFromSession}
                    task={task}
                    setTask={setTask}
                    effort={effort}
                    setEffort={setEffort}
                    adaptiveThinking={adaptiveThinking}
                    setAdaptiveThinking={setAdaptiveThinking}
                    agentType={agentType}
                    setAgentType={setAgentType}
                    transportType={transportType}
                    setTransportType={setTransportType}
                    machines={machineList}
                    selectedHost={selectedHost}
                    setSelectedHost={setSelectedHost}
                    isCreating={isCreating}
                    createError={createError}
                    onSubmit={handleCreateSession}
                  />
                </div>
              </div>
            </>
          ) : (
            showNewSessionForm && (
              <div className="mt-5 card-sumi p-4">
                <NewSessionForm
                  name={name}
                  setName={setName}
                  cwd={cwd}
                  setCwd={setCwd}
                  resumeOptions={resumableSessions}
                  resumeSource={resumeSource}
                  resumeSourceName={resumeFromSession}
                  setResumeSourceName={setResumeFromSession}
                  task={task}
                  setTask={setTask}
                  effort={effort}
                  setEffort={setEffort}
                  adaptiveThinking={adaptiveThinking}
                  setAdaptiveThinking={setAdaptiveThinking}
                  agentType={agentType}
                  setAgentType={setAgentType}
                  transportType={transportType}
                  setTransportType={setTransportType}
                  machines={machineList}
                  selectedHost={selectedHost}
                  setSelectedHost={setSelectedHost}
                  isCreating={isCreating}
                  createError={createError}
                  onSubmit={handleCreateSession}
                />
              </div>
            )
          )}

          {sessionActionError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
              <AlertTriangle size={15} className="mt-0.5" />
              <span>{sessionActionError}</span>
            </div>
          )}
        </div>

        {sessionList.length > 0 && (
          <div className="px-4 pb-3 flex gap-1">
            {SESSION_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setSessionTab(tab)}
                className={cn(
                  'badge-sumi capitalize transition-colors',
                  sessionTab === tab ? 'bg-sumi-black text-white' : 'hover:bg-washi-shadow',
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 pb-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-3 h-3 rounded-full bg-sumi-mist animate-breathe" />
            </div>
          ) : filteredSessions?.length === 0 ? (
            <div className="text-center py-12 text-sumi-diluted text-sm">
              No {sessionTab === 'all' ? '' : sessionTab + ' '}sessions
            </div>
          ) : (
            filteredSessions?.map((session) => (
              <SessionCard
                key={session.name}
                session={session}
                machine={session.host ? machineMap.get(session.host) : undefined}
                selected={selectedSession === session.name}
                onSelect={() => {
                  setSelectedSession(
                    selectedSession === session.name ? null : session.name,
                  )
                }}
                onKill={() => handleKillSession(session.name, session.agentType, session.transportType)}
                onResume={() => handleResumeSession(session.name)}
                onNavigateToSession={(sessionName) => setSelectedSession(sessionName)}
              />
            ))
          )}
        </div>

        {filteredSessions && (
          <div className="px-6 py-3 mt-auto border-t border-ink-border">
            <p className="text-whisper text-sumi-mist">
              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''} &middot; auto-refreshing
            </p>
          </div>
        )}
      </div>

      {selectedSession && (
        selectedSessionData?.transportType === 'stream' ? (
          <MobileSessionView
            key={selectedSession}
            sessionName={selectedSession}
            sessionLabel={selectedSessionData?.label}
            agentType={selectedSessionData?.agentType}
            sessionType={selectedSessionData?.sessionType}
            commanderId={selectedSessionData?.creator?.kind === 'commander' ? selectedSessionData.creator.id ?? null : null}
            sessionCwd={selectedSessionData?.cwd}
            initialSpawnedWorkers={selectedSessionData?.spawnedWorkers}
            onClose={() => setSelectedSession(null)}
            onKill={(name, type) => handleKillSession(name, type, selectedSessionData?.transportType)}
            onNavigateToSession={(nextSessionName) => setSelectedSession(nextSessionName)}
            onRefreshSessions={refreshSessions}
          />
        ) : (
          <TerminalView
            sessionName={selectedSession}
            sessionLabel={selectedSessionData?.label}
            agentType={selectedSessionData?.agentType}
            onClose={() => setSelectedSession(null)}
            onKill={(name, type) => handleKillSession(name, type, selectedSessionData?.transportType)}
            isMobileOverlay={isMobile}
          />
        )
      )}
    </div>
  )
}

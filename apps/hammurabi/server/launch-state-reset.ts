import path from 'node:path'
import {
  readPersistedSessionsState,
  writePersistedSessionsState,
} from '../modules/agents/session/persistence.js'
import type { PersistedStreamSession } from '../modules/agents/types.js'
import type { QueuedMessage } from '../modules/agents/message-queue.js'
import { resolveModuleDataDir } from '../modules/data-dir.js'
import { ConversationStore } from '../modules/commanders/conversation-store.js'
import { CommanderSessionStore } from '../modules/commanders/store.js'
import {
  resolveCommanderDataDir,
  resolveCommanderSessionStorePath,
} from '../modules/commanders/paths.js'

export interface LaunchStateResetOptions {
  sessionStorePath?: string
  commanderDataDir?: string
  commanderSessionStorePath?: string
}

export interface LaunchStateResetResult {
  streamSessionsStopped: number
  conversationsStopped: number
  commanderSessionsStopped: number
  errors: string[]
}

type CountKey = Exclude<keyof LaunchStateResetResult, 'errors'>

function resolveSessionStorePath(sessionStorePath?: string): string {
  return sessionStorePath
    ? path.resolve(sessionStorePath)
    : path.join(resolveModuleDataDir('agents'), 'stream-sessions.json')
}

function shouldStopSession(entry: PersistedStreamSession): boolean {
  return entry.sessionState !== 'exited'
}

function dedupeQueuedMessages(messages: QueuedMessage[]): QueuedMessage[] {
  const seen = new Set<string>()
  return messages.filter((message) => {
    if (seen.has(message.id)) {
      return false
    }
    seen.add(message.id)
    return true
  })
}

function stopPersistedStreamSession(entry: PersistedStreamSession): PersistedStreamSession {
  const queuedMessages = [...(entry.queuedMessages ?? [])]
  const pendingDirectSendMessages = [...(entry.pendingDirectSendMessages ?? [])]

  if (entry.currentQueuedMessage) {
    if (entry.currentQueuedMessage.priority === 'high') {
      pendingDirectSendMessages.unshift(entry.currentQueuedMessage)
    } else {
      queuedMessages.unshift(entry.currentQueuedMessage)
    }
  }

  return {
    ...entry,
    sessionState: 'exited',
    hadResult: false,
    activeTurnId: undefined,
    daemonProcess: undefined,
    currentQueuedMessage: undefined,
    queuedMessages: dedupeQueuedMessages(queuedMessages),
    pendingDirectSendMessages: dedupeQueuedMessages(pendingDirectSendMessages),
  }
}

async function stopPersistedStreamSessions(sessionStorePath?: string): Promise<number> {
  const resolvedPath = resolveSessionStorePath(sessionStorePath)
  const state = await readPersistedSessionsState(resolvedPath)
  let stoppedCount = 0

  const sessions = state.sessions.map((entry) => {
    if (!shouldStopSession(entry)) {
      return entry
    }
    stoppedCount += 1
    return stopPersistedStreamSession(entry)
  })

  if (stoppedCount === 0) {
    return 0
  }

  await writePersistedSessionsState(resolvedPath, { sessions }, { backup: true })
  return stoppedCount
}

async function stopActiveConversations(commanderDataDir?: string): Promise<number> {
  const store = new ConversationStore(commanderDataDir ?? resolveCommanderDataDir())
  const conversations = await store.listAll()
  let stoppedCount = 0

  for (const conversation of conversations) {
    if (conversation.status !== 'active') {
      continue
    }
    const updated = await store.update(conversation.id, (current) => ({
      ...current,
      status: 'idle',
    }))
    if (updated) {
      stoppedCount += 1
    }
  }

  return stoppedCount
}

async function stopRunningCommanderSessions(
  commanderDataDir?: string,
  commanderSessionStorePath?: string,
): Promise<number> {
  const resolvedDataDir = commanderDataDir ?? resolveCommanderDataDir()
  const store = new CommanderSessionStore(
    commanderSessionStorePath ?? resolveCommanderSessionStorePath(resolvedDataDir),
  )
  const sessions = await store.list()
  let stoppedCount = 0

  for (const session of sessions) {
    if (session.state !== 'running') {
      continue
    }
    const updated = await store.update(session.id, (current) => ({
      ...current,
      state: 'idle',
    }))
    if (updated) {
      stoppedCount += 1
    }
  }

  return stoppedCount
}

function formatResetError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${label}: ${message}`
}

export function shouldStopActiveSessionsOnBoot(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export async function resetActiveRuntimeStateForLaunch(
  options: LaunchStateResetOptions = {},
): Promise<LaunchStateResetResult> {
  const result: LaunchStateResetResult = {
    streamSessionsStopped: 0,
    conversationsStopped: 0,
    commanderSessionsStopped: 0,
    errors: [],
  }

  const tasks: Array<{ key: CountKey; label: string; run: () => Promise<number> }> = [
    {
      key: 'streamSessionsStopped',
      label: 'stream sessions',
      run: () => stopPersistedStreamSessions(options.sessionStorePath),
    },
    {
      key: 'conversationsStopped',
      label: 'commander conversations',
      run: () => stopActiveConversations(options.commanderDataDir),
    },
    {
      key: 'commanderSessionsStopped',
      label: 'commander sessions',
      run: () => stopRunningCommanderSessions(
        options.commanderDataDir,
        options.commanderSessionStorePath,
      ),
    },
  ]

  for (const task of tasks) {
    try {
      result[task.key] = await task.run()
    } catch (error) {
      result.errors.push(formatResetError(task.label, error))
      break
    }
  }

  return result
}

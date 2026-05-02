import { Router } from 'express'
import { registerChannelRoutes } from './register-channels.js'
import { registerConversationRoutes } from './register-conversations.js'
import { registerEmailRoutes } from './register-email.js'
import { buildCommandersContext } from './context.js'
import { registerCommandRoomRoutes } from './register-command-room.js'
import { registerCoreRoutes } from './register-core.js'
import { registerMemoryRoutes } from './register-memory.js'
import { registerQuestRoutes } from './register-quests.js'
import { registerRemoteRoutes } from './register-remote.js'
import { registerTranscriptRoutes } from './register-transcripts.js'
import { registerWorkerRoutes } from './register-workers.js'
import { registerWorkspaceRoutes } from './register-workspace.js'
import type { CommandersRouterOptions, CommandersRouterResult } from './types.js'

export type { CommandersRouterOptions, CommandersRouterResult } from './types.js'
export type {
  CommanderChannelReplyDispatchInput,
  CommanderChannelReplyDispatcher,
} from './types.js'
export { buildCommanderSessionSeed } from '../memory/module.js'

export function createCommandersRouter(
  options: CommandersRouterOptions = {},
): CommandersRouterResult {
  const router = Router()
  const conversationRouter = Router()
  const context = buildCommandersContext(options)
  let disposed = false

  // Static top-level routes are mounted before the broader commander surface.
  registerRemoteRoutes(router, context)
  registerChannelRoutes(router, context)
  registerQuestRoutes(router, context)
  registerWorkerRoutes(router, context)
  registerConversationRoutes(router, conversationRouter, context)
  registerCoreRoutes(router, context)
  registerWorkspaceRoutes(router, context)
  registerEmailRoutes(router, context)
  registerCommandRoomRoutes(router, context)
  registerMemoryRoutes(router, context)
  registerTranscriptRoutes(router, context)

  const reconcileTimer = setTimeout(() => {
    if (disposed) {
      return
    }
    void context.migrateLegacyCommanderConfig()
      .then(() => context.reconcileCommanderSessions())
      .catch((error) => {
      console.error('[commanders] Startup reconciliation failed:', error)
      })
  }, 0)

  const dispose = (): void => {
    disposed = true
    clearTimeout(reconcileTimer)
    context.heartbeatManager.stopAll()

    for (const runtime of context.runtimes.values()) {
      if (runtime.collectTimer) {
        clearTimeout(runtime.collectTimer)
        runtime.collectTimer = null
      }
      runtime.unsubscribeEvents?.()
    }

    context.runtimes.clear()
    context.activeCommanderSessions.clear()
    context.heartbeatFiredAtByConversation.clear()

    if (
      context.commandRoomScheduler &&
      'stopAllJobs' in context.commandRoomScheduler &&
      typeof context.commandRoomScheduler.stopAllJobs === 'function'
    ) {
      context.commandRoomScheduler.stopAllJobs()
    }
  }

  return { router, conversationRouter, dispose }
}

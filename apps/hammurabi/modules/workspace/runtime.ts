import {
  createMachineRegistryStore,
  defaultMachineRegistryStorePath,
} from '../agents/machines.js'
import { createWorkspaceRouter } from './routes.js'
import { WorkspaceResolver } from './capability.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createWorkspaceRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, options } = context
  const machineDescriptor = createMachineRegistryStore(defaultMachineRegistryStorePath())
  const resolver = new WorkspaceResolver({
    machineDescriptor,
    conversationStore: capabilities.consume('commanders.conversations', 'workspace'),
    commanderStore: capabilities.consume('commanders.store', 'workspace'),
    sessionsInterface: capabilities.consume('agents.sessions-interface', 'workspace'),
  })

  capabilities.provide('workspace.machineDescriptor', 'workspace', machineDescriptor)
  capabilities.provide('workspace.resolver', 'workspace', resolver)

  return {
    name: 'workspace',
    routeIds: ['workspace.api'],
    router: createWorkspaceRouter({
      apiKeyStore: options.apiKeyStore,
      auth0Domain: options.auth0Domain,
      auth0Audience: options.auth0Audience,
      auth0ClientId: options.auth0ClientId,
      resolver,
    }),
  }
}

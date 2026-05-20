import type { Router } from 'express'
import { createAgentsRuntime } from '../modules/agents/runtime.js'
import { createProviderRegistryRuntime } from '../modules/agents/providers/runtime.js'
import { createApiKeysRuntime } from '../modules/api-keys/runtime.js'
import {
  createAutomationsEventBusFoundation,
  createAutomationsFoundation,
  createAutomationsRuntime,
} from '../modules/automations/runtime.js'
import {
  createChannelsFoundation,
  createChannelsRuntime,
} from '../modules/channels/runtime.js'
import {
  createCommandersFoundation,
  createCommandersRuntime,
} from '../modules/commanders/runtime.js'
import { createConversationRuntime } from '../modules/conversation/runtime.js'
import { createModuleGraphRuntime } from '../modules/module-graph/runtime.js'
import { createOnboardingRuntime } from '../modules/onboarding/runtime.js'
import { createOperatorsRuntime } from '../modules/operators/runtime.js'
import { createOrgRuntime } from '../modules/org/runtime.js'
import {
  createApprovalsRuntime,
  createPoliciesFoundation,
  createPoliciesRuntime,
} from '../modules/policies/runtime.js'
import { createRealtimeRuntime } from '../modules/realtime/runtime.js'
import { createSettingsRuntime } from '../modules/settings/runtime.js'
import { createSkillsRuntime } from '../modules/skills/runtime.js'
import { createTelemetryRuntime } from '../modules/telemetry/runtime.js'
import { createWorkspaceRuntime } from '../modules/workspace/runtime.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
  ModuleRuntimeFactory,
} from './module-runtime.js'

export interface HammurabiRuntimeFactoryResult {
  registrations: readonly ModuleRouteRegistration[]
  otelRouter: Router
}

const RUNTIME_SETUP_FACTORIES: readonly ModuleRuntimeFactory[] = [
  createApiKeysRuntime,
  createAutomationsEventBusFoundation,
  createCommandersFoundation,
  createChannelsFoundation,
  createOperatorsRuntime,
  createPoliciesFoundation,
  createAgentsRuntime,
  createProviderRegistryRuntime,
  createAutomationsFoundation,
  createPoliciesRuntime,
  createApprovalsRuntime,
  createCommandersRuntime,
  createWorkspaceRuntime,
  createChannelsRuntime,
  createConversationRuntime,
  createOrgRuntime,
  createOnboardingRuntime,
  createSettingsRuntime,
  createAutomationsRuntime,
  createRealtimeRuntime,
  createSkillsRuntime,
  createModuleGraphRuntime,
]

const RUNTIME_MOUNT_ORDER = [
  'module-graph',
  'api-keys',
  'agents',
  'providers',
  'policies',
  'approvals',
  'commanders',
  'workspace',
  'channels',
  'conversation',
  'operators',
  'org',
  'onboarding',
  'settings',
  'automations',
  'telemetry',
  'realtime',
  'skills',
] as const

const mountOrderByName = new Map<string, number>(
  RUNTIME_MOUNT_ORDER.map((name, index) => [name, index]),
)

function appendRegistration(
  registrations: ModuleRouteRegistration[],
  value: ReturnType<ModuleRuntimeFactory>,
): void {
  if (!value) {
    return
  }
  if (Array.isArray(value)) {
    registrations.push(...(value as readonly ModuleRouteRegistration[]))
    return
  }
  registrations.push(value as ModuleRouteRegistration)
}

export function createHammurabiModuleRuntimeRegistrations(
  context: ModuleRuntimeContext,
): HammurabiRuntimeFactoryResult {
  const registrations: ModuleRouteRegistration[] = []
  for (const factory of RUNTIME_SETUP_FACTORIES) {
    appendRegistration(registrations, factory(context))
  }

  const telemetry = createTelemetryRuntime(context)
  registrations.push(telemetry.registration)

  registrations.sort((left, right) => (
    (mountOrderByName.get(left.name) ?? Number.MAX_SAFE_INTEGER)
    - (mountOrderByName.get(right.name) ?? Number.MAX_SAFE_INTEGER)
  ))

  return {
    registrations,
    otelRouter: telemetry.otelRouter,
  }
}

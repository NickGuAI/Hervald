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
import { createEvalRuntime } from '../modules/eval/runtime.js'
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

interface ScopedRuntimeFactory {
  moduleId: string
  factory: ModuleRuntimeFactory
}

const RUNTIME_SETUP_FACTORIES: readonly ScopedRuntimeFactory[] = [
  { moduleId: 'api-keys', factory: createApiKeysRuntime },
  { moduleId: 'automations', factory: createAutomationsEventBusFoundation },
  { moduleId: 'commanders', factory: createCommandersFoundation },
  { moduleId: 'channels', factory: createChannelsFoundation },
  { moduleId: 'operators', factory: createOperatorsRuntime },
  { moduleId: 'policies', factory: createPoliciesFoundation },
  { moduleId: 'agents', factory: createAgentsRuntime },
  { moduleId: 'providers', factory: createProviderRegistryRuntime },
  { moduleId: 'automations', factory: createAutomationsFoundation },
  { moduleId: 'policies', factory: createPoliciesRuntime },
  { moduleId: 'approvals', factory: createApprovalsRuntime },
  { moduleId: 'commanders', factory: createCommandersRuntime },
  { moduleId: 'workspace', factory: createWorkspaceRuntime },
  { moduleId: 'channels', factory: createChannelsRuntime },
  { moduleId: 'conversation', factory: createConversationRuntime },
  { moduleId: 'org', factory: createOrgRuntime },
  { moduleId: 'onboarding', factory: createOnboardingRuntime },
  { moduleId: 'settings', factory: createSettingsRuntime },
  { moduleId: 'automations', factory: createAutomationsRuntime },
  { moduleId: 'realtime', factory: createRealtimeRuntime },
  { moduleId: 'skills', factory: createSkillsRuntime },
  { moduleId: 'module-graph', factory: createModuleGraphRuntime },
  { moduleId: 'eval', factory: createEvalRuntime },
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
  'eval',
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
  for (const { moduleId, factory } of RUNTIME_SETUP_FACTORIES) {
    appendRegistration(registrations, context.capabilities.withProviderModule(moduleId, () => factory(context)))
  }

  const telemetry = context.capabilities.withProviderModule('telemetry', () => createTelemetryRuntime(context))
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

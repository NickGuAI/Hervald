import type { FrontendModuleBinding } from '@/types'

export const moduleComponentBindings: FrontendModuleBinding[] = [
  {
    name: 'org',
    routeId: 'org.ui',
    componentKey: 'modules/org/page',
    component: () => import('@modules/org/page'),
  },
  {
    name: 'welcome',
    routeId: 'onboarding.ui',
    componentKey: 'modules/onboarding/page',
    component: () => import('@modules/onboarding/page'),
  },
  {
    name: 'command-room',
    routeId: 'command-room.ui',
    componentKey: 'modules/command-room/page',
    component: () => import('@modules/command-room/page'),
  },
  {
    name: 'commander-marketplace',
    routeId: 'commanders.marketplace-ui',
    componentKey: 'modules/commanders/packages/page',
    component: () => import('@modules/commanders/packages/page'),
  },
  {
    name: 'automations',
    routeId: 'automations.ui',
    componentKey: 'modules/automations/page',
    component: () => import('@modules/automations/page'),
  },
  {
    name: 'approvals',
    routeId: 'approvals.ui',
    componentKey: 'modules/approvals/page',
    component: () => import('@modules/approvals/page'),
  },
  {
    name: 'api-keys',
    routeId: 'api-keys.ui',
    componentKey: 'modules/api-keys/page',
    component: () => import('@modules/api-keys/page'),
  },
  {
    name: 'channels',
    routeId: 'channels.ui',
    componentKey: 'modules/channels/page',
    component: () => import('@modules/channels/page'),
  },
  {
    name: 'telemetry',
    routeId: 'telemetry.ui',
    componentKey: 'modules/telemetry/page',
    component: () => import('@modules/telemetry/page'),
  },
  {
    name: 'policies',
    routeId: 'policies.ui',
    componentKey: 'modules/policies/page',
    component: () => import('@modules/policies/page'),
  },
  {
    name: 'rpg',
    routeId: 'rpg.ui',
    componentKey: 'modules/rpg/page',
    component: () => import('@modules/rpg/page'),
  },
]

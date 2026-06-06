import { createEvalRouter } from './routes.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createEvalRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  return {
    name: 'eval',
    routeIds: ['eval.api'],
    router: createEvalRouter({
      apiKeyStore: context.options.apiKeyStore,
      auth0Domain: context.options.auth0Domain,
      auth0Audience: context.options.auth0Audience,
      auth0ClientId: context.options.auth0ClientId,
    }),
  }
}

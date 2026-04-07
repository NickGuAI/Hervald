import { homedir } from 'node:os'
import path from 'node:path'

export const DEFAULT_HAMBROS_HOME_DIRNAME = '.hambros'
export const DEFAULT_HAMBROS_LOCAL_ORIGIN = 'http://localhost:5173'

export function resolveHambrosHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HAMBROS_HOME?.trim()
  if (override && override.length > 0) {
    return path.resolve(override)
  }

  return path.join(homedir(), DEFAULT_HAMBROS_HOME_DIRNAME)
}

export function resolveHambrosAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHambrosHome(env), 'app')
}

export function resolveHambrosEnvPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHambrosAppRoot(env), '.env')
}

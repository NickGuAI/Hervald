import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'

interface InstallScriptRouterOptions {
  scriptPath?: string
  candidatePaths?: readonly string[]
  readScript?: (candidates: readonly string[]) => Promise<string | null>
}

export function buildDefaultCandidatePaths(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    env.HAMMURABI_INSTALL_SCRIPT_PATH,
    path.resolve(cwd, 'public', 'install.sh'),
    path.resolve(cwd, 'install.sh'),
    path.resolve(cwd, 'apps', 'hammurabi', 'public', 'install.sh'),
    path.resolve(cwd, 'apps', 'hammurabi', 'install.sh'),
    path.resolve(cwd, '..', '..', 'public', 'install.sh'),
    path.resolve(cwd, '..', '..', 'install.sh'),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
}

const DEFAULT_CANDIDATE_PATHS = buildDefaultCandidatePaths()

function isMissingScriptError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'EISDIR'
}

async function readFirstAvailableScript(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8')
    } catch (error) {
      if (!isMissingScriptError(error)) {
        throw error
      }
    }
  }

  return null
}

export function createInstallScriptRouter(options: InstallScriptRouterOptions = {}): Router {
  const router = Router()

  router.get('/install.sh', async (_req, res) => {
    const candidatePaths = options.scriptPath
      ? [options.scriptPath]
      : options.candidatePaths ?? DEFAULT_CANDIDATE_PATHS
    const readScript = options.readScript ?? readFirstAvailableScript

    let script: string | null
    try {
      script = await readScript(candidatePaths)
    } catch {
      res.status(500).type('text/plain; charset=utf-8').send('Failed to read install.sh')
      return
    }

    if (!script) {
      res.status(404).type('text/plain; charset=utf-8').send('install.sh not found')
      return
    }

    res.type('text/x-shellscript; charset=utf-8').send(script)
  })

  return router
}

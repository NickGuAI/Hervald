import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import express from 'express'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildDefaultCandidatePaths, createInstallScriptRouter } from '../install-script'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const testDirectories: string[] = []
const execFileAsync = promisify(execFile)

async function createTestDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-install-script-'))
  testDirectories.push(directory)
  return directory
}

async function removeDirectoryWithRetry(directory: string): Promise<void> {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY') {
        throw error
      }
      if (attempt === maxAttempts) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
    }
  }
}

async function startServer(
  options: Parameters<typeof createInstallScriptRouter>[0],
): Promise<RunningServer> {
  const app = express()
  app.use(createInstallScriptRouter(options))

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

function extractShellFunction(source: string, name: string): string {
  const start = source.indexOf(`${name}() {`)
  expect(start, `expected ${name} in install.sh`).toBeGreaterThanOrEqual(0)

  const rest = source.slice(start)
  const end = rest.search(/\n}\n\n/)
  expect(end, `expected end of ${name} in install.sh`).toBeGreaterThanOrEqual(0)

  return rest.slice(0, end + 3)
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`])
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  for (const directory of testDirectories.splice(0)) {
    await removeDirectoryWithRetry(directory)
  }
})

describe('install script route', () => {
  it('prefers the canonical repo-local install.sh ahead of public mirror paths', () => {
    const candidates = buildDefaultCandidatePaths('/tmp/repo/apps/hammurabi', {})

    expect(candidates).toEqual([
      '/tmp/repo/apps/hammurabi/install.sh',
      '/tmp/repo/apps/hammurabi/public/install.sh',
      '/tmp/repo/apps/hammurabi/apps/hammurabi/install.sh',
      '/tmp/repo/apps/hammurabi/apps/hammurabi/public/install.sh',
      '/tmp/repo/install.sh',
      '/tmp/repo/public/install.sh',
    ])
  })

  it('serves the tracked installer script from /install.sh', async () => {
    const directory = await createTestDirectory()
    const scriptPath = path.join(directory, 'install.sh')
    const scriptContents = '#!/usr/bin/env bash\nprintf "hello from hammurabi\\n"\n'
    await writeFile(scriptPath, scriptContents)

    const server = await startServer({ scriptPath })
    const response = await fetch(`${server.baseUrl}/install.sh`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/x-shellscript')
    expect(await response.text()).toBe(scriptContents)

    await server.close()
  })

  it('returns 404 when the installer script is missing', async () => {
    const directory = await createTestDirectory()
    const missingScriptPath = path.join(directory, 'missing-install.sh')
    const server = await startServer({ scriptPath: missingScriptPath })
    const response = await fetch(`${server.baseUrl}/install.sh`)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('install.sh not found')

    await server.close()
  })

  it('returns 500 when reading the installer script fails unexpectedly', async () => {
    const server = await startServer({
      candidatePaths: ['ignored'],
      readScript: async () => {
        const error = new Error('permission denied')
        ;(error as NodeJS.ErrnoException).code = 'EACCES'
        throw error
      },
    })
    const response = await fetch(`${server.baseUrl}/install.sh`)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Failed to read install.sh')

    await server.close()
  })
})

describe('installer prompt helpers', () => {
  it('points first boot, receipt fallback, and next steps at browser onboarding', async () => {
    const scriptContents = await readFile(new URL('../../../install.sh', import.meta.url), 'utf8')

    expect(scriptContents).toContain('local login_url="http://localhost:${port}/welcome"')
    expect(scriptContents).toContain(
      'print_receipt_line "URL" "${INSTALL_LOGIN_URL:-http://localhost:${PORT:-$DEFAULT_PORT}/welcome}"',
    )
    expect(scriptContents).toContain(
      'Complete browser onboarding within 24 hours, then create a permanent API key in Settings and rotate or revoke the expiring bootstrap key.',
    )
    expect(scriptContents).toContain('configure_cli_from_first_boot "$PORT"')
    expect(scriptContents).not.toContain('Optional: run ${CYAN}hammurabi onboard${NC}')
    expect(scriptContents).not.toMatch(/localhost:\$\{[^}]+}\/org/)
  })

  it('treats shells without a controlling tty as non-interactive', async () => {
    if (!(await commandExists('setsid'))) {
      return
    }

    const scriptContents = await readFile(new URL('../../../install.sh', import.meta.url), 'utf8')
    const promptAvailable = extractShellFunction(scriptContents, 'prompt_available')
    const checkScript = [
      'set -euo pipefail',
      promptAvailable,
      'if prompt_available; then',
      '  printf available',
      'else',
      '  printf unavailable',
      'fi',
    ].join('\n')

    const { stdout } = await execFileAsync('setsid', ['bash', '-c', checkScript])

    expect(stdout).toBe('unavailable')
  })
})

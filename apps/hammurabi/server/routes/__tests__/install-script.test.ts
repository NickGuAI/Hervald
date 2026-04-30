import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildDefaultCandidatePaths, createInstallScriptRouter } from '../install-script'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const testDirectories: string[] = []

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

afterEach(async () => {
  for (const directory of testDirectories.splice(0)) {
    await removeDirectoryWithRetry(directory)
  }
})

describe('install script route', () => {
  it('prefers public/install.sh ahead of repo-local install.sh in the default search order', () => {
    const candidates = buildDefaultCandidatePaths('/tmp/repo/apps/hammurabi', {})

    expect(candidates).toEqual([
      '/tmp/repo/apps/hammurabi/public/install.sh',
      '/tmp/repo/apps/hammurabi/install.sh',
      '/tmp/repo/apps/hammurabi/apps/hammurabi/public/install.sh',
      '/tmp/repo/apps/hammurabi/apps/hammurabi/install.sh',
      '/tmp/repo/public/install.sh',
      '/tmp/repo/install.sh',
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

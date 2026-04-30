import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WebSocket } from 'ws'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import type { PtySpawner } from '../routes'
import {
  AUTH_HEADERS,
  READ_ONLY_AUTH_HEADERS,
  appendTranscriptEvent,
  connectWs,
  connectWsWithReplay,
  createMissingMachinesRegistryPath,
  createMockChildProcess,
  createMockPtyHandle,
  createMockPtySpawner,
  createTempMachinesRegistry,
  installMockCodexSidecar,
  installMockGeminiAcpRuntime,
  mockedNodePtySpawn,
  mockedSpawn,
  setTranscriptStoreRoot,
  startServer,
  writeSessionMeta,
} from './routes-test-harness'
import type { MockCodexSidecar, MockGeminiAcpRuntime, RunningServer } from './routes-test-harness'


describe("agents directories endpoint", () => {
  it('requires authentication', async () => {
      const server = await startServer()
      const response = await fetch(`${server.baseUrl}/api/agents/directories`)

      expect(response.status).toBe(401)
      await server.close()
    })

  it('returns directories from home when no path provided', async () => {
      const server = await startServer()
      const response = await fetch(`${server.baseUrl}/api/agents/directories`, {
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      const payload = (await response.json()) as { parent: string; directories: string[] }
      expect(payload.parent).toBeTruthy()
      expect(Array.isArray(payload.directories)).toBe(true)

      await server.close()
    })

  it('returns directories for a path under home', async () => {
      const { homedir } = await import('node:os')
      const home = homedir()
      const server = await startServer()
      const response = await fetch(`${server.baseUrl}/api/agents/directories?path=${encodeURIComponent(home)}`, {
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      const payload = (await response.json()) as { parent: string; directories: string[] }
      expect(payload.parent).toBe(home)

      await server.close()
    })

  it('returns directories for absolute paths outside home directory', async () => {
      const outsideHome = tmpdir()
      const server = await startServer()
      const response = await fetch(`${server.baseUrl}/api/agents/directories?path=${encodeURIComponent(outsideHome)}`, {
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      const payload = (await response.json()) as { parent: string; directories: string[] }
      expect(payload.parent).toBe(outsideHome)
      expect(Array.isArray(payload.directories)).toBe(true)

      await server.close()
    })

  it('normalizes traversal sequences for absolute paths', async () => {
      const rawPath = `${tmpdir()}/../${tmpdir().split('/').pop()}`
      const server = await startServer()
      const response = await fetch(
        `${server.baseUrl}/api/agents/directories?path=${encodeURIComponent(rawPath)}`,
        { headers: AUTH_HEADERS },
      )

      expect(response.status).toBe(200)
      const payload = (await response.json()) as { parent: string; directories: string[] }
      expect(payload.parent).toBe(resolve(rawPath))
      await server.close()
    })

  it('returns 400 for nonexistent directory anywhere on disk', async () => {
      const nonexistentDir = join(tmpdir(), 'definitely-does-not-exist-12345')
      const server = await startServer()
      const response = await fetch(
        `${server.baseUrl}/api/agents/directories?path=${encodeURIComponent(nonexistentDir)}`,
        { headers: AUTH_HEADERS },
      )

      expect(response.status).toBe(400)
      await server.close()
    })
})

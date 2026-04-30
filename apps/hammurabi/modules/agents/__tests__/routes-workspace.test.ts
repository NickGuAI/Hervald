import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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


describe("agents routes", () => {
  it('exposes agent session workspace tree, file preview, and git status routes', async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-agent-workspace-'))
      await writeFile(join(workspaceDir, 'README.md'), 'Agent workspace\n', 'utf8')

      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'commander-workspace-01',
            mode: 'default',
            cwd: workspaceDir,
          }),
        })
        expect(createResponse.status).toBe(201)

        const treeResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/commander-workspace-01/workspace/tree`,
          { headers: AUTH_HEADERS },
        )
        expect(treeResponse.status).toBe(200)
        const treeBody = await treeResponse.json()
        expect(treeBody.nodes.map((node: { name: string }) => node.name)).toEqual(['README.md'])

        const fileResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/commander-workspace-01/workspace/file?path=README.md`,
          { headers: AUTH_HEADERS },
        )
        expect(fileResponse.status).toBe(200)
        const fileBody = await fileResponse.json()
        expect(fileBody.kind).toBe('text')
        expect(fileBody.content).toContain('Agent workspace')

        const rawResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/commander-workspace-01/workspace/raw?path=README.md`,
          { headers: AUTH_HEADERS },
        )
        expect(rawResponse.status).toBe(200)
        expect(await rawResponse.text()).toBe('Agent workspace\n')

        const gitStatusResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/commander-workspace-01/workspace/git/status`,
          { headers: AUTH_HEADERS },
        )
        expect(gitStatusResponse.status).toBe(200)
        const gitStatusBody = await gitStatusResponse.json()
        expect(gitStatusBody.enabled).toBe(false)
      } finally {
        await server.close()
        await rm(workspaceDir, { recursive: true, force: true })
      }
    })
})

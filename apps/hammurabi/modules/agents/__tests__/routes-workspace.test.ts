import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { WorkspaceCommandRunner } from '../../workspace/git'
import { createWorkspaceRouter } from '../../workspace/routes'
import { resolveWorkspaceRoot } from '../../workspace/resolver'
import type { WorkspaceResolverCapability } from '../../workspace/capability'

const AUTH_HEADERS = { 'x-hammurabi-api-key': 'test-key' }

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }
      const scopes = ['agents:read', 'agents:write']
      const required = options?.requiredScopes ?? []
      return required.every((scope) => scopes.includes(scope))
        ? {
            ok: true,
            record: {
              id: 'test',
              name: 'Test',
              keyHash: 'hash',
              prefix: 'hmrb_test',
              createdBy: 'test',
              createdAt: new Date(0).toISOString(),
              lastUsedAt: null,
              scopes,
            },
          }
        : { ok: false, reason: 'insufficient_scope' as const }
    },
  }
}

async function startWorkspaceServer(
  resolver: WorkspaceResolverCapability,
): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const app = express()
  app.use(express.json())
  app.use('/api/workspace', createWorkspaceRouter({
    apiKeyStore: createTestApiKeyStore(),
    resolver,
  }))
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind to a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

describe('workspace routes', () => {
  let server: Awaited<ReturnType<typeof startWorkspaceServer>> | null = null
  let workspaceDir: string | null = null
  let externalDir: string | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true })
      workspaceDir = null
    }
    if (externalDir) {
      await rm(externalDir, { recursive: true, force: true })
      externalDir = null
    }
  })

  it('serves unified targetId-only tree, file, raw, and git routes', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-route-'))
    await mkdir(join(workspaceDir, 'docs', 'diagrams'), { recursive: true })
    await writeFile(join(workspaceDir, 'README.md'), 'Unified workspace\n', 'utf8')
    await writeFile(join(workspaceDir, 'docs', 'diagrams', 'flow.svg'), '<svg />\n', 'utf8')
    await writeFile(join(workspaceDir, 'docs', 'diagrams', 'flow.dot'), 'digraph Flow {}\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
        readOnly: false,
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        label: 'local',
        host: 'local',
        rootPath: workspaceDir!,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => {
        expect(targetId).toBe('wt-test')
        return {
          target: {
            targetId,
            label: 'local',
            host: 'local',
            rootPath: workspaceDir!,
            readOnly: false,
          },
          workspace,
          host: 'local',
          rootPath: workspace.rootPath,
          readOnly: false,
        }
      },
    }
    server = await startWorkspaceServer(resolver)

    const openResponse = await fetch(`${server.baseUrl}/api/workspace/open`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1' }),
    })
    expect(openResponse.status).toBe(200)
    await expect(openResponse.json()).resolves.toEqual({
      targetId: 'wt-test',
      label: 'local',
      host: 'local',
      readOnly: false,
    })

    const treeResponse = await fetch(
      `${server.baseUrl}/api/workspace/tree?targetId=wt-test`,
      { headers: AUTH_HEADERS },
    )
    expect(treeResponse.status).toBe(200)
    const treeBody = await treeResponse.json()
    expect(treeBody.workspace).toMatchObject({
      source: {
        kind: 'target',
        id: 'wt-test',
        targetId: 'wt-test',
        label: 'local',
        host: 'local',
        readOnly: false,
      },
      readOnly: false,
      isRemote: false,
    })
    expect(treeBody.workspace).not.toHaveProperty('rootPath')
    expect(treeBody.workspace).not.toHaveProperty('gitRoot')
    expect(treeBody).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ name: 'docs', type: 'directory' }),
        expect.objectContaining({ name: 'README.md', type: 'file' }),
      ]),
    })

    const fileResponse = await fetch(
      `${server.baseUrl}/api/workspace/file?targetId=wt-test&path=README.md`,
      { headers: AUTH_HEADERS },
    )
    expect(fileResponse.status).toBe(200)
    const fileBody = await fileResponse.json()
    expect(fileBody.workspace).not.toHaveProperty('rootPath')
    expect(fileBody.workspace).not.toHaveProperty('gitRoot')
    expect(fileBody).toMatchObject({
      kind: 'text',
      content: expect.stringContaining('Unified workspace'),
    })

    const rawResponse = await fetch(
      `${server.baseUrl}/api/workspace/raw?targetId=wt-test&path=README.md`,
      { headers: AUTH_HEADERS },
    )
    expect(rawResponse.status).toBe(200)
    expect(rawResponse.headers.get('content-disposition')).toBeNull()
    expect(await rawResponse.text()).toBe('Unified workspace\n')

    const downloadResponse = await fetch(
      `${server.baseUrl}/api/workspace/raw?targetId=wt-test&path=README.md&download=1`,
      { headers: AUTH_HEADERS },
    )
    expect(downloadResponse.status).toBe(200)
    expect(downloadResponse.headers.get('content-disposition')).toMatch(/attachment; filename="README\.md"/u)
    expect(await downloadResponse.text()).toBe('Unified workspace\n')

    await writeFile(join(workspaceDir, 'docs', 'unsafe "name".txt'), 'download me\n', 'utf8')
    const safeNameResponse = await fetch(
      `${server.baseUrl}/api/workspace/raw?targetId=wt-test&path=${
        encodeURIComponent('docs/unsafe "name".txt')
      }&download=1`,
      { headers: AUTH_HEADERS },
    )
    expect(safeNameResponse.status).toBe(200)
    expect(safeNameResponse.headers.get('content-disposition')).toContain('unsafe _name_.txt')
    expect(await safeNameResponse.text()).toBe('download me\n')

    const gitStatusResponse = await fetch(
      `${server.baseUrl}/api/workspace/git/status?targetId=wt-test`,
      { headers: AUTH_HEADERS },
    )
    expect(gitStatusResponse.status).toBe(200)
    const gitStatusBody = await gitStatusResponse.json()
    expect(gitStatusBody.workspace).not.toHaveProperty('rootPath')
    expect(gitStatusBody.workspace).not.toHaveProperty('gitRoot')
    expect(gitStatusBody).toMatchObject({ enabled: false })

    const resolvedPathResponse = await fetch(
      `${server.baseUrl}/api/workspace/resolve-path?targetId=wt-test&path=${
        encodeURIComponent(join(workspaceDir, 'docs', 'diagrams', 'flow.svg'))
      }`,
      { headers: AUTH_HEADERS },
    )
    expect(resolvedPathResponse.status).toBe(200)
    await expect(resolvedPathResponse.json()).resolves.toMatchObject({
      path: 'docs/diagrams/flow.svg',
      type: 'file',
      treePath: 'docs/diagrams',
    })

    const badLegacyExpandPath = join(workspaceDir, 'docs', 'diagrams').replace(/^\//u, '')
    const legacyExpandResponse = await fetch(
      `${server.baseUrl}/api/workspace/expand?targetId=wt-test&path=${encodeURIComponent(badLegacyExpandPath)}`,
      { headers: AUTH_HEADERS },
    )
    expect(legacyExpandResponse.status).toBe(200)
    await expect(legacyExpandResponse.json()).resolves.toMatchObject({
      parentPath: 'docs/diagrams',
      nodes: expect.arrayContaining([
        expect.objectContaining({ name: 'flow.dot', type: 'file' }),
        expect.objectContaining({ name: 'flow.svg', type: 'file' }),
      ]),
    })

    const saveResponse = await fetch(`${server.baseUrl}/api/workspace/file?targetId=wt-test`, {
      method: 'PUT',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'README.md', content: 'Saved through target\n' }),
    })
    expect(saveResponse.status).toBe(200)
    await expect(saveResponse.json()).resolves.toMatchObject({ path: 'README.md' })
    await expect(readFile(join(workspaceDir, 'README.md'), 'utf8')).resolves.toBe('Saved through target\n')
  })

  it('serves remote raw downloads through the command runner with attachment headers', async () => {
    const remoteRootPath = '/remote/workspace'
    const remoteRelativePath = 'docs/unsafe "name".txt'
    const remoteAbsolutePath = `${remoteRootPath}/${remoteRelativePath}`
    const remoteBytes = Buffer.from('remote download bytes\n', 'utf8')
    const runnerCalls: Array<{ command: string; args: string[] }> = []
    const commandRunner: WorkspaceCommandRunner = {
      exec: async (command, args) => {
        runnerCalls.push({ command, args })
        expect(command).toBe('bash')
        const script = args[1] ?? ''
        const targetPath = args[3]
        expect(targetPath).toBe(remoteAbsolutePath)

        if (script.includes('printf "%s\\n" "$resolved"')) {
          return { stdout: `${remoteAbsolutePath}\n`, stderr: '' }
        }
        if (script.includes('expectation="$2"')) {
          expect(args[4]).toBe('file')
          return { stdout: '', stderr: '' }
        }
        if (script.trim() === 'base64 < "$1"') {
          return { stdout: remoteBytes.toString('base64'), stderr: '' }
        }

        throw new Error(`Unexpected remote command script: ${script}`)
      },
    }
    const remoteMachine = {
      id: 'machine-1',
      label: 'Remote Machine',
      host: 'remote.example.test',
    }
    const remoteWorkspace = {
      source: {
        kind: 'target' as const,
        id: 'wt-remote',
        label: 'remote:/remote/workspace',
        host: remoteMachine.id,
        readOnly: true,
      },
      rootPath: remoteRootPath,
      rootName: 'workspace',
      gitRoot: null,
      readOnly: true,
      isRemote: true,
      machine: remoteMachine,
    }
    const resolver: WorkspaceResolverCapability = {
      open: async () => {
        throw new Error('not used')
      },
      resolveTarget: async (targetId) => {
        expect(targetId).toBe('wt-remote')
        return {
          target: {
            targetId,
            label: 'remote:/remote/workspace',
            host: remoteMachine.id,
            rootPath: remoteRootPath,
            readOnly: true,
            machine: remoteMachine,
          },
          workspace: remoteWorkspace,
          commandRunner,
          host: remoteMachine.id,
          rootPath: remoteRootPath,
          machine: remoteMachine,
          readOnly: true,
        }
      },
    }
    server = await startWorkspaceServer(resolver)

    const inlineResponse = await fetch(
      `${server.baseUrl}/api/workspace/raw?targetId=wt-remote&path=${encodeURIComponent(remoteRelativePath)}`,
      { headers: AUTH_HEADERS },
    )
    expect(inlineResponse.status).toBe(200)
    expect(inlineResponse.headers.get('content-disposition')).toBeNull()
    expect(Buffer.from(await inlineResponse.arrayBuffer()).equals(remoteBytes)).toBe(true)

    const downloadResponse = await fetch(
      `${server.baseUrl}/api/workspace/raw?targetId=wt-remote&path=${
        encodeURIComponent(remoteRelativePath)
      }&download=1`,
      { headers: AUTH_HEADERS },
    )
    expect(downloadResponse.status).toBe(200)
    const contentDisposition = downloadResponse.headers.get('content-disposition')
    expect(contentDisposition).toContain('attachment')
    expect(contentDisposition).toContain('unsafe _name_.txt')
    expect(Buffer.from(await downloadResponse.arrayBuffer()).equals(remoteBytes)).toBe(true)

    expect(runnerCalls.filter((call) => call.args[1]?.trim() === 'base64 < "$1"')).toHaveLength(2)
  })

  it('retargets absolute chat file links that live outside the active workspace root', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-route-'))
    externalDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-external-'))
    const externalFilePath = join(externalDir, 'final_report.md')
    await writeFile(join(workspaceDir, 'README.md'), 'Current workspace\n', 'utf8')
    await writeFile(externalFilePath, '# External report\n', 'utf8')

    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const externalWorkspace = await resolveWorkspaceRoot({
      rootPath: externalDir,
      source: {
        kind: 'target',
        id: 'wt-external',
        label: `local:${externalDir}`,
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async (input) => {
        expect(input.hostHint).toBe('local')
        expect(input.pathHint).toBe(externalDir)
        expect(input.conversationId).toBeUndefined()
        expect(input.authorizationConversationId).toBe('conversation-scope')
        return {
          targetId: 'wt-external',
          label: `local:${externalDir}`,
          host: 'local',
          rootPath: externalDir!,
          readOnly: false,
        }
      },
      resolveTarget: async (targetId) => {
        if (targetId === 'wt-external') {
          return {
            target: {
              targetId,
              label: `local:${externalDir}`,
              host: 'local',
              rootPath: externalDir!,
              readOnly: false,
            },
            workspace: externalWorkspace,
            host: 'local',
            rootPath: externalWorkspace.rootPath,
            readOnly: false,
          }
        }

        expect(targetId).toBe('wt-test')
        return {
          target: {
            targetId,
            label: 'local',
            conversationId: 'conversation-scope',
            host: 'local',
            rootPath: workspaceDir!,
            readOnly: false,
          },
          workspace,
          host: 'local',
          rootPath: workspace.rootPath,
          readOnly: false,
        }
      },
    }
    server = await startWorkspaceServer(resolver)

    const resolvedPathResponse = await fetch(
      `${server.baseUrl}/api/workspace/resolve-path?targetId=wt-test&path=${
        encodeURIComponent(externalFilePath)
      }`,
      { headers: AUTH_HEADERS },
    )

    expect(resolvedPathResponse.status).toBe(200)
    await expect(resolvedPathResponse.json()).resolves.toMatchObject({
      targetId: 'wt-external',
      targetLabel: 'Local workspace',
      targetReadOnly: false,
      path: 'final_report.md',
      type: 'file',
      treePath: '',
    })
  })

  it('retargets symlinked absolute chat file links to the real file root', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-route-'))
    externalDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-external-'))
    const linkDir = join(externalDir, 'links')
    const realDir = join(externalDir, 'real')
    const realFilePath = join(realDir, 'final_report.md')
    const symlinkFilePath = join(linkDir, 'final_report.md')
    await mkdir(linkDir, { recursive: true })
    await mkdir(realDir, { recursive: true })
    await writeFile(join(workspaceDir, 'README.md'), 'Current workspace\n', 'utf8')
    await writeFile(realFilePath, '# External report\n', 'utf8')
    await symlink(realFilePath, symlinkFilePath)

    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const realWorkspace = await resolveWorkspaceRoot({
      rootPath: realDir,
      source: {
        kind: 'target',
        id: 'wt-real',
        label: `local:${realDir}`,
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async (input) => {
        expect(input.hostHint).toBe('local')
        expect(input.pathHint).toBe(realWorkspace.rootPath)
        expect(input.authorizationConversationId).toBe('conversation-scope')
        return {
          targetId: 'wt-real',
          label: `local:${realWorkspace.rootPath}`,
          host: 'local',
          rootPath: realWorkspace.rootPath,
          readOnly: false,
        }
      },
      resolveTarget: async (targetId) => {
        if (targetId === 'wt-real') {
          return {
            target: {
              targetId,
              label: `local:${realWorkspace.rootPath}`,
              host: 'local',
              rootPath: realWorkspace.rootPath,
              readOnly: false,
            },
            workspace: realWorkspace,
            host: 'local',
            rootPath: realWorkspace.rootPath,
            readOnly: false,
          }
        }

        expect(targetId).toBe('wt-test')
        return {
          target: {
            targetId,
            label: 'local',
            conversationId: 'conversation-scope',
            host: 'local',
            rootPath: workspaceDir!,
            readOnly: false,
          },
          workspace,
          host: 'local',
          rootPath: workspace.rootPath,
          readOnly: false,
        }
      },
    }
    server = await startWorkspaceServer(resolver)

    const resolvedPathResponse = await fetch(
      `${server.baseUrl}/api/workspace/resolve-path?targetId=wt-test&path=${
        encodeURIComponent(symlinkFilePath)
      }`,
      { headers: AUTH_HEADERS },
    )

    expect(resolvedPathResponse.status).toBe(200)
    await expect(resolvedPathResponse.json()).resolves.toMatchObject({
      targetId: 'wt-real',
      targetLabel: 'Local workspace',
      targetReadOnly: false,
      path: 'final_report.md',
      type: 'file',
      treePath: '',
    })
  })

  it('retargets symlinked absolute chat directory links to the real directory root', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-route-'))
    externalDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-external-'))
    const realDir = join(externalDir, 'real-dir')
    const symlinkDirPath = join(workspaceDir, 'linked-real-dir')
    await mkdir(realDir, { recursive: true })
    await writeFile(join(workspaceDir, 'README.md'), 'Current workspace\n', 'utf8')
    await writeFile(join(realDir, 'final_report.md'), '# External report\n', 'utf8')
    await symlink(realDir, symlinkDirPath)

    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const realWorkspace = await resolveWorkspaceRoot({
      rootPath: realDir,
      source: {
        kind: 'target',
        id: 'wt-real-dir',
        label: `local:${realDir}`,
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async (input) => {
        expect(input.hostHint).toBe('local')
        expect(input.pathHint).toBe(realWorkspace.rootPath)
        expect(input.authorizationConversationId).toBe('conversation-scope')
        return {
          targetId: 'wt-real-dir',
          label: `local:${realWorkspace.rootPath}`,
          host: 'local',
          rootPath: realWorkspace.rootPath,
          readOnly: false,
        }
      },
      resolveTarget: async (targetId) => {
        if (targetId === 'wt-real-dir') {
          return {
            target: {
              targetId,
              label: `local:${realWorkspace.rootPath}`,
              host: 'local',
              rootPath: realWorkspace.rootPath,
              readOnly: false,
            },
            workspace: realWorkspace,
            host: 'local',
            rootPath: realWorkspace.rootPath,
            readOnly: false,
          }
        }

        expect(targetId).toBe('wt-test')
        return {
          target: {
            targetId,
            label: 'local',
            conversationId: 'conversation-scope',
            host: 'local',
            rootPath: workspaceDir!,
            readOnly: false,
          },
          workspace,
          host: 'local',
          rootPath: workspace.rootPath,
          readOnly: false,
        }
      },
    }
    server = await startWorkspaceServer(resolver)

    const resolvedPathResponse = await fetch(
      `${server.baseUrl}/api/workspace/resolve-path?targetId=wt-test&path=${
        encodeURIComponent(symlinkDirPath)
      }`,
      { headers: AUTH_HEADERS },
    )

    expect(resolvedPathResponse.status).toBe(200)
    await expect(resolvedPathResponse.json()).resolves.toMatchObject({
      targetId: 'wt-real-dir',
      targetLabel: 'Local workspace',
      targetReadOnly: false,
      path: '',
      type: 'directory',
      treePath: '',
    })
  })

  it('rejects raw host/rootPath reads', async () => {
    const resolver = {
      open: async () => {
        throw new Error('not used')
      },
      resolveTarget: async () => {
        throw new Error('targetId should be rejected before resolution')
      },
    } satisfies WorkspaceResolverCapability
    server = await startWorkspaceServer(resolver)

    const response = await fetch(
      `${server.baseUrl}/api/workspace/tree?host=local&rootPath=/tmp`,
      { headers: AUTH_HEADERS },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('targetId'),
    })
  })

  it('materializes ad hoc file annotations without persisting file comments', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-annotations-'))
    await writeFile(join(workspaceDir, 'README.md'), '# Context file\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        label: 'local',
        host: 'local',
        rootPath: workspaceDir!,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => ({
        target: {
          targetId,
          conversationId: 'conv-1',
          label: 'local',
          host: 'local',
          rootPath: workspaceDir!,
          readOnly: false,
        },
        workspace,
        host: 'local',
        rootPath: workspace.rootPath,
        readOnly: false,
      }),
    }
    server = await startWorkspaceServer(resolver)

    const createResponse = await fetch(`${server.baseUrl}/api/workspace/file-comments`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        path: 'README.md',
        body: 'Please revise the heading.',
      }),
    })
    expect(createResponse.status).toBe(404)

    const listResponse = await fetch(
      `${server.baseUrl}/api/workspace/file-comments?targetId=wt-test&conversationId=conv-1&path=README.md`,
      { headers: AUTH_HEADERS },
    )
    expect(listResponse.status).toBe(404)

    const materializeResponse = await fetch(`${server.baseUrl}/api/workspace/context/materialize`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        filePaths: ['README.md'],
        fileAnnotations: [{
          path: 'README.md',
          body: 'Please revise the heading.',
          quote: '# Context file',
          range: { startLine: 1, endLine: 1 },
        }],
      }),
    })
    expect(materializeResponse.status).toBe(200)
    await expect(materializeResponse.json()).resolves.toMatchObject({
      filePaths: ['README.md'],
      fileAnnotations: [{
        path: 'README.md',
        body: 'Please revise the heading.',
        quote: '# Context file',
        range: { startLine: 1, endLine: 1 },
      }],
      text: expect.stringContaining('Please revise the heading.'),
    })
    await expect(readFile(join(workspaceDir, 'file-comments.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const escapeResponse = await fetch(`${server.baseUrl}/api/workspace/context/materialize`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        filePaths: ['../secret.md'],
      }),
    })
    expect(escapeResponse.status).toBe(400)
  })

  it('skips stale selected file paths when materializing workspace context', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-stale-context-'))
    await writeFile(join(workspaceDir, 'README.md'), '# Current file\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        label: 'local',
        host: 'local',
        rootPath: workspaceDir!,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => ({
        target: {
          targetId,
          conversationId: 'conv-1',
          label: 'local',
          host: 'local',
          rootPath: workspaceDir!,
          readOnly: false,
        },
        workspace,
        host: 'local',
        rootPath: workspace.rootPath,
        readOnly: false,
      }),
    }
    server = await startWorkspaceServer(resolver)

    const materializeResponse = await fetch(`${server.baseUrl}/api/workspace/context/materialize`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        filePaths: ['README.md', 'deleted.md'],
        fileAnnotations: [
          {
            path: 'deleted-note.md',
            body: 'This stale annotation should be skipped.',
          },
        ],
      }),
    })

    expect(materializeResponse.status).toBe(200)
    await expect(materializeResponse.json()).resolves.toMatchObject({
      filePaths: ['README.md'],
      directoryPaths: [],
      fileAnnotations: [],
      skippedFilePaths: [
        {
          path: 'deleted.md',
          reason: 'not_found',
          error: 'Workspace path not found',
        },
        {
          path: 'deleted-note.md',
          reason: 'not_found',
          error: 'Workspace path not found',
        },
      ],
      text: expect.stringContaining('@README.md'),
    })
  })
})

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkspaceFilePreview } from '../files'
import { materializeWorkspaceContextPayload } from '../context'
import { defaultWorkspaceCommandRunner, readWorkspaceGitLog, readWorkspaceGitStatus } from '../git'
import { resolveWorkspacePathSelection, resolveWorkspaceRoot, WorkspaceError } from '../resolver'
import { WorkspaceResolver } from '../capability'
import { WorkspacePreferencesStore, WorkspaceTargetStore } from '../store'
import { listWorkspaceTree } from '../tree'

let tmpDir: string

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  }).trim()
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-service-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('workspace service', () => {
  it('rejects remote workspace roots without machine config', async () => {
    await expect(() =>
      resolveWorkspaceRoot({
        rootPath: tmpDir,
        source: {
          kind: 'target',
          id: 'remote-agent',
          label: 'remote-agent',
          host: 'remote-box',
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 501,
      message: 'Remote workspace browsing is not supported yet',
    })
  })

  it('rejects remote workspace roots with a direct runner when machine config is missing', async () => {
    const runner = defaultWorkspaceCommandRunner()
    await expect(() =>
      resolveWorkspaceRoot({
        rootPath: tmpDir,
        source: {
          kind: 'target',
          id: 'remote-agent',
          label: 'remote-agent',
          host: 'remote-box',
        },
      }, runner),
    ).rejects.toMatchObject({
      statusCode: 501,
      message: 'Remote workspace browsing is not supported yet',
    })
  })

  it('resolves remote workspace roots with a runner', async () => {
    const runner = defaultWorkspaceCommandRunner()
    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'remote-agent',
        label: 'remote-agent',
        host: 'remote-box',
      },
      machine: {
        id: 'remote-box',
        label: 'Remote Box',
        host: '127.0.0.1',
      },
    }, runner)

    expect(workspace.isRemote).toBe(true)
    expect(workspace.rootPath).toBe(await fs.realpath(tmpDir))
    expect(workspace.machine).toEqual({
      id: 'remote-box',
      label: 'Remote Box',
      host: '127.0.0.1',
    })
  })

  it('lists a lazy tree while hiding ignored directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'))
    await fs.mkdir(path.join(tmpDir, 'node_modules'))
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test\n', 'utf8')

    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'local-agent',
        label: 'local-agent',
      },
    })
    const tree = await listWorkspaceTree(workspace)

    expect(tree.nodes.map((node) => node.name)).toEqual([
      'src',
      '.gitignore',
      'README.md',
    ])
    expect(tree.nodes.map((node) => node.parentPath)).toEqual(['', '', ''])
  })

  it('lists and previews files in a remote workspace', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'))
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# remote\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'data.bin'), Buffer.from([0, 1, 2, 3]))

    const runner = defaultWorkspaceCommandRunner()
    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'remote-preview-agent',
        label: 'remote-preview-agent',
        host: 'remote-box',
      },
      machine: {
        id: 'remote-box',
        label: 'Remote Box',
        host: '127.0.0.1',
      },
    }, runner)

    const tree = await listWorkspaceTree(workspace, '', runner)
    expect(tree.nodes.map((node) => node.name)).toEqual([
      'src',
      'data.bin',
      'README.md',
    ])
    expect(tree.nodes.map((node) => node.parentPath)).toEqual(['', '', ''])

    const textPreview = await readWorkspaceFilePreview(workspace, 'README.md', runner)
    expect(textPreview.kind).toBe('text')
    expect(textPreview.content).toContain('# remote')

    const binaryPreview = await readWorkspaceFilePreview(workspace, 'data.bin', runner)
    expect(binaryPreview.kind).toBe('binary')
    expect(binaryPreview.content).toBeUndefined()
  }, 60_000)

  it('returns text and binary previews', async () => {
    await fs.writeFile(path.join(tmpDir, 'notes.md'), '# hello\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'data.bin'), Buffer.from([0, 1, 2, 3]))
    await fs.writeFile(path.join(tmpDir, 'report.pdf'), '%PDF-1.7\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'brief.docx'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'preview-agent',
        label: 'preview-agent',
      },
    })

    const textPreview = await readWorkspaceFilePreview(workspace, 'notes.md')
    expect(textPreview.kind).toBe('text')
    expect(textPreview.content).toContain('# hello')

    const binaryPreview = await readWorkspaceFilePreview(workspace, 'data.bin')
    expect(binaryPreview.kind).toBe('binary')
    expect(binaryPreview.content).toBeUndefined()

    const pdfPreview = await readWorkspaceFilePreview(workspace, 'report.pdf')
    expect(pdfPreview.kind).toBe('pdf')
    expect(pdfPreview.mimeType).toBe('application/pdf')

    const docxPreview = await readWorkspaceFilePreview(workspace, 'brief.docx')
    expect(docxPreview.kind).toBe('binary')
    expect(docxPreview.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('reads git status and log for repo-backed workspaces', async () => {
    git(['init'], tmpDir)
    git(['config', 'user.email', 'assistant@example.com'], tmpDir)
    git(['config', 'user.name', 'Assistant'], tmpDir)
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'hello\n', 'utf8')
    git(['add', 'tracked.txt'], tmpDir)
    git(['commit', '-m', 'initial commit'], tmpDir)
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'hello\nworld\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'new-file.txt'), 'new\n', 'utf8')

    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'org/repo/feature-x',
        label: 'org/repo:feature-x',
      },
    })

    const status = await readWorkspaceGitStatus(workspace)
    expect(status.enabled).toBe(true)
    expect(status.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['tracked.txt', 'new-file.txt']),
    )

    const log = await readWorkspaceGitLog(workspace)
    expect(log.enabled).toBe(true)
    expect(log.commits[0]?.subject).toBe('initial commit')
  })

  it('reads git status and log for remote repo-backed workspaces', async () => {
    git(['init'], tmpDir)
    git(['config', 'user.email', 'assistant@example.com'], tmpDir)
    git(['config', 'user.name', 'Assistant'], tmpDir)
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'hello\n', 'utf8')
    git(['add', 'tracked.txt'], tmpDir)
    git(['commit', '-m', 'initial commit'], tmpDir)
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'hello\nworld\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'new-file.txt'), 'new\n', 'utf8')

    const runner = defaultWorkspaceCommandRunner()
    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'remote-git-agent',
        label: 'remote-git-agent',
        host: 'remote-box',
      },
      machine: {
        id: 'remote-box',
        label: 'Remote Box',
        host: '127.0.0.1',
      },
    }, runner)

    const status = await readWorkspaceGitStatus(workspace, runner)
    expect(status.enabled).toBe(true)
    expect(status.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['tracked.txt', 'new-file.txt']),
    )

    const log = await readWorkspaceGitLog(workspace, 15, runner)
    expect(log.enabled).toBe(true)
    expect(log.commits[0]?.subject).toBe('initial commit')
  })

  it('opens conversation targets through the worker, commander cwd, and home fallback chain', async () => {
    const targetStore = new WorkspaceTargetStore(path.join(tmpDir, 'targets.json'))
    const machineDescriptor = {
      readMachineRegistry: async () => [{
        id: 'local',
        label: 'Local',
        host: null,
        cwd: '/',
      }],
    }
    const conversationStore = {
      get: async (conversationId: string) => ({
        id: conversationId,
        commanderId: conversationId === 'home-conv' ? 'missing-commander' : 'cmd-1',
      }),
    }
    const commanderStore = {
      get: async (commanderId: string) => commanderId === 'cmd-1'
        ? { id: 'cmd-1', cwd: tmpDir }
        : null,
    }
    const sessionsInterface = {
      getSession: (name: string) => name.includes('worker-conv')
        ? { cwd: path.join(tmpDir, 'worker'), host: 'local' }
        : undefined,
    }
    await fs.mkdir(path.join(tmpDir, 'worker'))

    const resolver = new WorkspaceResolver({
      targetStore,
      machineDescriptor,
      conversationStore: conversationStore as never,
      commanderStore: commanderStore as never,
      sessionsInterface: sessionsInterface as never,
    })
    const resolvedTmpDir = await fs.realpath(tmpDir)

    await expect(resolver.open({ conversationId: 'worker-conv' })).resolves.toMatchObject({
      rootPath: path.join(resolvedTmpDir, 'worker'),
    })
    await expect(resolver.open({ conversationId: 'commander-conv' })).resolves.toMatchObject({
      rootPath: resolvedTmpDir,
    })
    await expect(resolver.open({ conversationId: 'home-conv' })).resolves.toMatchObject({
      host: 'local',
    })
  })

  it('preserves persisted remote machine descriptors for minted targets', async () => {
    const targetStorePath = path.join(tmpDir, 'targets.json')
    const targetStore = new WorkspaceTargetStore(targetStorePath)
    const machineDescriptor = {
      readMachineRegistry: async () => [{
        id: 'remote-box',
        label: 'Remote Box',
        host: '127.0.0.1',
        cwd: tmpDir,
      }],
    }
    const resolver = new WorkspaceResolver({
      targetStore,
      machineDescriptor,
      conversationStore: {
        get: async (conversationId: string) => ({ id: conversationId, commanderId: 'cmd-1' }),
      } as never,
      commanderStore: {
        get: async () => ({
          id: 'cmd-1',
          cwd: tmpDir,
          remoteOrigin: { machineId: 'remote-box' },
        }),
      } as never,
    })

    const opened = await resolver.open({
      conversationId: 'remote-conv',
      hostHint: 'remote-box',
      pathHint: tmpDir,
    })

    const reloaded = new WorkspaceTargetStore(targetStorePath)
    await expect(reloaded.getByTargetId(opened.targetId)).resolves.toMatchObject({
      machine: {
        id: 'remote-box',
        label: 'Remote Box',
        host: '127.0.0.1',
      },
    })
  })

  it('opens a workspace location without a commander or conversation source', async () => {
    const resolver = new WorkspaceResolver({
      targetStore: new WorkspaceTargetStore(path.join(tmpDir, 'targets.json')),
      machineDescriptor: {
        readMachineRegistry: async () => [{
          id: 'local',
          label: 'Local',
          host: null,
          cwd: tmpDir,
        }],
      },
      conversationStore: {
        get: async () => null,
      } as never,
      commanderStore: {
        get: async () => null,
      } as never,
    })
    const resolvedTmpDir = await fs.realpath(tmpDir)

    await expect(resolver.open({
      hostHint: 'local',
      pathHint: tmpDir,
    })).resolves.toMatchObject({
      host: 'local',
      rootPath: resolvedTmpDir,
    })
    await expect(resolver.open({
      hostHint: 'local',
      pathHint: tmpDir,
    })).resolves.toMatchObject({
      label: 'Local',
    })
  })

  it('rejects direct local location opens when the local machine has no configured cwd', async () => {
    const targetStore = new WorkspaceTargetStore(path.join(tmpDir, 'targets.json'))
    const resolver = new WorkspaceResolver({
      targetStore,
      machineDescriptor: {
        readMachineRegistry: async () => [{
          id: 'local',
          label: 'Local',
          host: null,
        }],
      },
      conversationStore: {
        get: async () => null,
      } as never,
      commanderStore: {
        get: async () => null,
      } as never,
    })

    await expect(() =>
      resolver.open({
        hostHint: 'local',
        pathHint: '/etc',
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(targetStore.getByKey('location:local:/etc')).resolves.toBeNull()
  })

  it('realpaths direct local location roots before authorization', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-outside-'))
    const symlinkPath = path.join(tmpDir, 'linked-outside')
    await fs.symlink(outsideDir, symlinkPath)
    const resolver = new WorkspaceResolver({
      targetStore: new WorkspaceTargetStore(path.join(tmpDir, 'targets.json')),
      machineDescriptor: {
        readMachineRegistry: async () => [{
          id: 'local',
          label: 'Local',
          host: null,
          cwd: tmpDir,
        }],
      },
      conversationStore: {
        get: async () => null,
      } as never,
      commanderStore: {
        get: async () => null,
      } as never,
    })

    try {
      await expect(() =>
        resolver.open({
          hostHint: 'local',
          pathHint: symlinkPath,
        }),
      ).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects unauthorized host/path hints before minting a target', async () => {
    const resolver = new WorkspaceResolver({
      targetStore: new WorkspaceTargetStore(path.join(tmpDir, 'targets.json')),
      machineDescriptor: {
        readMachineRegistry: async () => [{
          id: 'local',
          label: 'Local',
          host: null,
          cwd: tmpDir,
        }],
      },
      conversationStore: {
        get: async (conversationId: string) => ({ id: conversationId, commanderId: 'cmd-1' }),
      } as never,
      commanderStore: {
        get: async () => ({ id: 'cmd-1', cwd: tmpDir }),
      } as never,
    })

    await expect(() =>
      resolver.open({
        conversationId: 'conv-1',
        hostHint: 'not-authorized',
        pathHint: tmpDir,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(() =>
      resolver.open({
        conversationId: 'conv-1',
        hostHint: 'local',
        pathHint: path.dirname(tmpDir),
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('accepts absolute file paths that stay inside the target root', async () => {
    await fs.writeFile(path.join(tmpDir, 'inside.txt'), 'inside\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'wt-local',
        label: 'local',
      },
    })

    const preview = await readWorkspaceFilePreview(workspace, path.join(tmpDir, 'inside.txt'))
    expect(preview.content).toContain('inside')
  })

  it('resolves absolute requested paths to workspace-relative paths for chat file links', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'diagrams'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'diagrams', 'ui-to-backend-logic-flow.svg'),
      '<svg />\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'diagrams', 'ui-to-backend-logic-flow.dot'),
      'digraph G {}\n',
      'utf8',
    )
    const workspace = await resolveWorkspaceRoot({
      rootPath: tmpDir,
      source: {
        kind: 'target',
        id: 'wt-local',
        label: 'local',
      },
    })

    await expect(
      resolveWorkspacePathSelection(
        workspace,
        path.join(tmpDir, 'docs', 'diagrams', 'ui-to-backend-logic-flow.svg'),
      ),
    ).resolves.toMatchObject({
      path: 'docs/diagrams/ui-to-backend-logic-flow.svg',
      type: 'file',
      treePath: 'docs/diagrams',
    })
    await expect(
      resolveWorkspacePathSelection(workspace, path.join(tmpDir, 'docs', 'diagrams')),
    ).resolves.toMatchObject({
      path: 'docs/diagrams',
      type: 'directory',
      treePath: 'docs/diagrams',
    })
  })

  it('materializes directory context through the explicit directoryPaths contract', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# readme\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'src', 'app.ts'), 'export {}\n', 'utf8')
    const resolver = new WorkspaceResolver({
      targetStore: new WorkspaceTargetStore(path.join(tmpDir, 'targets.json')),
      machineDescriptor: {
        readMachineRegistry: async () => [{
          id: 'local',
          label: 'Local',
          host: null,
          cwd: tmpDir,
        }],
      },
      conversationStore: {
        get: async () => null,
      } as never,
      commanderStore: {
        get: async () => null,
      } as never,
    })

    const target = await resolver.open({ hostHint: 'local', pathHint: tmpDir })
    const materialized = await materializeWorkspaceContextPayload({
      resolver,
      context: {
        targetId: target.targetId,
        filePaths: ['README.md'],
        directoryPaths: ['src'],
      },
    })

    expect(materialized.filePaths).toEqual(['README.md'])
    expect(materialized.directoryPaths).toEqual(['src'])
    expect(materialized.text).toContain('<workspace-files>')
    expect(materialized.text).toContain('@README.md')
    expect(materialized.text).toContain('<workspace-directories>')
    expect(materialized.text).toContain('@src/')
    expect(materialized.text).toContain('- app.ts [file]')
  })

  it('persists workspace preferences outside AppSettings', async () => {
    const preferences = new WorkspacePreferencesStore(path.join(tmpDir, 'preferences.json'))

    await expect(preferences.get()).resolves.toEqual({ panelDefault: 'last-used' })
    await expect(preferences.update({ panelDefault: 'closed' })).resolves.toEqual({ panelDefault: 'closed' })
    await expect(preferences.get()).resolves.toEqual({ panelDefault: 'closed' })
  })
})

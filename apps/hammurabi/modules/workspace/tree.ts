import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveWorkspacePath, WorkspaceError } from './resolver.js'
import {
  defaultWorkspaceCommandRunner,
  type WorkspaceCommandRunner,
} from './git.js'
import type { ResolvedWorkspace, WorkspaceTreeNode, WorkspaceTreeResponse } from './types.js'

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
])

const MAX_TREE_ENTRIES = 200

function shouldSkipEntry(name: string, isDirectory: boolean): boolean {
  if (name === '.git') {
    return true
  }
  return isDirectory && IGNORED_DIRECTORY_NAMES.has(name)
}

function compareTreeNodes(left: WorkspaceTreeNode, right: WorkspaceTreeNode): number {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1
  }
  return left.name.localeCompare(right.name)
}

function resolveWorkspaceTreeRunner(
  workspace: ResolvedWorkspace,
  runner?: WorkspaceCommandRunner,
): WorkspaceCommandRunner {
  if (runner) {
    return runner
  }
  if (workspace.isRemote) {
    throw new WorkspaceError(501, 'Remote workspace browsing is not supported yet')
  }
  return defaultWorkspaceCommandRunner()
}

async function listRemoteWorkspaceTreeNodes(
  absolutePath: string,
  relativePath: string,
  runner: WorkspaceCommandRunner,
): Promise<WorkspaceTreeNode[]> {
  const script = [
    'target="$1"',
    'if [ ! -d "$target" ]; then',
    '  exit 44',
    'fi',
    'find "$target" -mindepth 1 -maxdepth 1 -print0 | while IFS= read -r -d "" entry; do',
    '  name="$(basename "$entry")"',
    '  if [ -L "$entry" ]; then',
    '    continue',
    '  fi',
    '  if [ -d "$entry" ]; then',
    '    printf "%s\\tdirectory\\t\\n" "$name"',
    '  elif [ -f "$entry" ]; then',
    '    size="$(wc -c < "$entry" | tr -d "[:space:]")"',
    '    printf "%s\\tfile\\t%s\\n" "$name" "$size"',
    '  fi',
    'done',
  ].join('\n')

  const { stdout } = await runner.exec('bash', ['-lc', script, '--', absolutePath])
  const nodes: WorkspaceTreeNode[] = []

  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue
    }

    const [name, type, sizeRaw = ''] = line.split('\t')
    if (!name || (type !== 'directory' && type !== 'file')) {
      continue
    }

    const isDirectory = type === 'directory'
    if (shouldSkipEntry(name, isDirectory)) {
      continue
    }

    const entryRelativePath = relativePath
      ? `${relativePath}/${name}`
      : name

    const parsedSize = Number.parseInt(sizeRaw.trim(), 10)
    nodes.push({
      name,
      path: entryRelativePath,
      type: isDirectory ? 'directory' : 'file',
      extension: isDirectory ? undefined : path.posix.extname(name).replace(/^\./, '') || undefined,
      size: Number.isFinite(parsedSize) ? parsedSize : undefined,
    })
  }

  return nodes
}

export async function listWorkspaceTree(
  workspace: ResolvedWorkspace,
  parentPath = '',
  runner?: WorkspaceCommandRunner,
): Promise<WorkspaceTreeResponse> {
  const commandRunner = resolveWorkspaceTreeRunner(workspace, runner)
  const { absolutePath, relativePath } = await resolveWorkspacePath(workspace, parentPath, {
    expectDirectory: true,
  }, workspace.isRemote ? commandRunner : undefined)

  const nodes: WorkspaceTreeNode[] = []

  if (workspace.isRemote) {
    nodes.push(...await listRemoteWorkspaceTreeNodes(absolutePath, relativePath, commandRunner))
  } else {
    const entries = await readdir(absolutePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const isDirectory = entry.isDirectory()
      if (shouldSkipEntry(entry.name, isDirectory)) {
        continue
      }

      const entryPath = path.join(absolutePath, entry.name)
      const entryRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name

      const node: WorkspaceTreeNode = {
        name: entry.name,
        path: entryRelativePath.split(path.sep).join('/'),
        type: isDirectory ? 'directory' : 'file',
        extension: isDirectory ? undefined : path.extname(entry.name).replace(/^\./, '') || undefined,
      }

      if (!isDirectory) {
        try {
          node.size = (await stat(entryPath)).size
        } catch {
          // Ignore per-entry stat failures and keep the tree usable.
        }
      }

      nodes.push(node)
    }
  }

  nodes.sort(compareTreeNodes)

  return {
    workspace,
    parentPath: relativePath,
    nodes: nodes.slice(0, MAX_TREE_ENTRIES),
  }
}

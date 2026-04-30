import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  detectWorkspaceGitRoot,
  type WorkspaceCommandRunner,
} from './git.js'
import type {
  ResolvedWorkspace,
  WorkspaceMachineDescriptor,
  WorkspaceSourceDescriptor,
} from './types.js'

const REMOTE_PATH_NOT_FOUND_EXIT_CODE = 41
const REMOTE_EXPECT_DIRECTORY_EXIT_CODE = 44
const REMOTE_EXPECT_FILE_EXIT_CODE = 45

export class WorkspaceError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'WorkspaceError'
    this.statusCode = statusCode
  }
}

function isWithinRoot(rootPath: string, targetPath: string, usePosix = false): boolean {
  const pathApi = usePosix ? path.posix : path
  const relative = pathApi.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))
}

function normalizeRelativePath(input: string | undefined | null): string {
  if (!input) {
    return ''
  }

  if (path.isAbsolute(input)) {
    throw new WorkspaceError(400, 'Workspace paths must be relative to the workspace root')
  }

  const normalized = path.posix.normalize(input.replaceAll('\\', '/'))
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new WorkspaceError(400, 'Workspace path cannot escape the workspace root')
  }

  return normalized === '.' ? '' : normalized.replace(/^\/+/, '')
}

async function ensureDirectoryExists(targetPath: string, message: string): Promise<void> {
  let targetStat
  try {
    targetStat = await stat(targetPath)
  } catch {
    throw new WorkspaceError(404, message)
  }

  if (!targetStat.isDirectory()) {
    throw new WorkspaceError(400, message)
  }
}

function getCommandErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) {
    return fallback
  }

  const stderr = (error as { stderr?: unknown }).stderr
  if (typeof stderr === 'string' && stderr.trim().length > 0) {
    return stderr.trim()
  }

  const message = (error as { message?: unknown }).message
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim()
  }

  return fallback
}

function getCommandExitCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

function parseResolvedPath(stdout: string, fallbackMessage: string): string {
  const resolvedPath = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1)

  if (!resolvedPath || !path.posix.isAbsolute(resolvedPath)) {
    throw new WorkspaceError(500, fallbackMessage)
  }
  return resolvedPath
}

async function resolveRemoteExistingPath(
  candidatePath: string,
  runner: WorkspaceCommandRunner,
  notFoundMessage: string,
): Promise<string> {
  const script = [
    'target="$1"',
    `if [ ! -e "$target" ]; then exit ${REMOTE_PATH_NOT_FOUND_EXIT_CODE}; fi`,
    'if [ -d "$target" ]; then',
    '  resolved="$(cd "$target" && pwd -P)"',
    'elif [ -L "$target" ]; then',
    '  if command -v realpath >/dev/null 2>&1; then',
    '    resolved="$(realpath "$target")"',
    '  elif command -v readlink >/dev/null 2>&1; then',
    '    resolved="$(readlink -f "$target")"',
    '  else',
    '    echo "Cannot resolve symlinks on remote machine: realpath/readlink missing" >&2',
    '    exit 42',
    '  fi',
    'else',
    '  dir="$(cd "$(dirname "$target")" && pwd -P)"',
    '  resolved="$dir/$(basename "$target")"',
    'fi',
    'printf "%s\\n" "$resolved"',
  ].join('\n')

  try {
    const { stdout } = await runner.exec('bash', ['-lc', script, '--', candidatePath])
    return parseResolvedPath(stdout, 'Failed to resolve remote workspace path')
  } catch (error) {
    if (getCommandExitCode(error) === REMOTE_PATH_NOT_FOUND_EXIT_CODE) {
      throw new WorkspaceError(404, notFoundMessage)
    }
    throw new WorkspaceError(
      500,
      getCommandErrorMessage(error, 'Failed to resolve remote workspace path'),
    )
  }
}

async function ensureRemotePathType(
  candidatePath: string,
  options: {
    expectDirectory?: boolean
    expectFile?: boolean
  },
  runner: WorkspaceCommandRunner,
): Promise<void> {
  if (!options.expectDirectory && !options.expectFile) {
    return
  }

  const expectation = options.expectDirectory ? 'directory' : 'file'
  const script = [
    'target="$1"',
    'expectation="$2"',
    `if [ ! -e "$target" ]; then exit ${REMOTE_PATH_NOT_FOUND_EXIT_CODE}; fi`,
    `if [ "$expectation" = "directory" ] && [ ! -d "$target" ]; then exit ${REMOTE_EXPECT_DIRECTORY_EXIT_CODE}; fi`,
    `if [ "$expectation" = "file" ] && [ ! -f "$target" ]; then exit ${REMOTE_EXPECT_FILE_EXIT_CODE}; fi`,
  ].join('\n')

  try {
    await runner.exec('bash', ['-lc', script, '--', candidatePath, expectation])
  } catch (error) {
    const exitCode = getCommandExitCode(error)
    if (exitCode === REMOTE_PATH_NOT_FOUND_EXIT_CODE) {
      throw new WorkspaceError(404, 'Workspace path not found')
    }
    if (exitCode === REMOTE_EXPECT_DIRECTORY_EXIT_CODE) {
      throw new WorkspaceError(400, 'Workspace path must be a directory')
    }
    if (exitCode === REMOTE_EXPECT_FILE_EXIT_CODE) {
      throw new WorkspaceError(400, 'Workspace path must be a file')
    }
    throw new WorkspaceError(
      500,
      getCommandErrorMessage(error, 'Failed to validate remote workspace path'),
    )
  }
}

export async function resolveWorkspaceRoot(
  input: {
    rootPath: string | undefined | null
    source: WorkspaceSourceDescriptor
    machine?: WorkspaceMachineDescriptor
  },
  runner?: WorkspaceCommandRunner,
): Promise<ResolvedWorkspace> {
  const rootPath = typeof input.rootPath === 'string' ? input.rootPath.trim() : ''
  if (!rootPath || !path.isAbsolute(rootPath)) {
    throw new WorkspaceError(400, 'Workspace root must be an absolute path')
  }

  const remoteSourceHost = typeof input.source.host === 'string'
    ? input.source.host.trim()
    : ''
  const hasRemoteSourceHost = remoteSourceHost.length > 0

  if (hasRemoteSourceHost && !input.machine) {
    throw new WorkspaceError(501, 'Remote workspace browsing is not supported yet')
  }

  if (input.machine) {
    if (!runner) {
      throw new WorkspaceError(501, 'Remote workspace browsing is not supported yet')
    }
    const resolvedRoot = await resolveRemoteExistingPath(
      rootPath,
      runner,
      'Workspace root does not exist',
    )
    await ensureRemotePathType(
      resolvedRoot,
      { expectDirectory: true },
      runner,
    )
    const gitRoot = await detectWorkspaceGitRoot(resolvedRoot, runner)

    return {
      source: input.source,
      rootPath: resolvedRoot,
      rootName: path.posix.basename(resolvedRoot) || resolvedRoot,
      gitRoot,
      readOnly: Boolean(input.source.readOnly),
      isRemote: true,
      machine: input.machine,
    }
  }

  let resolvedRoot: string
  try {
    resolvedRoot = await realpath(rootPath)
  } catch {
    throw new WorkspaceError(404, 'Workspace root does not exist')
  }

  await ensureDirectoryExists(resolvedRoot, 'Workspace root must be a directory')
  const gitRoot = await detectWorkspaceGitRoot(resolvedRoot, runner)

  return {
    source: input.source,
    rootPath: resolvedRoot,
    rootName: path.basename(resolvedRoot) || resolvedRoot,
    gitRoot,
    readOnly: Boolean(input.source.readOnly),
    isRemote: false,
  }
}

async function resolveExistingPath(rootPath: string, candidatePath: string): Promise<string> {
  let resolvedPath: string
  try {
    resolvedPath = await realpath(candidatePath)
  } catch {
    throw new WorkspaceError(404, 'Workspace path not found')
  }

  if (!isWithinRoot(rootPath, resolvedPath)) {
    throw new WorkspaceError(403, 'Workspace path escapes the workspace root')
  }

  return resolvedPath
}

async function resolveRemoteWorkspacePath(
  workspace: ResolvedWorkspace,
  normalizedRelativePath: string,
  options: {
    allowMissing?: boolean
    expectDirectory?: boolean
    expectFile?: boolean
  },
  runner: WorkspaceCommandRunner,
): Promise<{ absolutePath: string; relativePath: string }> {
  const candidatePath = path.posix.resolve(workspace.rootPath, normalizedRelativePath)

  let absolutePath: string
  if (options.allowMissing) {
    const parentPath = path.posix.dirname(candidatePath)
    const resolvedParent = await resolveRemoteExistingPath(
      parentPath,
      runner,
      'Workspace path not found',
    )
    absolutePath = path.posix.join(resolvedParent, path.posix.basename(candidatePath))
  } else {
    absolutePath = await resolveRemoteExistingPath(
      candidatePath,
      runner,
      'Workspace path not found',
    )
  }

  if (!isWithinRoot(workspace.rootPath, absolutePath, true)) {
    throw new WorkspaceError(403, 'Workspace path escapes the workspace root')
  }

  await ensureRemotePathType(absolutePath, options, runner)

  return {
    absolutePath,
    relativePath: normalizedRelativePath,
  }
}

export async function resolveWorkspacePath(
  workspace: ResolvedWorkspace,
  relativePath: string | undefined | null,
  options: {
    allowMissing?: boolean
    expectDirectory?: boolean
    expectFile?: boolean
  } = {},
  runner?: WorkspaceCommandRunner,
): Promise<{ absolutePath: string; relativePath: string }> {
  const normalizedRelativePath = normalizeRelativePath(relativePath)

  if (workspace.isRemote) {
    if (!workspace.machine || !runner) {
      throw new WorkspaceError(501, 'Remote workspace browsing is not supported yet')
    }
    return resolveRemoteWorkspacePath(workspace, normalizedRelativePath, options, runner)
  }

  const candidatePath = path.resolve(workspace.rootPath, normalizedRelativePath)

  let absolutePath: string
  if (options.allowMissing) {
    const parentPath = path.dirname(candidatePath)
    const resolvedParent = await resolveExistingPath(workspace.rootPath, parentPath)
    absolutePath = path.join(resolvedParent, path.basename(candidatePath))
    if (!isWithinRoot(workspace.rootPath, absolutePath)) {
      throw new WorkspaceError(403, 'Workspace path escapes the workspace root')
    }
  } else {
    absolutePath = await resolveExistingPath(workspace.rootPath, candidatePath)
  }

  if (options.expectDirectory || options.expectFile) {
    let targetStat
    try {
      targetStat = await stat(absolutePath)
    } catch {
      throw new WorkspaceError(404, 'Workspace path not found')
    }

    if (options.expectDirectory && !targetStat.isDirectory()) {
      throw new WorkspaceError(400, 'Workspace path must be a directory')
    }
    if (options.expectFile && !targetStat.isFile()) {
      throw new WorkspaceError(400, 'Workspace path must be a file')
    }
  }

  return {
    absolutePath,
    relativePath: normalizedRelativePath,
  }
}

export function requireWritableWorkspace(workspace: ResolvedWorkspace): void {
  if (workspace.readOnly) {
    throw new WorkspaceError(403, 'Workspace is read-only')
  }
}

export function toWorkspaceRelativePath(
  workspace: ResolvedWorkspace,
  absolutePath: string,
): string {
  const pathApi = workspace.isRemote ? path.posix : path
  const relativePath = pathApi.relative(workspace.rootPath, absolutePath)
  if (!isWithinRoot(workspace.rootPath, absolutePath, workspace.isRemote)) {
    throw new WorkspaceError(403, 'Workspace path escapes the workspace root')
  }
  return relativePath === '' ? '' : relativePath.split(pathApi.sep).join('/')
}

export function getWorkspaceParentPath(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const parent = path.posix.dirname(normalized)
  return parent === '.' ? '' : parent
}

export function toWorkspaceError(error: unknown): WorkspaceError {
  if (error instanceof WorkspaceError) {
    return error
  }
  const message = error instanceof Error ? error.message : 'Workspace request failed'
  return new WorkspaceError(500, message)
}

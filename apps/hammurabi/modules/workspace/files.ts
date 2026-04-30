import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import {
  defaultWorkspaceCommandRunner,
  type WorkspaceCommandRunner,
} from './git.js'
import {
  requireWritableWorkspace,
  resolveWorkspacePath,
  toWorkspaceRelativePath,
  WorkspaceError,
} from './resolver.js'
import type {
  ResolvedWorkspace,
  WorkspaceFilePreview,
  WorkspaceMutationResult,
} from './types.js'

const TEXT_PREVIEW_LIMIT_BYTES = 256 * 1024
const IMAGE_PREVIEW_LIMIT_BYTES = 5 * 1024 * 1024
const FILE_NAME_PATTERN = /^[a-zA-Z0-9._\- ]+$/
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  css: 'text/css',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  py: 'text/x-python',
  svg: 'image/svg+xml',
  ts: 'text/plain',
  tsx: 'text/plain',
  txt: 'text/plain',
  webp: 'image/webp',
  yml: 'text/yaml',
  yaml: 'text/yaml',
}

function getExtension(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase()
}

export function getMimeType(filePath: string): string | undefined {
  const extension = getExtension(filePath)
  return MIME_TYPES_BY_EXTENSION[extension]
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024))
  for (const byte of sample) {
    if (byte === 0) {
      return true
    }
  }
  return false
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

function ensureLocalWorkspaceMutations(workspace: ResolvedWorkspace): void {
  if (workspace.isRemote) {
    throw new WorkspaceError(501, 'Remote workspace mutations are not supported yet')
  }
}

function resolveWorkspaceFileRunner(
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

async function readBufferPreview(filePath: string, size: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const bytesToRead = Math.min(size, TEXT_PREVIEW_LIMIT_BYTES)
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function readRemoteFileSize(
  filePath: string,
  runner: WorkspaceCommandRunner,
): Promise<number> {
  const script = [
    'target="$1"',
    'if stat -c %s "$target" >/dev/null 2>&1; then',
    '  stat -c %s "$target"',
    'elif stat -f %z "$target" >/dev/null 2>&1; then',
    '  stat -f %z "$target"',
    'else',
    '  wc -c < "$target" | tr -d "[:space:]"',
    'fi',
  ].join('\n')

  let stdout: string
  try {
    const result = await runner.exec('bash', ['-lc', script, '--', filePath])
    stdout = result.stdout
  } catch (error) {
    throw new WorkspaceError(
      500,
      getCommandErrorMessage(error, 'Failed to read remote file size'),
    )
  }

  const parsed = Number.parseInt(stdout.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new WorkspaceError(500, 'Failed to parse remote file size')
  }
  return parsed
}

async function readRemoteFileBuffer(
  filePath: string,
  runner: WorkspaceCommandRunner,
  maxBytes?: number,
): Promise<Buffer> {
  const script = typeof maxBytes === 'number'
    ? [
      'target="$1"',
      'limit="$2"',
      'dd if="$target" bs=1 count="$limit" 2>/dev/null | base64',
    ].join('\n')
    : [
      'target="$1"',
      'base64 < "$target"',
    ].join('\n')
  const args = typeof maxBytes === 'number'
    ? ['-lc', script, '--', filePath, String(maxBytes)]
    : ['-lc', script, '--', filePath]

  let stdout: string
  try {
    const result = await runner.exec('bash', args)
    stdout = result.stdout
  } catch (error) {
    throw new WorkspaceError(
      500,
      getCommandErrorMessage(error, 'Failed to read remote file contents'),
    )
  }

  return Buffer.from(stdout.replace(/\s+/g, ''), 'base64')
}

async function readRemoteWorkspaceFilePreview(
  workspace: ResolvedWorkspace,
  absolutePath: string,
  normalizedRelativePath: string,
  runner: WorkspaceCommandRunner,
): Promise<WorkspaceFilePreview> {
  const fileSize = await readRemoteFileSize(absolutePath, runner)
  const extension = getExtension(absolutePath)
  const mimeType = getMimeType(absolutePath)
  const basename = path.posix.basename(absolutePath)

  if (IMAGE_EXTENSIONS.has(extension) && fileSize <= IMAGE_PREVIEW_LIMIT_BYTES) {
    const imageBuffer = await readRemoteFileBuffer(absolutePath, runner)
    return {
      workspace,
      path: normalizedRelativePath,
      name: basename,
      kind: 'image',
      size: fileSize,
      mimeType,
      content: `data:${mimeType ?? 'application/octet-stream'};base64,${imageBuffer.toString('base64')}`,
      writable: !workspace.readOnly,
    }
  }

  const previewBuffer = await readRemoteFileBuffer(
    absolutePath,
    runner,
    Math.min(fileSize, TEXT_PREVIEW_LIMIT_BYTES),
  )
  if (isLikelyBinary(previewBuffer)) {
    return {
      workspace,
      path: normalizedRelativePath,
      name: basename,
      kind: 'binary',
      size: fileSize,
      mimeType,
      writable: !workspace.readOnly,
    }
  }

  return {
    workspace,
    path: normalizedRelativePath,
    name: basename,
    kind: 'text',
    size: fileSize,
    mimeType,
    content: previewBuffer.toString('utf8'),
    truncated: fileSize > previewBuffer.length,
    writable: !workspace.readOnly,
  }
}

function toMutationResult(
  workspace: ResolvedWorkspace,
  absolutePath: string,
): WorkspaceMutationResult {
  return {
    workspace,
    path: toWorkspaceRelativePath(workspace, absolutePath),
  }
}

export async function readWorkspaceFilePreview(
  workspace: ResolvedWorkspace,
  relativePath: string,
  runner?: WorkspaceCommandRunner,
): Promise<WorkspaceFilePreview> {
  const commandRunner = resolveWorkspaceFileRunner(workspace, runner)
  const { absolutePath, relativePath: normalizedRelativePath } = await resolveWorkspacePath(
    workspace,
    relativePath,
    { expectFile: true },
    workspace.isRemote ? commandRunner : undefined,
  )

  if (workspace.isRemote) {
    return readRemoteWorkspaceFilePreview(
      workspace,
      absolutePath,
      normalizedRelativePath,
      commandRunner,
    )
  }

  const fileStat = await stat(absolutePath)
  const extension = getExtension(absolutePath)
  const mimeType = getMimeType(absolutePath)

  if (IMAGE_EXTENSIONS.has(extension) && fileStat.size <= IMAGE_PREVIEW_LIMIT_BYTES) {
    const buffer = await readFile(absolutePath)
    return {
      workspace,
      path: normalizedRelativePath,
      name: path.basename(absolutePath),
      kind: 'image',
      size: fileStat.size,
      mimeType,
      content: `data:${mimeType ?? 'application/octet-stream'};base64,${buffer.toString('base64')}`,
      writable: !workspace.readOnly,
    }
  }

  if (extension === 'pdf') {
    return {
      workspace,
      path: normalizedRelativePath,
      name: path.basename(absolutePath),
      kind: 'pdf',
      size: fileStat.size,
      mimeType: mimeType ?? 'application/pdf',
      writable: !workspace.readOnly,
    }
  }

  const buffer = await readBufferPreview(absolutePath, fileStat.size)
  if (isLikelyBinary(buffer)) {
    return {
      workspace,
      path: normalizedRelativePath,
      name: path.basename(absolutePath),
      kind: 'binary',
      size: fileStat.size,
      mimeType,
      writable: !workspace.readOnly,
    }
  }

  return {
    workspace,
    path: normalizedRelativePath,
    name: path.basename(absolutePath),
    kind: 'text',
    size: fileStat.size,
    mimeType,
    content: buffer.toString('utf8'),
    truncated: fileStat.size > buffer.length,
    writable: !workspace.readOnly,
  }
}

export async function saveWorkspaceTextFile(
  workspace: ResolvedWorkspace,
  relativePath: string,
  content: string,
): Promise<WorkspaceMutationResult> {
  ensureLocalWorkspaceMutations(workspace)
  requireWritableWorkspace(workspace)
  const { absolutePath } = await resolveWorkspacePath(workspace, relativePath, { allowMissing: true })
  await writeFile(absolutePath, content, 'utf8')
  return toMutationResult(workspace, absolutePath)
}

export async function createWorkspaceFile(
  workspace: ResolvedWorkspace,
  relativePath: string,
): Promise<WorkspaceMutationResult> {
  ensureLocalWorkspaceMutations(workspace)
  requireWritableWorkspace(workspace)
  const { absolutePath } = await resolveWorkspacePath(workspace, relativePath, { allowMissing: true })
  const existing = await stat(absolutePath).catch(() => null)
  if (existing) {
    throw new WorkspaceError(409, 'Workspace file already exists')
  }
  await writeFile(absolutePath, '', 'utf8')
  return toMutationResult(workspace, absolutePath)
}

export async function createWorkspaceFolder(
  workspace: ResolvedWorkspace,
  relativePath: string,
): Promise<WorkspaceMutationResult> {
  ensureLocalWorkspaceMutations(workspace)
  requireWritableWorkspace(workspace)
  const { absolutePath } = await resolveWorkspacePath(workspace, relativePath, { allowMissing: true })
  const existing = await stat(absolutePath).catch(() => null)
  if (existing) {
    throw new WorkspaceError(409, 'Workspace folder already exists')
  }
  await mkdir(absolutePath, { recursive: false })
  return toMutationResult(workspace, absolutePath)
}

export async function renameWorkspaceEntry(
  workspace: ResolvedWorkspace,
  fromPath: string,
  toPath: string,
): Promise<WorkspaceMutationResult> {
  ensureLocalWorkspaceMutations(workspace)
  requireWritableWorkspace(workspace)
  const { absolutePath: sourceAbsolutePath } = await resolveWorkspacePath(workspace, fromPath)
  const { absolutePath: targetAbsolutePath } = await resolveWorkspacePath(workspace, toPath, {
    allowMissing: true,
  })
  const existing = await stat(targetAbsolutePath).catch(() => null)
  if (existing) {
    throw new WorkspaceError(409, 'Destination already exists')
  }
  await rename(sourceAbsolutePath, targetAbsolutePath)
  return toMutationResult(workspace, targetAbsolutePath)
}

export async function deleteWorkspaceEntry(
  workspace: ResolvedWorkspace,
  relativePath: string,
): Promise<WorkspaceMutationResult> {
  ensureLocalWorkspaceMutations(workspace)
  requireWritableWorkspace(workspace)
  if (!relativePath.trim()) {
    throw new WorkspaceError(400, 'Cannot delete the workspace root')
  }
  const { absolutePath } = await resolveWorkspacePath(workspace, relativePath)
  await rm(absolutePath, { recursive: true, force: false })
  return toMutationResult(workspace, absolutePath)
}

export function createWorkspaceUploadMiddleware(
  destinationPath: string,
  maxFiles = 5,
  maxFileSizeBytes = 10 * 1024 * 1024,
) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destinationPath),
      filename: (_req, file, cb) => {
        if (!FILE_NAME_PATTERN.test(file.originalname)) {
          cb(new Error('Invalid filename'), '')
          return
        }
        cb(null, file.originalname)
      },
    }),
    limits: { fileSize: maxFileSizeBytes, files: maxFiles },
  })
}

export async function resolveWorkspaceUploadDestination(
  workspace: ResolvedWorkspace,
  relativePath: string | undefined | null,
): Promise<{ absolutePath: string; relativePath: string }> {
  ensureLocalWorkspaceMutations(workspace)
  const { absolutePath } = await resolveWorkspacePath(workspace, relativePath, {
    expectDirectory: true,
  })

  return {
    absolutePath,
    relativePath: toWorkspaceRelativePath(workspace, absolutePath),
  }
}

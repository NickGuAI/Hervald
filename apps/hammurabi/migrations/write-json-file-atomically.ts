import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface AtomicJsonWriteOptions {
  backup?: boolean
  trailingNewline?: boolean
}

function buildBackupPath(filePath: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `${filePath}.bak.${stamp}`
}

export async function writeJsonFileAtomically(
  filePath: string,
  payload: unknown,
  options: AtomicJsonWriteOptions = {},
): Promise<string | null> {
  await mkdir(path.dirname(filePath), { recursive: true })

  const tempPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )

  let backupPath: string | null = null
  if (options.backup) {
    backupPath = buildBackupPath(filePath)
    try {
      await copyFile(filePath, backupPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      backupPath = null
    }
  }

  const suffix = options.trailingNewline ? '\n' : ''
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}${suffix}`, 'utf8')
  try {
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }

  return backupPath
}

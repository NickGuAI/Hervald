import { spawn } from 'node:child_process'
import { realpath, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import type { RequestHandler, Router } from 'express'
import multer from 'multer'
import { FILE_NAME_PATTERN } from '../constants.js'
import { listProviders } from '../providers/registry.js'
import { parseFrontmatter } from '../session/state.js'
import type { MachineConfig } from '../types.js'

interface DiscoveryRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  buildSshArgs(machine: MachineConfig & { host: string }, remoteCommand: string, interactive: boolean): string[]
  isRemoteMachine(machine: MachineConfig | undefined): machine is MachineConfig & { host: string }
  readMachineRegistry(): Promise<MachineConfig[]>
  shellEscape(arg: string): string
}

export function registerDiscoveryRoutes(deps: DiscoveryRouteDeps): void {
  const { router, requireReadAccess, requireWriteAccess } = deps

  router.get('/directories', requireReadAccess, async (req, res) => {
    const rawPath = req.query.path
    const rawHost = req.query.host

    if (typeof rawHost === 'string' && rawHost.trim().length > 0) {
      try {
        const machines = await deps.readMachineRegistry()
        const machine = machines.find((entry) => entry.id === rawHost.trim())
        if (!machine || !deps.isRemoteMachine(machine)) {
          res.status(400).json({ error: 'Unknown or local machine' })
          return
        }

        const targetPath = typeof rawPath === 'string' && rawPath.trim().startsWith('/')
          ? deps.shellEscape(rawPath.trim())
          : '"$HOME"'
        const remoteScript = [
          `cd ${targetPath} 2>/dev/null || exit 1`,
          'echo "$PWD"',
          'find . -maxdepth 1 -mindepth 1 -type d ! -name ".*" | sort | while read -r d; do echo "$PWD/${d#./}"; done',
        ].join('; ')
        const sshArgs = deps.buildSshArgs(machine, remoteScript, false)

        const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
          const proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
          let stdout = ''
          let stderr = ''
          proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
          proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
          const procEmitter = proc as unknown as NodeJS.EventEmitter
          procEmitter.on('close', (code: number | null) => {
            resolve({ stdout, stderr, code: code ?? 1 })
          })
          setTimeout(() => {
            proc.kill()
            resolve({ stdout: '', stderr: 'timeout', code: 1 })
          }, 10000)
        })

        if (result.code !== 0) {
          res.status(400).json({ error: result.stderr.trim() || 'Cannot read directory' })
          return
        }

        const lines = result.stdout.trim().split('\n').filter(Boolean)
        const parent = lines[0] ?? '~'
        const directories = lines.slice(1)

        res.json({ parent, directories })
      } catch {
        res.status(400).json({ error: 'Cannot read remote directory' })
      }
      return
    }

    const targetDir = typeof rawPath === 'string' && rawPath.trim().startsWith('/')
      ? path.resolve(rawPath.trim())
      : homedir()

    try {
      const entries = await readdir(targetDir, { withFileTypes: true })
      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(targetDir, entry.name))
        .sort((left, right) => left.localeCompare(right))
      res.json({ parent: targetDir, directories })
    } catch {
      res.status(400).json({ error: 'Cannot read directory' })
    }
  })

  router.get('/skills', requireReadAccess, async (_req, res) => {
    const skillsDirs = listProviders()
      .flatMap((provider) => provider.skillScanPaths ?? [])
      .map((skillPath) => (
        skillPath.startsWith('~/')
          ? path.join(homedir(), skillPath.slice(2))
          : skillPath
      ))
    const seen = new Set<string>()
    const skills: Array<{ name: string; description: string; userInvocable: boolean; argumentHint?: string }> = []

    for (const skillsDir of skillsDirs) {
      let entries
      try {
        entries = await readdir(skillsDir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name)) {
          continue
        }
        const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
        try {
          const content = await readFile(skillMd, 'utf-8')
          const frontmatter = parseFrontmatter(content)
          if (frontmatter['user-invocable'] !== true && frontmatter['user-invocable'] !== 'true') {
            continue
          }
          seen.add(entry.name)
          skills.push({
            name: typeof frontmatter.name === 'string' ? frontmatter.name : entry.name,
            description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
            userInvocable: true,
            argumentHint: typeof frontmatter['argument-hint'] === 'string'
              ? frontmatter['argument-hint']
              : undefined,
          })
        } catch {
          // Ignore malformed skills.
        }
      }
    }

    skills.sort((left, right) => left.name.localeCompare(right.name))
    res.json(skills)
  })

  router.get('/files', requireReadAccess, async (req, res) => {
    const rawPath = req.query.path
    const homeBase = homedir()
    const targetDir = typeof rawPath === 'string' && rawPath.trim().startsWith('/')
      ? path.resolve(rawPath.trim())
      : homeBase

    if (!targetDir.startsWith(homeBase + '/') && targetDir !== homeBase) {
      res.status(403).json({ error: 'Path must be within the home directory' })
      return
    }

    try {
      const entries = await readdir(targetDir, { withFileTypes: true })
      const files = entries
        .filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink())
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
        .sort((left, right) => {
          if (left.isDirectory !== right.isDirectory) {
            return left.isDirectory ? -1 : 1
          }
          return left.name.localeCompare(right.name)
        })

      res.json({ path: targetDir, files })
    } catch {
      res.status(400).json({ error: 'Cannot read directory' })
    }
  })

  router.post('/upload', requireWriteAccess, async (req, res) => {
    const rawCwd = req.query.cwd
    if (typeof rawCwd !== 'string' || !rawCwd.startsWith('/')) {
      res.status(400).json({ error: 'cwd query parameter required (absolute path)' })
      return
    }

    let targetDir: string
    try {
      targetDir = await realpath(path.resolve(rawCwd))
    } catch {
      res.status(400).json({ error: 'Upload path does not exist' })
      return
    }

    const homeBase = homedir()
    if (!targetDir.startsWith(homeBase + '/') && targetDir !== homeBase) {
      res.status(403).json({ error: 'Upload path must be within the home directory' })
      return
    }

    const dynamicUpload = multer({
      storage: multer.diskStorage({
        destination: (_request, _file, callback) => callback(null, targetDir),
        filename: (_request, file, callback) => {
          if (!FILE_NAME_PATTERN.test(file.originalname)) {
            callback(new Error('Invalid filename'), '')
            return
          }
          callback(null, file.originalname)
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    })

    dynamicUpload.array('files', 5)(req, res, (error) => {
      if (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        res.status(400).json({ error: message })
        return
      }

      const uploaded = (req.files as Express.Multer.File[] | undefined)?.map((file) => file.filename) ?? []
      res.json({ uploaded, path: targetDir })
    })
  })
}

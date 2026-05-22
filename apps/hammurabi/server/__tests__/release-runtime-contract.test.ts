import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '../..')
const repoRoot = path.resolve(appRoot, '../..')

describe('release runtime contract', () => {
  it('lets plain Node resolve runtime workspace packages from built JavaScript', async () => {
    const aiServicesPackageJson = JSON.parse(
      await readFile(path.join(repoRoot, 'packages/ai-services/package.json'), 'utf8'),
    ) as {
      main?: string
      exports?: { '.'?: { import?: string } | string }
    }

    expect(aiServicesPackageJson.main).toBe('./dist/index.js')
    expect(aiServicesPackageJson.exports?.['.']).toMatchObject({
      import: './dist/index.js',
    })

    const hammurabiPackageJson = JSON.parse(
      await readFile(path.join(appRoot, 'package.json'), 'utf8'),
    ) as { scripts?: { 'build:deps'?: string } }

    expect(hammurabiPackageJson.scripts?.['build:deps']).toContain(
      'pnpm --filter @gehirn/ai-services build',
    )

    const { stdout } = await execFile(
      process.execPath,
      [
        '-e',
        "import('@gehirn/ai-services').then((mod) => console.log(typeof mod.AgentSessionClient))",
      ],
      { cwd: appRoot },
    )

    expect(stdout.trim()).toBe('function')
  })
})

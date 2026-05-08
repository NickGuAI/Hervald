import { execFile as execFileCallback } from 'node:child_process'
import { access, chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../../../..')
const sourceSkillPath = path.join(
  repoRoot,
  'agent-skills',
  'gehirn-devpkg',
  'write-new-skill',
  'SKILL.md',
)
const tempDirs: string[] = []

const fakeCliEntrypoint = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dataDir = process.env.HAMMURABI_DATA_DIR ?? path.join(process.env.HOME ?? '.', '.hammurabi')
mkdirSync(dataDir, { recursive: true })
writeFileSync(path.join(dataDir, 'bootstrap-key.txt'), 'bootstrap-test-key\\n')
setTimeout(() => process.exit(0), 250)
`

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
  await chmod(filePath, 0o755)
}

async function seedSkillRepo(
  repoDir: string,
  installerRelativePath: string,
): Promise<void> {
  await mkdir(path.join(repoDir, 'apps', 'hammurabi'), { recursive: true })
  await mkdir(path.join(repoDir, 'packages', 'hammurabi-cli', 'bin'), { recursive: true })
  await mkdir(path.join(repoDir, 'packages', 'hammurabi-cli', 'dist'), { recursive: true })
  await mkdir(path.join(repoDir, 'agent-skills', 'gehirn-devpkg'), { recursive: true })
  await mkdir(path.join(repoDir, path.dirname(installerRelativePath)), { recursive: true })

  await cp(
    path.join(repoRoot, installerRelativePath),
    path.join(repoDir, installerRelativePath),
  )
  await chmod(path.join(repoDir, installerRelativePath), 0o755)

  await cp(
    path.join(repoRoot, 'agent-skills', 'install.sh'),
    path.join(repoDir, 'agent-skills', 'install.sh'),
  )
  await chmod(path.join(repoDir, 'agent-skills', 'install.sh'), 0o755)

  await cp(
    path.join(repoRoot, 'agent-skills', 'gehirn-devpkg', 'write-new-skill'),
    path.join(repoDir, 'agent-skills', 'gehirn-devpkg', 'write-new-skill'),
    { recursive: true },
  )

  await writeFile(path.join(repoDir, 'apps', 'hammurabi', '.env.example'), 'PORT=20001\n')
  await writeFile(
    path.join(repoDir, 'apps', 'hammurabi', 'package.json'),
    JSON.stringify({ name: 'hammurabi' }, null, 2),
  )
  await writeExecutable(
    path.join(repoDir, 'packages', 'hammurabi-cli', 'bin', 'hammurabi.mjs'),
    fakeCliEntrypoint,
  )
  await writeFile(
    path.join(repoDir, 'packages', 'hammurabi-cli', 'dist', 'index.js'),
    'export {}\n',
  )
}

async function seedFakeBin(binDir: string): Promise<void> {
  await writeExecutable(
    path.join(binDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf '10.23.0\\n'
fi
`,
  )

  await writeExecutable(
    path.join(binDir, 'corepack'),
    `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
  )

  await writeExecutable(
    path.join(binDir, 'npm'),
    `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
  )

  await writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    http://127.0.0.1:*/api/health)
      exit 0
      ;;
    https://opencode.ai/install)
      printf '#!/usr/bin/env bash\\nexit 0\\n'
      exit 0
      ;;
  esac
done
exit 0
`,
  )

  await writeExecutable(
    path.join(binDir, 'git'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "clone" ]]; then
  for last; do :; done
  mkdir -p "$last"
  cp -R "$FAKE_GIT_CLONE_SOURCE"/. "$last"/
fi
exit 0
`,
  )
}

async function assertInstalledSkill(homeDir: string): Promise<void> {
  const expectedSkill = await readFile(sourceSkillPath, 'utf8')
  const claudeSkillPath = path.join(homeDir, '.claude', 'skills', 'write-new-skill', 'SKILL.md')
  const codexSkillPath = path.join(homeDir, '.codex', 'skills', 'write-new-skill', 'SKILL.md')

  await access(claudeSkillPath)
  await access(codexSkillPath)

  await expect(readFile(claudeSkillPath, 'utf8')).resolves.toBe(expectedSkill)
  await expect(readFile(codexSkillPath, 'utf8')).resolves.toBe(expectedSkill)
}

describe('Hervald installers bundle write-new-skill by default', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        }),
      ),
    )
  })

  it.each([
    {
      label: 'repo-local installer',
      installerRelativePath: path.join('apps', 'hammurabi', 'install.sh'),
      buildArgs: (_workspace: string) => [],
    },
    {
      label: 'hosted installer entrypoint',
      installerRelativePath: path.join('apps', 'hammurabi', 'public', 'install.sh'),
      buildArgs: (workspace: string) => ['--target', 'local', '--install-dir', path.join(workspace, 'checkout')],
    },
  ])('installs write-new-skill into Claude and Codex homes via $label', async ({
    installerRelativePath,
    buildArgs,
  }) => {
    const workspace = await makeTempDir('hammurabi-install-default-skills-')
    const sourceRepo = path.join(workspace, 'source-repo')
    const homeDir = path.join(workspace, 'home')
    const fakeBin = path.join(workspace, 'bin')

    await mkdir(homeDir, { recursive: true })
    await mkdir(fakeBin, { recursive: true })
    await seedSkillRepo(sourceRepo, installerRelativePath)
    await seedFakeBin(fakeBin)

    const scriptPath = path.join(sourceRepo, installerRelativePath)
    const result = await execFile(
      'bash',
      [scriptPath, ...buildArgs(workspace)],
      {
        cwd: path.dirname(scriptPath),
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          FAKE_GIT_CLONE_SOURCE: sourceRepo,
          HAMMURABI_DATA_DIR: path.join(homeDir, '.hammurabi'),
          HAMMURABI_INSTALL_AUTOSTART: '0',
          HAMMURABI_INSTALL_TIMEOUT_SECONDS: '5',
        },
        maxBuffer: 1024 * 1024,
      },
    )

    expect(result.stdout).toContain('Installing default skills')
    await assertInstalledSkill(homeDir)
  })
})

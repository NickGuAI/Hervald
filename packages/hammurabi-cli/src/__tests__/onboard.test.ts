import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  promptTextMock,
  promptSecretMock,
  promptConfirmMock,
  promptMultiSelectMock,
  closePromptResourcesMock,
  validateTelemetryWriteKeyMock,
  applyManagedAgentTelemetryConfigMock,
} = vi.hoisted(() => ({
  promptTextMock: vi.fn(),
  promptSecretMock: vi.fn(),
  promptConfirmMock: vi.fn(),
  promptMultiSelectMock: vi.fn(),
  closePromptResourcesMock: vi.fn(),
  validateTelemetryWriteKeyMock: vi.fn(),
  applyManagedAgentTelemetryConfigMock: vi.fn(),
}))

vi.mock('../prompts.js', () => ({
  promptText: promptTextMock,
  promptSecret: promptSecretMock,
  promptConfirm: promptConfirmMock,
  promptMultiSelect: promptMultiSelectMock,
  closePromptResources: closePromptResourcesMock,
}))

vi.mock('../validate.js', () => ({
  validateTelemetryWriteKey: validateTelemetryWriteKeyMock,
}))

vi.mock('../agent-telemetry.js', () => ({
  applyManagedAgentTelemetryConfig: applyManagedAgentTelemetryConfigMock,
}))

import {
  buildTailscaleInstallCommand,
  detectTailscalePlatform,
  extractTailscaleDnsName,
  runCli as runOnboardCli,
} from '../onboard.js'

const createdDirectories: string[] = []
let previousHome: string | undefined
let previousHammurabiDataDir: string | undefined
let stdoutSpy: ReturnType<typeof vi.spyOn> | null = null
let stderrSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  promptTextMock.mockReset()
  promptSecretMock.mockReset()
  promptConfirmMock.mockReset()
  promptMultiSelectMock.mockReset()
  closePromptResourcesMock.mockReset()
  validateTelemetryWriteKeyMock.mockReset()
  applyManagedAgentTelemetryConfigMock.mockReset()

  promptConfirmMock.mockResolvedValue(false)

  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  stdoutSpy?.mockRestore()
  stderrSpy?.mockRestore()
  stdoutSpy = null
  stderrSpy = null

  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }
  previousHome = undefined

  if (previousHammurabiDataDir === undefined) {
    delete process.env.HAMMURABI_DATA_DIR
  } else {
    process.env.HAMMURABI_DATA_DIR = previousHammurabiDataDir
  }
  previousHammurabiDataDir = undefined

  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function seedOperatorFile(filePath: string, content: Record<string, unknown> = {
  id: 'existing-founder',
  kind: 'founder',
  displayName: 'Existing Founder',
  email: 'existing@example.com',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8')
}

function createOfflineProviderRegistryFetch(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
}

describe('runOnboardCli', () => {
  it('detects supported Tailscale install targets', () => {
    expect(detectTailscalePlatform('darwin')).toBe('macos')
    expect(detectTailscalePlatform('linux')).toBe('linux')
    expect(detectTailscalePlatform('win32')).toBe('unsupported')

    expect(buildTailscaleInstallCommand('macos')).toEqual({
      command: 'brew',
      args: ['install', 'tailscale'],
      display: 'brew install tailscale',
    })
    expect(buildTailscaleInstallCommand('linux')).toEqual({
      command: 'sudo',
      args: ['sh', '-lc', 'curl -fsSL https://tailscale.com/install.sh | sh'],
      display: 'curl -fsSL https://tailscale.com/install.sh | sh',
    })
    expect(buildTailscaleInstallCommand('unsupported')).toBeNull()
  })

  it('extracts the normalized DNS name from tailscale status json', () => {
    expect(extractTailscaleDnsName(JSON.stringify({
      Self: {
        DNSName: 'home-mac.tail2bb6ea.ts.net.',
      },
    }))).toBe('home-mac.tail2bb6ea.ts.net')
  })

  it('writes .hammurabi.json and seeds runtime config when missing', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-onboard-home-'))
    const dataDir = path.join(homeDir, '.hammurabi')
    createdDirectories.push(homeDir)
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = dataDir
    await seedOperatorFile(path.join(dataDir, 'operators.json'))

    promptTextMock.mockResolvedValue('https://hervald.gehirn.ai')
    promptSecretMock.mockResolvedValue('hmrb_test_key')
    promptMultiSelectMock.mockResolvedValue(['claude-code', 'codex'])
    validateTelemetryWriteKeyMock.mockResolvedValue({
      ok: true,
      validationUrl: 'https://hervald.gehirn.ai/v1/logs',
    })
    applyManagedAgentTelemetryConfigMock.mockResolvedValue({
      configured: ['claude-code', 'codex'],
      failed: [],
    })

    const exitCode = await runOnboardCli(['onboard'], {
      fetchImpl: createOfflineProviderRegistryFetch(),
    })

    expect(exitCode).toBe(0)
    const cliConfigPath = path.join(homeDir, '.hammurabi.json')
    const runtimeConfigPath = path.join(homeDir, '.hammurabi', 'config.yaml')

    await expect(readFile(cliConfigPath, 'utf8')).resolves.toContain('"endpoint": "https://hervald.gehirn.ai"')
    await expect(readFile(runtimeConfigPath, 'utf8')).resolves.toBe([
      '# Hammurabi commander runtime defaults and limits.',
      'commanders:',
      '  runtime:',
      '    defaults:',
      '      maxTurns: 300',
      '    limits:',
      '      maxTurns: 300',
      'agents:',
      '  pruner:',
      '    enabled: true',
      '    sweepIntervalMs: 600000',
      '    staleSessionTtlMs: 3600000',
      '    exitedSessionTtlMs: 86400000',
      '',
    ].join('\n'))
    expect(validateTelemetryWriteKeyMock).toHaveBeenCalledWith({
      endpoint: 'https://hervald.gehirn.ai',
      apiKey: 'hmrb_test_key',
    })
  })

  it('guides an already-installed tailscale worker and prints the next machine-add command', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-onboard-home-'))
    const dataDir = path.join(homeDir, '.hammurabi')
    createdDirectories.push(homeDir)
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = dataDir
    await seedOperatorFile(path.join(dataDir, 'operators.json'))

    promptTextMock.mockResolvedValue('https://hervald.gehirn.ai')
    promptSecretMock.mockResolvedValue('hmrb_test_key')
    promptMultiSelectMock.mockResolvedValue(['claude-code'])
    promptConfirmMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    validateTelemetryWriteKeyMock.mockResolvedValue({
      ok: true,
      validationUrl: 'https://hervald.gehirn.ai/v1/logs',
    })
    applyManagedAgentTelemetryConfigMock.mockResolvedValue({
      configured: ['claude-code'],
      failed: [],
    })

    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/tailscale\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          Self: {
            DNSName: 'home-mac.tail2bb6ea.ts.net.',
          },
        }),
        stderr: '',
        code: 0,
      })
    const runInteractiveCommand = vi.fn().mockResolvedValue(0)

    const exitCode = await runOnboardCli(['onboard'], {
      fetchImpl: createOfflineProviderRegistryFetch(),
      platform: 'darwin',
      runCommand,
      runInteractiveCommand,
    })

    expect(exitCode).toBe(0)
    expect(runCommand).toHaveBeenNthCalledWith(1, 'which', ['tailscale'])
    expect(runInteractiveCommand).toHaveBeenCalledWith('sudo', ['tailscale', 'up'])
    expect(stdoutSpy?.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
      'hammurabi machine add --id <id> --label <label> --tailscale-hostname home-mac.tail2bb6ea.ts.net',
    )
  })

  it('creates the founder operator when operators.json is missing', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-onboard-home-'))
    const dataDir = path.join(homeDir, '.hammurabi')
    createdDirectories.push(homeDir)
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = dataDir

    promptTextMock
      .mockResolvedValueOnce('https://hervald.gehirn.ai')
      .mockResolvedValueOnce('Founder Override')
      .mockResolvedValueOnce('founder@example.com')
    promptSecretMock.mockResolvedValue('hmrb_test_key')
    promptMultiSelectMock.mockResolvedValue(['claude-code'])
    validateTelemetryWriteKeyMock.mockResolvedValue({
      ok: true,
      validationUrl: 'https://hervald.gehirn.ai/v1/logs',
    })
    applyManagedAgentTelemetryConfigMock.mockResolvedValue({
      configured: ['claude-code'],
      failed: [],
    })

    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: 'Nick Git\n', stderr: '', code: 0 })

    const exitCode = await runOnboardCli(['onboard'], {
      fetchImpl: createOfflineProviderRegistryFetch(),
      runCommand,
    })

    expect(exitCode).toBe(0)
    const operatorPath = path.join(dataDir, 'operators.json')
    const operator = JSON.parse(await readFile(operatorPath, 'utf8')) as Record<string, unknown>

    expect(operator).toMatchObject({
      kind: 'founder',
      displayName: 'Founder Override',
      email: 'founder@example.com',
      avatarUrl: null,
    })
    expect(typeof operator.id).toBe('string')
    expect(typeof operator.createdAt).toBe('string')
    expect(promptTextMock).toHaveBeenNthCalledWith(2, 'Founder display name', {
      defaultValue: 'Nick Git',
      required: true,
    })
    expect(promptTextMock).toHaveBeenNthCalledWith(3, 'Founder email', {
      required: true,
    })
  })

  it('skips founder creation when operators.json already exists', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-onboard-home-'))
    const dataDir = path.join(homeDir, '.hammurabi')
    createdDirectories.push(homeDir)
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = dataDir
    const operatorPath = path.join(dataDir, 'operators.json')
    const existingOperator = {
      id: 'existing-founder',
      kind: 'founder',
      displayName: 'Existing Founder',
      email: 'existing@example.com',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    await seedOperatorFile(operatorPath, existingOperator)

    promptTextMock.mockResolvedValue('https://hervald.gehirn.ai')
    promptSecretMock.mockResolvedValue('hmrb_test_key')
    promptMultiSelectMock.mockResolvedValue(['claude-code'])
    validateTelemetryWriteKeyMock.mockResolvedValue({
      ok: true,
      validationUrl: 'https://hervald.gehirn.ai/v1/logs',
    })
    applyManagedAgentTelemetryConfigMock.mockResolvedValue({
      configured: ['claude-code'],
      failed: [],
    })

    const runCommand = vi.fn()

    const exitCode = await runOnboardCli(['onboard'], {
      fetchImpl: createOfflineProviderRegistryFetch(),
      runCommand,
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(await readFile(operatorPath, 'utf8'))).toEqual(existingOperator)
    expect(promptTextMock).toHaveBeenCalledTimes(1)
    expect(runCommand).not.toHaveBeenCalled()
  })
})

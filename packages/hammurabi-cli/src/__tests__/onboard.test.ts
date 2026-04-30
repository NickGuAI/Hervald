import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    createdDirectories.push(homeDir)
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(homeDir, '.hammurabi')

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

    const exitCode = await runOnboardCli(['onboard'])

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
    createdDirectories.push(homeDir)
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(homeDir, '.hammurabi')

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
})

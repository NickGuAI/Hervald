import { EventEmitter } from 'node:events'
import type { ChildProcess, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { HAMMURABI_CODEX_AUTH_JSON_B64 } from '../../../provider-auth'
import {
  killCodexRuntimeProcess,
  prepareCodexRuntimeHome,
  spawnLocalCodexRuntime,
  stripCodexTelemetryConfig,
} from '../process'

function createFakeChildProcess(pid = 43210): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  child.pid = pid
  child.spawnfile = 'codex'
  child.kill = vi.fn(() => true) as unknown as ChildProcess['kill']
  return child
}

async function createRuntimeEnv(root: string): Promise<NodeJS.ProcessEnv> {
  const sourceHome = path.join(root, 'source')
  const dataDir = path.join(root, 'data')
  await mkdir(sourceHome, { recursive: true })
  await writeFile(path.join(sourceHome, 'config.toml'), '')
  return {
    CODEX_HOME: sourceHome,
    HAMMURABI_DATA_DIR: dataDir,
  }
}

describe('agents/adapters/codex/process', () => {
  it('strips only Codex OTEL config sections from runtime config', () => {
    const sanitized = stripCodexTelemetryConfig([
      'model = "gpt-5.5"',
      '',
      '[otel]',
      'log_user_prompt = true',
      '',
      '[otel.exporter.otlp-http]',
      'endpoint = "https://hervald.gehirn.ai/v1/logs"',
      '',
      '[mcp_servers.tavily]',
      'url = "https://mcp.tavily.com/mcp"',
    ].join('\n'))

    expect(sanitized).toContain('model = "gpt-5.5"')
    expect(sanitized).toContain('[mcp_servers.tavily]')
    expect(sanitized).not.toContain('[otel]')
    expect(sanitized).not.toContain('otlp-http')
    expect(sanitized).not.toContain('hervald.gehirn.ai/v1/logs')
  })

  it('prepares a sanitized per-spawn CODEX_HOME without linking global auth', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-codex-runtime-home-'))
    try {
      const sourceHome = path.join(root, 'source')
      const dataDir = path.join(root, 'data')
      await mkdir(path.join(sourceHome, 'sessions'), { recursive: true })
      await writeFile(path.join(sourceHome, 'auth.json'), '{}')
      await writeFile(path.join(sourceHome, 'config.toml'), [
        'model = "gpt-5.5"',
        '',
        '[otel]',
        'log_user_prompt = true',
        '',
        '[otel.exporter.otlp-http]',
        'endpoint = "https://hervald.gehirn.ai/v1/logs"',
        '',
        '[mcp_servers.tavily]',
        'url = "https://mcp.tavily.com/mcp"',
      ].join('\n'))

      const runtimeHome = await prepareCodexRuntimeHome({
        CODEX_HOME: sourceHome,
        HAMMURABI_DATA_DIR: dataDir,
      })

      expect(runtimeHome).toContain(path.join(dataDir, 'agents', 'codex-runtime-home-'))
      const config = await readFile(path.join(runtimeHome, 'config.toml'), 'utf8')
      expect(config).toContain('[mcp_servers.tavily]')
      expect(config).not.toContain('[otel]')
      expect(config).not.toContain('hervald.gehirn.ai/v1/logs')
      await expect(readlink(path.join(runtimeHome, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readlink(path.join(runtimeHome, 'sessions'))).toBe(path.join(sourceHome, 'sessions'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('materializes managed Codex auth into the per-spawn runtime home', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-codex-runtime-managed-auth-'))
    try {
      const sourceHome = path.join(root, 'source')
      const dataDir = path.join(root, 'data')
      await mkdir(sourceHome, { recursive: true })
      await writeFile(path.join(sourceHome, 'auth.json'), '{"tokens":{"access_token":"global"}}')
      await writeFile(path.join(sourceHome, 'config.toml'), '')
      const managedAuth = Buffer
        .from(JSON.stringify({ tokens: { access_token: 'managed' } }), 'utf8')
        .toString('base64')

      const runtimeHome = await prepareCodexRuntimeHome({
        CODEX_HOME: sourceHome,
        HAMMURABI_DATA_DIR: dataDir,
        [HAMMURABI_CODEX_AUTH_JSON_B64]: managedAuth,
      })

      expect(JSON.parse(await readFile(path.join(runtimeHome, 'auth.json'), 'utf8'))).toEqual({
        tokens: { access_token: 'managed' },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prepares an empty runtime CODEX_HOME when the source home is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-codex-runtime-missing-home-'))
    try {
      const missingSourceHome = path.join(root, 'missing-source')
      const dataDir = path.join(root, 'data')

      const runtimeHome = await prepareCodexRuntimeHome({
        CODEX_HOME: missingSourceHome,
        HAMMURABI_DATA_DIR: dataDir,
      })

      expect(await readFile(path.join(runtimeHome, 'config.toml'), 'utf8')).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('spawns local Codex app-server in an isolated process group with telemetry disabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-codex-spawn-'))
    const child = createFakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn

    try {
      const sourceHome = path.join(root, 'source')
      const dataDir = path.join(root, 'data')
      await mkdir(sourceHome, { recursive: true })
      await writeFile(path.join(sourceHome, 'auth.json'), '{}')
      await writeFile(path.join(sourceHome, 'config.toml'), '[otel]\nlog_user_prompt = true\n')

      const { process } = await spawnLocalCodexRuntime(spawnImpl, {
        CODEX_HOME: sourceHome,
        HAMMURABI_DATA_DIR: dataDir,
      })

      expect(process).toBe(child)
      expect(spawnImpl).toHaveBeenCalledWith(
        'codex',
        ['app-server', '--listen', expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+$/u)],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
          env: expect.objectContaining({
            ANTHROPIC_MODEL: undefined,
            CODEX_HOME: expect.stringContaining(path.join(dataDir, 'agents', 'codex-runtime-home-')),
            [HAMMURABI_CODEX_AUTH_JSON_B64]: undefined,
            OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
            OTEL_SDK_DISABLED: 'true',
            OTEL_LOGS_EXPORTER: 'none',
            OTEL_METRICS_EXPORTER: 'none',
            OTEL_TRACES_EXPORTER: 'none',
          }),
        }),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('kills local Codex app-server process groups before falling back to the wrapper process', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-codex-kill-group-'))
    try {
      const child = createFakeChildProcess()
      const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
      const { process } = await spawnLocalCodexRuntime(spawnImpl, await createRuntimeEnv(root))
      const killProcess = vi.fn(() => true)

      const killed = killCodexRuntimeProcess(process, 'SIGTERM', { killProcess })

      expect(killed).toBe(true)
      expect(killProcess).toHaveBeenCalledWith(-43210, 'SIGTERM')
      expect(process.kill).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to direct child kill when process-group kill is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-codex-kill-fallback-'))
    try {
      const child = createFakeChildProcess()
      const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
      const { process } = await spawnLocalCodexRuntime(spawnImpl, await createRuntimeEnv(root))
      const killProcess = vi.fn(() => {
        throw new Error('missing process group')
      })

      const killed = killCodexRuntimeProcess(process, 'SIGTERM', { killProcess })

      expect(killed).toBe(true)
      expect(killProcess).toHaveBeenCalledWith(-43210, 'SIGTERM')
      expect(process.kill).toHaveBeenCalledWith('SIGTERM')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

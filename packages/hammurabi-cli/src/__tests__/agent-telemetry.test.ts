import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'smol-toml'
import {
  createHammurabiConfig,
  writeHammurabiConfig,
} from '../config.js'
import { syncManagedAgentTelemetryFromSavedConfig } from '../agent-telemetry.js'

const createdDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
}

async function readToml(filePath: string): Promise<Record<string, unknown>> {
  return parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
}

function expectedCursorEnvKey(): string {
  if (process.platform === 'darwin') return 'terminal.integrated.env.osx'
  if (process.platform === 'win32') return 'terminal.integrated.env.windows'
  return 'terminal.integrated.env.linux'
}

describe('syncManagedAgentTelemetryFromSavedConfig', () => {
  it('writes managed agent telemetry settings from the saved Hammurabi config', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-telemetry-'))
    createdDirectories.push(directory)

    const configPath = path.join(directory, '.hammurabi.json')
    const claudeSettingsPath = path.join(directory, '.claude', 'settings.json')
    const codexConfigPath = path.join(directory, '.codex', 'config.toml')
    const cursorSettingsPath = path.join(directory, '.cursor', 'settings.json')

    const config = createHammurabiConfig({
      endpoint: 'http://localhost:20001',
      apiKey: 'HAM',
      agents: ['claude-code', 'codex', 'cursor', 'anti-gravity'],
      configuredAt: new Date('2026-04-20T12:00:00.000Z'),
    })
    await writeHammurabiConfig(config, configPath)

    const result = await syncManagedAgentTelemetryFromSavedConfig({
      configPath,
      claudeSettingsPath,
      codexConfigPath,
      cursorSettingsPath,
    })

    expect(result.config).toEqual(config)
    expect(result.configured).toEqual(['claude-code', 'codex', 'cursor'])
    expect(result.failed).toEqual([])

    const claudeSettings = await readJson(claudeSettingsPath)
    expect(claudeSettings.env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:20001',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-hammurabi-api-key=HAM',
    })

    const codexSettings = await readToml(codexConfigPath)
    const otel = codexSettings.otel as Record<string, unknown>
    const exporter = otel.exporter as Record<string, Record<string, unknown>>
    expect(exporter['otlp-http'].endpoint).toBe('http://localhost:20001/v1/logs')
    expect(exporter['otlp-http'].headers).toEqual({
      'x-hammurabi-api-key': 'HAM',
    })

    const cursorSettings = await readJson(cursorSettingsPath)
    expect(cursorSettings[expectedCursorEnvKey()]).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:20001',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-hammurabi-api-key=HAM',
    })
  })

  it('does nothing when no saved Hammurabi config exists', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-telemetry-'))
    createdDirectories.push(directory)

    const result = await syncManagedAgentTelemetryFromSavedConfig({
      configPath: path.join(directory, '.missing-hammurabi.json'),
      claudeSettingsPath: path.join(directory, '.claude', 'settings.json'),
      codexConfigPath: path.join(directory, '.codex', 'config.toml'),
      cursorSettingsPath: path.join(directory, '.cursor', 'settings.json'),
    })

    expect(result).toEqual({
      config: null,
      configured: [],
      failed: [],
    })
  })
})

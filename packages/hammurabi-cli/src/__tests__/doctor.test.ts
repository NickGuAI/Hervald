import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHammurabiConfig, writeHammurabiConfig } from '../config'
import { buildDoctorReport, printDoctorReport } from '../doctor'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('doctor', () => {
  it('prints a Sumi-e terminal readiness summary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-doctor-'))
    tempDirs.push(root)
    const appDir = path.join(root, 'apps', 'hammurabi')
    const dataDir = path.join(root, '.hammurabi')
    const envFile = path.join(root, '.hammurabi-env')
    const configPath = path.join(root, '.hammurabi.json')
    await mkdir(appDir, { recursive: true })
    await mkdir(dataDir, { recursive: true })
    await writeFile(path.join(appDir, 'package.json'), '{"name":"hammurabi"}\n', 'utf8')
    await writeFile(envFile, 'CODEX_API_KEY=test\n', 'utf8')
    await writeHammurabiConfig(createHammurabiConfig({
      endpoint: 'http://localhost:20001',
      apiKey: 'test-key',
      agents: ['codex'],
    }), configPath)

    const report = await buildDoctorReport({
      configPath,
      env: {
        ...process.env,
        HAMMURABI_APP_DIR: appDir,
        HAMMURABI_DATA_DIR: dataDir,
        HAMMURABI_LOCAL_MACHINE_ENV_FILE: envFile,
      },
      fetchImpl: async () => new Response(JSON.stringify({
        currentStepId: 'providers-machines',
        providers: [{ label: 'Codex', state: 'ready' }],
        machines: [{ id: 'local', state: 'ready' }],
      }), { status: 200 }) as unknown as Response,
    })

    const chunks: string[] = []
    printDoctorReport(report, (chunk) => {
      chunks.push(chunk)
    })

    const output = chunks.join('')
    expect(output).toContain('Hervald Doctor')
    expect(output).toContain('CLI config')
    expect(output).toContain('Browser onboarding API')
    expect(output).toContain('providers=1 ready')
    expect(output).toContain('Open http://localhost:20001/welcome')
  })

  it('explains empty onboarding API responses with the local app startup step', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-doctor-empty-api-'))
    tempDirs.push(root)
    const appDir = path.join(root, 'apps', 'hammurabi')
    const dataDir = path.join(root, '.hammurabi')
    const envFile = path.join(root, '.hammurabi-env')
    const configPath = path.join(root, '.hammurabi.json')
    await mkdir(appDir, { recursive: true })
    await mkdir(dataDir, { recursive: true })
    await writeFile(path.join(appDir, 'package.json'), '{"name":"hammurabi"}\n', 'utf8')
    await writeFile(envFile, 'CODEX_API_KEY=test\n', 'utf8')
    await writeHammurabiConfig(createHammurabiConfig({
      endpoint: 'http://localhost:20001',
      apiKey: 'test-key',
      agents: ['codex'],
    }), configPath)

    const report = await buildDoctorReport({
      configPath,
      env: {
        ...process.env,
        HAMMURABI_APP_DIR: appDir,
        HAMMURABI_DATA_DIR: dataDir,
        HAMMURABI_LOCAL_MACHINE_ENV_FILE: envFile,
      },
      fetchImpl: async () => new Response('', { status: 200 }) as unknown as Response,
    })

    const chunks: string[] = []
    printDoctorReport(report, (chunk) => {
      chunks.push(chunk)
    })

    const output = chunks.join('')
    expect(output).toContain('Browser onboarding API')
    expect(output).toContain('empty response')
    expect(output).toContain('hammurabi up --dev')
  })
})

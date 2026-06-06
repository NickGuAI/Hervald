import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadCommanderVoiceConfig,
  mergeVoiceConfig,
  normalizeVoiceConfig,
  resolveCommanderVoiceConfigPath,
} from '../voice-config.js'

const COMMANDER_ID = '11111111-1111-4111-8111-111111111111'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('commander voice config paths', () => {
  it('resolves under the commander data root derived from HAMMURABI_DATA_DIR', async () => {
    const dataRoot = await createTempDir('hammurabi-voice-root-')

    expect(resolveCommanderVoiceConfigPath(COMMANDER_ID, {
      HAMMURABI_DATA_DIR: dataRoot,
    } as NodeJS.ProcessEnv)).toBe(
      path.join(dataRoot, 'commander', COMMANDER_ID, 'voice.json'),
    )
  })

  it('honors COMMANDER_DATA_DIR overrides', async () => {
    const dataRoot = await createTempDir('hammurabi-voice-root-')
    const commanderDataDir = path.join(dataRoot, 'custom-commanders')

    expect(resolveCommanderVoiceConfigPath(COMMANDER_ID, {
      HAMMURABI_DATA_DIR: dataRoot,
      COMMANDER_DATA_DIR: commanderDataDir,
    } as NodeJS.ProcessEnv)).toBe(
      path.join(commanderDataDir, COMMANDER_ID, 'voice.json'),
    )
  })

  it('loads the canonical layout without migrating the old root-level layout', async () => {
    const dataRoot = await createTempDir('hammurabi-voice-layouts-')
    const oldPath = path.join(dataRoot, COMMANDER_ID, 'voice.json')
    const canonicalPath = path.join(dataRoot, 'commander', COMMANDER_ID, 'voice.json')

    await mkdir(path.dirname(oldPath), { recursive: true })
    await mkdir(path.dirname(canonicalPath), { recursive: true })
    await writeFile(oldPath, JSON.stringify({ tts: { voice: 'legacy' } }))
    await writeFile(canonicalPath, JSON.stringify({ tts: { voice: 'nova' } }))

    await expect(loadCommanderVoiceConfig(COMMANDER_ID, {
      HAMMURABI_DATA_DIR: dataRoot,
    } as NodeJS.ProcessEnv)).resolves.toEqual({
      tts: { voice: 'nova' },
    })
    await expect(readFile(oldPath, 'utf8')).resolves.toBe(
      JSON.stringify({ tts: { voice: 'legacy' } }),
    )
  })

  it('normalizes and merges STT prompt, model, and terms from commander and conversation config', () => {
    expect(normalizeVoiceConfig({
      stt: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini-transcribe',
        prompt: '  Preserve Columbia AI seminar names.  ',
        terms: [' Hammurabi ', '', 'Gehirn', 'hammurabi'],
      },
    })).toEqual({
      stt: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini-transcribe',
        prompt: 'Preserve Columbia AI seminar names.',
        terms: ['Hammurabi', 'Gehirn', 'hammurabi'],
      },
    })

    expect(mergeVoiceConfig(
      {
        stt: {
          model: 'gpt-4o-transcribe',
          prompt: 'Commander prompt',
          terms: ['Hammurabi', 'Claude Code'],
        },
      },
      {
        stt: {
          prompt: 'Conversation prompt',
          terms: ['PMAI', 'claude code', 'Kubernetes'],
        },
      },
    ).stt).toEqual({
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o-transcribe',
      prompt: 'Conversation prompt',
      terms: ['Hammurabi', 'Claude Code', 'PMAI', 'Kubernetes'],
    })
  })
})

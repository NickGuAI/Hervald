import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultMachineCredentialsKeyPath,
  migrateMachineEnvFiles,
  prepareMachineLaunchEnvironment,
  updateMachineEnvEntries,
} from '../machine-credentials'
import type { MachineConfig } from '../types'

const createdDirectories: string[] = []

let previousDataDir: string | undefined

afterEach(async () => {
  if (previousDataDir === undefined) {
    delete process.env.HAMMURABI_DATA_DIR
  } else {
    process.env.HAMMURABI_DATA_DIR = previousDataDir
  }
  previousDataDir = undefined

  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function createMachine(partial: Partial<MachineConfig> = {}): MachineConfig {
  return {
    id: 'remote-1',
    label: 'Remote 1',
    host: 'remote.test',
    ...partial,
  }
}

describe('agents/machine-credentials', () => {
  it('migrates plaintext local env files to encrypted .enc files and prepares remote SendEnv payloads', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-machine-creds-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const envFilePath = path.join(tempDir, 'machine.env')
    await writeFile(envFilePath, 'FOO=bar\nBAR="baz qux"\n', 'utf8')

    const migrated = await migrateMachineEnvFiles([
      createMachine({ envFile: envFilePath }),
    ])

    expect(migrated.changed).toBe(true)
    const migratedMachine = migrated.machines[0]!
    expect(migratedMachine.envFile).toBe(`${envFilePath}.enc`)
    expect(existsSync(envFilePath)).toBe(false)
    expect(existsSync(migratedMachine.envFile!)).toBe(true)
    expect(existsSync(defaultMachineCredentialsKeyPath())).toBe(true)

    const prepared = prepareMachineLaunchEnvironment(migratedMachine, { PATH: '/usr/bin' })
    expect(prepared.sourcedEnvFile).toBeUndefined()
    expect(prepared.sshSendEnvKeys).toEqual([
      'HAMMURABI_MACHINE_ENV_0000',
      'HAMMURABI_MACHINE_ENV_0001',
    ])
    expect(prepared.env.HAMMURABI_MACHINE_ENV_0000).toBe('FOO=bar')
    expect(prepared.env.HAMMURABI_MACHINE_ENV_0001).toBe('BAR=baz qux')
  })

  it('merges decrypted env entries directly into local launch envs', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-machine-creds-local-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const envFilePath = path.join(tempDir, 'local.env')
    await writeFile(envFilePath, 'OPENAI_API_KEY=sk-test\nMODEL="gpt-5.4"\n', 'utf8')

    const migrated = await migrateMachineEnvFiles([
      createMachine({ host: null, envFile: envFilePath }),
    ])

    const prepared = prepareMachineLaunchEnvironment(migrated.machines[0], { PATH: '/usr/bin' })
    expect(prepared.sshSendEnvKeys).toEqual([])
    expect(prepared.sourcedEnvFile).toBeUndefined()
    expect(prepared.env.OPENAI_API_KEY).toBe('sk-test')
    expect(prepared.env.MODEL).toBe('gpt-5.4')
  })

  it('binds encrypted env files to the machine id-derived key', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-machine-creds-derived-key-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const envFilePath = path.join(tempDir, 'bound.env')
    await writeFile(envFilePath, 'OPENAI_API_KEY=sk-test\n', 'utf8')

    const migrated = await migrateMachineEnvFiles([
      createMachine({ id: 'machine-a', envFile: envFilePath }),
    ])

    expect(() =>
      prepareMachineLaunchEnvironment(
        createMachine({ id: 'machine-b', envFile: migrated.machines[0]!.envFile }),
        { PATH: '/usr/bin' },
      ),
    ).toThrow()
  })

  it('falls back to legacy envFile sourcing when the file is not parseable as key/value data', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-machine-creds-legacy-'))
    createdDirectories.push(tempDir)

    const envFilePath = path.join(tempDir, 'legacy.sh')
    await writeFile(envFilePath, 'export OPENAI_API_KEY=sk-test\n. "$HOME/.extra-env"\n', 'utf8')

    const migrated = await migrateMachineEnvFiles([
      createMachine({ envFile: envFilePath }),
    ])

    expect(migrated.changed).toBe(false)
    const prepared = prepareMachineLaunchEnvironment(migrated.machines[0], { PATH: '/usr/bin' })
    expect(prepared.sshSendEnvKeys).toEqual([])
    expect(prepared.sourcedEnvFile).toBe(envFilePath)
    expect(prepared.env.OPENAI_API_KEY).toBeUndefined()
  })

  it('updateMachineEnvEntries preserves the encrypted format when adding a key to a migrated env file', async () => {
    // Regression for codex-review on PR #1269: writing the auth-setup token must NOT clobber the
    // encrypted record with shell text. Round-trip via prepareMachineLaunchEnvironment proves
    // the file is still valid encrypted JSON afterwards.
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-update-env-enc-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const initialPlaintext = path.join(tempDir, 'machine.env')
    await writeFile(initialPlaintext, 'OPENAI_API_KEY=sk-existing\n', 'utf8')

    const migrated = await migrateMachineEnvFiles([
      createMachine({ host: null, envFile: initialPlaintext }),
    ])
    const machine = migrated.machines[0]!
    expect(machine.envFile).toBe(`${initialPlaintext}.enc`)

    await updateMachineEnvEntries(machine, machine.envFile!, {
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test-value',
    })

    // File on disk must still parse as an encrypted record, not as plaintext shell.
    const onDisk = await readFile(machine.envFile!, 'utf8')
    const parsed = JSON.parse(onDisk) as Record<string, unknown>
    expect(parsed.version).toBe(1)
    expect(typeof parsed.iv).toBe('string')
    expect(typeof parsed.authTag).toBe('string')
    expect(typeof parsed.ciphertext).toBe('string')

    // Decryption round-trip carries both the original key and the new one.
    const prepared = prepareMachineLaunchEnvironment(machine, { PATH: '/usr/bin' })
    expect(prepared.env.OPENAI_API_KEY).toBe('sk-existing')
    expect(prepared.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test-value')
  })

  it('updateMachineEnvEntries removes a key when value is null on an encrypted env file', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-update-env-enc-delete-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const initialPlaintext = path.join(tempDir, 'machine.env')
    await writeFile(
      initialPlaintext,
      'OPENAI_API_KEY=sk-existing\nGEMINI_API_KEY=ai-test\n',
      'utf8',
    )

    const migrated = await migrateMachineEnvFiles([
      createMachine({ host: null, envFile: initialPlaintext }),
    ])
    const machine = migrated.machines[0]!

    await updateMachineEnvEntries(machine, machine.envFile!, {
      OPENAI_API_KEY: null,
    })

    const prepared = prepareMachineLaunchEnvironment(machine, { PATH: '/usr/bin' })
    expect(prepared.env.OPENAI_API_KEY).toBeUndefined()
    expect(prepared.env.GEMINI_API_KEY).toBe('ai-test')
  })

  it('updateMachineEnvEntries writes plaintext format when env file is not .enc', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-update-env-plain-'))
    createdDirectories.push(tempDir)

    const envFilePath = path.join(tempDir, 'machine.env')
    await writeFile(envFilePath, 'OPENAI_API_KEY=sk-existing\n', 'utf8')

    await updateMachineEnvEntries(
      createMachine({ host: null, envFile: envFilePath }),
      envFilePath,
      { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-plain-value' },
    )

    const onDisk = await readFile(envFilePath, 'utf8')
    expect(onDisk).toContain('export OPENAI_API_KEY=')
    expect(onDisk).toContain('export CLAUDE_CODE_OAUTH_TOKEN=')
    // Confirm it's NOT encrypted JSON.
    expect(() => JSON.parse(onDisk)).toThrow()
  })

  it('updateMachineEnvEntries creates the encrypted env file when it does not yet exist', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-update-env-create-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const encPath = path.join(tempDir, 'machine.env.enc')
    expect(existsSync(encPath)).toBe(false)

    await updateMachineEnvEntries(
      createMachine({ host: null, id: 'fresh-machine', envFile: encPath }),
      encPath,
      { OPENAI_API_KEY: 'sk-fresh' },
    )

    expect(existsSync(encPath)).toBe(true)
    const prepared = prepareMachineLaunchEnvironment(
      createMachine({ host: null, id: 'fresh-machine', envFile: encPath }),
      { PATH: '/usr/bin' },
    )
    expect(prepared.env.OPENAI_API_KEY).toBe('sk-fresh')
  })

  it('treats a missing .enc env file as empty entries (no throw, no spurious entries)', () => {
    // Regression for codex-review on PR #1270: a stale registry pointing at
    // a deleted .enc file must NOT abort the auth-status probe. Old behavior
    // shell-sourced via `. <file> || true` which silently no-op'd; new
    // behavior must mirror that with structured empty-entries.
    const stalePath = path.join(tmpdir(), `hammurabi-missing-enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.enc`)
    const machine: MachineConfig = {
      id: 'stale-registry-machine',
      label: 'Stale',
      host: null,
      envFile: stalePath,
    }

    const prepared = prepareMachineLaunchEnvironment(machine, { PATH: '/usr/bin' })
    expect(prepared.env.PATH).toBe('/usr/bin')
    expect(prepared.env.OPENAI_API_KEY).toBeUndefined()
    expect(prepared.sshSendEnvKeys).toEqual([])
    expect(prepared.sourcedEnvFile).toBeUndefined()
  })

  it('treats a missing .enc env file as empty entries on remote machines too', () => {
    // Same scenario for remote: a stale envFile pointer must not block SSH
    // auth-status probes. The remote bootstrap decoder simply has nothing
    // to forward.
    const stalePath = path.join(tmpdir(), `hammurabi-missing-enc-remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.enc`)
    const machine: MachineConfig = {
      id: 'stale-remote-machine',
      label: 'Stale Remote',
      host: 'remote.test',
      user: 'tester',
      envFile: stalePath,
    }

    const prepared = prepareMachineLaunchEnvironment(machine, { PATH: '/usr/bin' })
    expect(prepared.sshSendEnvKeys).toEqual([])
    expect(prepared.env.PATH).toBe('/usr/bin')
  })

  it('still throws on invalid encrypted env JSON (corruption is not silently swallowed)', async () => {
    // Invariant: ENOENT is the ONLY swallowed error. Real corruption — bad
    // JSON, wrong key, schema mismatch — must still surface so an operator
    // sees the problem instead of silently launching with no credentials.
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-corrupt-enc-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const encPath = path.join(tempDir, 'corrupt.env.enc')
    await writeFile(encPath, 'not-valid-json{{{', 'utf8')

    expect(() =>
      prepareMachineLaunchEnvironment(
        createMachine({ host: null, id: 'corrupt-machine', envFile: encPath }),
        { PATH: '/usr/bin' },
      ),
    ).toThrow()
  })

  it('does NOT read remote plaintext envFile locally even when the same path exists on the Hammurabi host', async () => {
    // Regression for codex-review on PR #1270: a remote machine's plaintext
    // envFile path may coincidentally exist on EC2. The old code read it
    // locally and forwarded via SSH SendEnv, silently bypassing the remote's
    // actual env file (and risking leaking unrelated local secrets to remote).
    // Correct behavior: remote + plaintext envFile = "shell-source on remote";
    // never read locally. `.enc` is the only local-managed channel.
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-remote-plaintext-'))
    createdDirectories.push(tempDir)

    const sharedPath = path.join(tempDir, '.hammurabi-env')
    await writeFile(sharedPath, 'LOCAL_ONLY_SECRET=ec2-decoy\nUNRELATED_KEY=do-not-leak\n', 'utf8')

    const remoteMachine: MachineConfig = {
      id: 'remote-with-coincident-path',
      label: 'Remote',
      host: 'remote.test',
      user: 'tester',
      envFile: sharedPath,
    }

    const prepared = prepareMachineLaunchEnvironment(remoteMachine, { PATH: '/usr/bin' })

    // Critical: local file must NOT be read and forwarded.
    expect(prepared.sshSendEnvKeys).toEqual([])
    expect(prepared.env.LOCAL_ONLY_SECRET).toBeUndefined()
    expect(prepared.env.UNRELATED_KEY).toBeUndefined()
    // Remote bootstrap should shell-source the path on the remote host.
    expect(prepared.sourcedEnvFile).toBe(sharedPath)
  })

  it('preserves empty-value entries through encrypted re-write (KEY= round-trips)', async () => {
    // Regression for codex-review on PR #1270: serializer used to drop
    // entries with empty value, silently removing `KEY=` lines on unrelated
    // auth updates. Operators rely on `KEY=` to clear inherited settings.
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-empty-value-roundtrip-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const initialPlaintext = path.join(tempDir, 'has-empty.env')
    // Note: `EXPLICIT_EMPTY=` with no value is valid shell + valid env-file.
    await writeFile(
      initialPlaintext,
      'OPENAI_API_KEY=sk-real\nEXPLICIT_EMPTY=\n',
      'utf8',
    )

    const migrated = await migrateMachineEnvFiles([
      createMachine({ host: null, envFile: initialPlaintext }),
    ])
    const machine = migrated.machines[0]!

    // Unrelated update — should NOT drop EXPLICIT_EMPTY.
    await updateMachineEnvEntries(machine, machine.envFile!, {
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test',
    })

    const prepared = prepareMachineLaunchEnvironment(machine, { PATH: '/usr/bin' })
    expect(prepared.env.OPENAI_API_KEY).toBe('sk-real')
    expect(prepared.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test')
    // EXPLICIT_EMPTY is preserved as the empty string.
    expect(prepared.env.EXPLICIT_EMPTY).toBe('')
  })

  it('updateMachineEnvEntries treats null as delete and empty string as set-to-empty', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-null-vs-empty-'))
    createdDirectories.push(tempDir)
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = path.join(tempDir, '.hammurabi')

    const initialPlaintext = path.join(tempDir, 'machine.env')
    await writeFile(initialPlaintext, 'A=alpha\nB=bravo\nC=charlie\n', 'utf8')

    const migrated = await migrateMachineEnvFiles([
      createMachine({ host: null, envFile: initialPlaintext }),
    ])
    const machine = migrated.machines[0]!

    await updateMachineEnvEntries(machine, machine.envFile!, {
      A: null,   // delete
      B: '',     // set to empty (preserve B= line)
      // C unchanged (preserved as 'charlie')
    })

    const prepared = prepareMachineLaunchEnvironment(machine, { PATH: '/usr/bin' })
    expect(prepared.env.A).toBeUndefined()
    expect(prepared.env.B).toBe('')
    expect(prepared.env.C).toBe('charlie')
  })
})

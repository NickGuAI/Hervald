import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCodexAppServerInvocation,
  buildCodexRuntimeEnv,
  buildSshArgs,
  buildTailscalePingArgs,
  createMachineRegistryStore,
  parseTailscalePingOutput,
} from '../machines'
import type { MachineConfig } from '../types'

const remoteMachine: MachineConfig & { host: string } = {
  id: 'yus-mac-mini',
  label: "Yu's Mac Mini",
  host: 'yus-mac-mini',
  user: 'yugu',
  cwd: '/Users/yugu/Desktop',
  envFile: '/Users/yugu/.hammurabi-env',
}

function expectControlMasterOptions(args: string[]) {
  expect(args).toContain('ControlMaster=auto')
  expect(args).toContain('ControlPersist=600')
  expect(args.find((arg) => arg.startsWith('ControlPath='))).toMatch(/ControlPath=.*ssh-control\/%C$/)
}

describe('agents/machines: buildSshArgs', () => {
  it('prefers the tailscale hostname when building the SSH destination', () => {
    const args = buildSshArgs(
      { ...remoteMachine, host: '100.101.102.103', tailscaleHostname: 'yus-mac-mini.tail2bb6ea.ts.net' },
      'echo hello',
      false,
    )
    expectControlMasterOptions(args)
    expect(args.at(-2)).toBe('yugu@yus-mac-mini.tail2bb6ea.ts.net')
    expect(args.at(-1)).toBe('echo hello')
  })

  it('emits a minimal SSH command with no approval bridge', () => {
    const args = buildSshArgs(remoteMachine, 'echo hello', false)
    expectControlMasterOptions(args)
    expect(args.at(-2)).toBe('yugu@yus-mac-mini')
    expect(args.at(-1)).toBe('echo hello')
  })

  it('forwards the SSH port flag when machine.port is set', () => {
    const args = buildSshArgs(
      { ...remoteMachine, port: 2222 },
      'echo hello',
      false,
    )
    expectControlMasterOptions(args)
    expect(args).toContain('-p')
    expect(args).toContain('2222')
    expect(args.at(-2)).toBe('yugu@yus-mac-mini')
    expect(args.at(-1)).toBe('echo hello')
  })

  it('emits -tt when interactive is true', () => {
    const args = buildSshArgs(remoteMachine, 'echo hello', true)
    expect(args[0]).toBe('-tt')
    expectControlMasterOptions(args)
    expect(args.at(-2)).toBe('yugu@yus-mac-mini')
    expect(args.at(-1)).toBe('echo hello')
  })

  describe('with approvalBridge', () => {
    it('reverse-tunnels the approval daemon via -R 127.0.0.1:<port>:127.0.0.1:<port> bound to remote loopback only', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: 20001,
        internalToken: 'tok-abc',
      })
      expect(args).toContain('-R')
      const rIdx = args.indexOf('-R')
      expect(args[rIdx + 1]).toBe('127.0.0.1:20001:127.0.0.1:20001')
    })

    it('propagates HAMMURABI_INTERNAL_TOKEN via -o SendEnv when token is provided without leaking the value into argv', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: 20001,
        internalToken: 'tok-abc',
      })
      expect(args).toContain('-o')
      expect(args).toContain('SendEnv=HAMMURABI_INTERNAL_TOKEN')
      expect(args.join(' ')).not.toContain('tok-abc')
    })

    it('omits the SendEnv token flag when no token is provided (tunnel still established for daemon reachability)', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: 20001,
      })
      expect(args).toContain('-R')
      expect(args.find((arg) => arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN')).toBeUndefined()
    })

    it('places approvalBridge flags before the user@host destination so SSH parses them as options', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: 20001,
        internalToken: 'tok-abc',
      })
      const rIdx = args.indexOf('-R')
      const sendEnvIdx = args.findIndex((arg) => arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN')
      const destinationIdx = args.indexOf('yugu@yus-mac-mini')
      const commandIdx = args.indexOf('claude')
      expect(rIdx).toBeGreaterThan(-1)
      expect(sendEnvIdx).toBeGreaterThan(-1)
      expect(destinationIdx).toBeGreaterThan(-1)
      expect(commandIdx).toBeGreaterThan(-1)
      expect(rIdx).toBeLessThan(destinationIdx)
      expect(sendEnvIdx).toBeLessThan(destinationIdx)
      expect(destinationIdx).toBeLessThan(commandIdx)
    })

    it('honors a custom port consistently in the reverse-tunnel argument', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: 20002,
        internalToken: 'tok-abc',
      })
      const rIdx = args.indexOf('-R')
      expect(args[rIdx + 1]).toBe('127.0.0.1:20002:127.0.0.1:20002')
    })

    it('accepts string port values without changing the bind format', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: '20003',
        internalToken: 'tok-abc',
      })
      const rIdx = args.indexOf('-R')
      expect(args[rIdx + 1]).toBe('127.0.0.1:20003:127.0.0.1:20003')
    })

    it('coexists with machine.port (SSH connection port) and -tt without conflict', () => {
      const args = buildSshArgs(
        { ...remoteMachine, port: 2222 },
        'claude',
        true,
        { port: 20001, internalToken: 'tok-abc' },
      )
      // Order: -tt, then hardening options, then -p 2222, then -R + SendEnv, then destination, then command.
      expect(args[0]).toBe('-tt')
      expectControlMasterOptions(args)
      expect(args).toContain('-p')
      expect(args).toContain('2222')
      expect(args).toContain('-R')
      expect(args).toContain('SendEnv=HAMMURABI_INTERNAL_TOKEN')
      expect(args.indexOf('-R')).toBeGreaterThan(args.indexOf('2222'))
      const destinationIdx = args.indexOf('yugu@yus-mac-mini')
      expect(args.indexOf('-R')).toBeLessThan(destinationIdx)
    })

    it('does not leak whitespace-padded internal token values into argv', () => {
      const args = buildSshArgs(remoteMachine, 'claude', false, {
        port: 20001,
        internalToken: '  tok-with-spaces  ',
      })
      expect(args).toContain('SendEnv=HAMMURABI_INTERNAL_TOKEN')
      expect(args.join(' ')).not.toContain('tok-with-spaces')
    })

    it('emits additional SendEnv flags for machine credential transport before the destination', () => {
      const args = buildSshArgs(
        remoteMachine,
        'claude',
        false,
        { port: 20001, internalToken: 'tok-abc' },
        ['HAMMURABI_MACHINE_ENV_0000', 'HAMMURABI_MACHINE_ENV_0001'],
      )
      const destinationIdx = args.indexOf('yugu@yus-mac-mini')
      const credentialSendEnvIdx = args.findIndex((arg) => arg === 'SendEnv=HAMMURABI_MACHINE_ENV_0000')
      expect(credentialSendEnvIdx).toBeGreaterThan(-1)
      expect(credentialSendEnvIdx).toBeLessThan(destinationIdx)
    })
  })
})

describe('agents/machines: tailscale helpers', () => {
  it('builds a single-shot tailscale ping command', () => {
    expect(buildTailscalePingArgs('home-mac.tail2bb6ea.ts.net.')).toEqual([
      'ping',
      '--c',
      '1',
      '--timeout',
      '5s',
      'home-mac.tail2bb6ea.ts.net',
    ])
  })

  it('parses the resolved IP from tailscale ping output', () => {
    expect(
      parseTailscalePingOutput(
        'pong from home-mac.tail2bb6ea.ts.net (100.101.102.103) via DERP(sea) in 18ms',
      ),
    ).toBe('100.101.102.103')
  })
})

describe('agents/machines: registry defaults', () => {
  const tempDirs: string[] = []

  async function createRegistryPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-default-local-machine-'))
    tempDirs.push(dir)
    return join(dir, 'machines.json')
  }

  it('exposes the backend-owned local machine when the registry file is missing', async () => {
    const store = createMachineRegistryStore(await createRegistryPath())

    await expect(store.readMachineRegistry()).resolves.toEqual([
      { id: 'local', label: 'Local (this server)', host: null },
    ])
  })

  it('preserves the local machine when writing a registry that only contains remotes', async () => {
    const store = createMachineRegistryStore(await createRegistryPath())

    await expect(store.writeMachineRegistry([
      { id: 'gpu-1', label: 'GPU', host: '10.0.1.50' },
    ])).resolves.toEqual([
      { id: 'local', label: 'Local (this server)', host: null },
      { id: 'gpu-1', label: 'GPU', host: '10.0.1.50' },
    ])
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    )
  })
})

describe('agents/machines: Codex runtime environment', () => {
  it('disables inherited OTEL export and model overrides for Codex app-server children', () => {
    const env = buildCodexRuntimeEnv({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'claude-opus-4-6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://hervald.gehirn.ai/v1',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer stale',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_SDK_DISABLED: 'false',
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.OPENAI_API_KEY).toBe('sk-test')
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined()
    expect(env.OTEL_SDK_DISABLED).toBe('true')
    expect(env.OTEL_LOGS_EXPORTER).toBe('none')
    expect(env.OTEL_METRICS_EXPORTER).toBe('none')
    expect(env.OTEL_TRACES_EXPORTER).toBe('none')
  })

  it('builds remote Codex app-server commands with telemetry disabled on the target shell', () => {
    const invocation = buildCodexAppServerInvocation('stdio://')

    expect(invocation).toContain('unset ANTHROPIC_MODEL')
    expect(invocation).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
    expect(invocation).toContain('export OTEL_SDK_DISABLED=true')
    expect(invocation).toContain('OTEL_LOGS_EXPORTER=none')
    expect(invocation).toContain('OTEL_METRICS_EXPORTER=none')
    expect(invocation).toContain('OTEL_TRACES_EXPORTER=none')
    expect(invocation).toContain("codex app-server --listen 'stdio://'")
  })
})

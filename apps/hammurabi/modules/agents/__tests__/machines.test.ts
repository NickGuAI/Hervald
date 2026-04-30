import { describe, expect, it } from 'vitest'
import {
  buildSshArgs,
  buildTailscalePingArgs,
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

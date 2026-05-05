import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runMachinesCli } from '../machines.js'

interface BufferWriter {
  writer: { write: (chunk: string) => boolean }
  read: () => string
}

function createBufferWriter(): BufferWriter {
  let buffer = ''
  return {
    writer: {
      write(chunk: string): boolean {
        buffer += chunk
        return true
      },
    },
    read(): string {
      return buffer
    },
  }
}

const config = createHammurabiConfig({
  endpoint: 'https://hervald.gehirn.ai',
  apiKey: 'hmrb_test_key',
  agents: ['claude-code'],
  configuredAt: new Date('2026-03-01T00:00:00.000Z'),
})

const providerRegistryPayload = [
  {
    id: 'claude',
    label: 'Claude',
    eventProvider: 'claude',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    machineAuth: {
      cliBinaryName: 'claude',
      installPackageName: '@anthropic-ai/claude-code',
      authEnvKeys: ['CLAUDE_CODE_OAUTH_TOKEN'],
      supportedAuthModes: ['setup-token'],
      requiresSecretModes: ['setup-token'],
      loginStatusCommand: 'claude auth status',
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    eventProvider: 'codex',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    machineAuth: {
      cliBinaryName: 'codex',
      installPackageName: '@openai/codex',
      authEnvKeys: ['OPENAI_API_KEY'],
      supportedAuthModes: ['api-key', 'device-auth'],
      requiresSecretModes: ['api-key'],
      loginStatusCommand: 'codex login status',
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    eventProvider: 'gemini',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    machineAuth: {
      cliBinaryName: 'gemini',
      installPackageName: '@google/gemini-cli',
      authEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      supportedAuthModes: ['api-key'],
      requiresSecretModes: ['api-key'],
      loginStatusCommand: null,
    },
  },
]

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createProviderAwareFetch(
  handlers: Record<string, Response>,
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input)
    if (url === 'https://hervald.gehirn.ai/api/providers') {
      return jsonResponse(providerRegistryPayload)
    }
    const response = handlers[url]
    if (response) {
      return response
    }
    throw new Error(`Unexpected URL: ${url}`)
  })
}

describe('runMachinesCli', () => {
  it('lists registered machines in table form', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 'local', label: 'Local', host: null },
          { id: 'gpu-1', label: 'GPU', host: '10.0.1.50', port: 22, cwd: '/srv/workspace' },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(['list'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('ID')
    expect(stdout.read()).toContain('local')
    expect(stdout.read()).toContain('gpu-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/machines',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('adds a machine through the API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'gpu-2',
          label: 'GPU 2',
          host: '10.0.1.60',
          user: 'builder',
          port: 2222,
          cwd: '/srv/workspace',
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(
      ['add', '--id', 'gpu-2', '--label', 'GPU 2', '--host', '10.0.1.60', '--user', 'builder', '--port', '2222', '--cwd', '/srv/workspace'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Registered machine: gpu-2')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/machines',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          id: 'gpu-2',
          label: 'GPU 2',
          host: '10.0.1.60',
          user: 'builder',
          port: 2222,
          cwd: '/srv/workspace',
        }),
      }),
    )
  })

  it('adds a tailscale worker through the API without requiring a raw host', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'home-mac',
          label: 'Home Mac',
          host: '100.101.102.103',
          tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
          user: 'yugu',
          cwd: '/Users/yugu',
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(
      ['add', '--id', 'home-mac', '--label', 'Home Mac', '--tailscale-hostname', 'home-mac.tail2bb6ea.ts.net', '--user', 'yugu', '--cwd', '/Users/yugu'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Registered machine: home-mac')
    expect(stdout.read()).toContain('Host: home-mac.tail2bb6ea.ts.net')
    expect(stdout.read()).toContain('Resolved IP: 100.101.102.103')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/machines',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          id: 'home-mac',
          label: 'Home Mac',
          tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
          user: 'yugu',
          cwd: '/Users/yugu',
        }),
      }),
    )
  })

  it('prints machine health for check', async () => {
    const fetchImpl = createProviderAwareFetch({
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/health': jsonResponse({
        machineId: 'gpu-1',
        mode: 'ssh',
        ssh: {
          ok: true,
          destination: 'builder@10.0.1.50',
        },
        tools: {
          claude: { ok: true, version: '1.0.31', raw: '1.0.31' },
          codex: { ok: false, version: null, raw: 'missing' },
          gemini: { ok: true, version: '0.1.18', raw: '0.1.18' },
          git: { ok: true, version: 'git version 2.45.1', raw: 'git version 2.45.1' },
          node: { ok: true, version: 'v22.14.0', raw: 'v22.14.0' },
        },
      }),
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(['check', 'gpu-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Machine: gpu-1')
    expect(stdout.read()).toContain('SSH: ok (builder@10.0.1.50)')
    expect(stdout.read()).toContain('- gemini: 0.1.18')
    expect(stdout.read()).toContain('- codex: missing')
  })

  it('removes a machine through the API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(['remove', 'gpu-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Removed machine: gpu-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('bootstraps a remote machine and prints service health proof', async () => {
    const fetchImpl = createProviderAwareFetch({
      'https://hervald.gehirn.ai/api/agents/machines': jsonResponse([
        {
          id: 'gpu-1',
          label: 'GPU',
          host: '10.0.1.50',
          user: 'builder',
          port: 2222,
        },
      ]),
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/health': jsonResponse({
        machineId: 'gpu-1',
        mode: 'ssh',
        ssh: {
          ok: true,
          destination: 'builder@10.0.1.50',
        },
        tools: {
          claude: { ok: true, version: '1.0.31', raw: '1.0.31' },
          codex: { ok: true, version: '0.1.2503271400', raw: '0.1.2503271400' },
          gemini: { ok: true, version: '0.1.18', raw: '0.1.18' },
          git: { ok: true, version: 'git version 2.45.1', raw: 'git version 2.45.1' },
          node: { ok: true, version: 'v22.14.0', raw: 'v22.14.0' },
        },
      }),
    })
    const runCommand = vi.fn().mockResolvedValue({
      stdout: 'telemetry:configured\ninstalled:claude:1.0.31\ninstalled:codex:0.1.2503271400\nbootstrap:ok\n',
      stderr: '',
      code: 0,
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(['bootstrap', 'gpu-1'], {
      fetchImpl,
      readConfig: async () => config,
      runCommand,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(runCommand).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining([
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '-p',
        '2222',
        'builder@10.0.1.50',
      ]),
      expect.objectContaining({
        timeoutMs: 300000,
      }),
    )
    const remoteCommand = runCommand.mock.calls[0]?.[1]?.at(-1) as string
    expect(remoteCommand).toContain('/bin/bash -lc')
    expect(remoteCommand).toContain('ensure_path_block "$HOME/.zshrc"')
    expect(remoteCommand).toContain('@anthropic-ai/claude-code')
    expect(remoteCommand).toContain('@openai/codex')
    expect(remoteCommand).toContain('@google/gemini-cli')
    expect(remoteCommand).toContain('AcceptEnv HAMMURABI_INTERNAL_TOKEN HAMMURABI_MACHINE_ENV_*')
    expect(remoteCommand).toContain('MaxStartups 20:30:200')
    expect(stdout.read()).toContain('Service health after bootstrap:')
    expect(stdout.read()).toContain('Machine: gpu-1')
    expect(stdout.read()).toContain('passwordless sudo')
    expect(stdout.read()).toContain('Next steps:')
    expect(stdout.read()).toContain('hammurabi machine auth-status --machine gpu-1')
  })

  it('surfaces a loud post-bootstrap warning when sshd hardening was skipped due to no passwordless sudo', async () => {
    // Codex audit on PR #1269: when the bootstrap script's `configure_sshd_hardening`
    // hits `sudo -n true` failure it emits `sshd:skipped:no-sudo` and continues.
    // Without remote `AcceptEnv HAMMURABI_INTERNAL_TOKEN HAMMURABI_MACHINE_ENV_*`,
    // the Claude approval bridge breaks downstream — operator must see this loudly.
    const fetchImpl = createProviderAwareFetch({
      'https://hervald.gehirn.ai/api/agents/machines': jsonResponse([
        {
          id: 'gpu-1',
          label: 'GPU',
          host: '10.0.1.50',
          user: 'builder',
          port: 2222,
        },
      ]),
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/health': jsonResponse({
        machineId: 'gpu-1',
        mode: 'ssh',
        ssh: { ok: true, destination: 'builder@10.0.1.50' },
        tools: {
          claude: { ok: true, version: '1.0.31', raw: '1.0.31' },
          codex: { ok: true, version: '0.1.2503271400', raw: '0.1.2503271400' },
          gemini: { ok: true, version: '0.1.18', raw: '0.1.18' },
          git: { ok: true, version: 'git version 2.45.1', raw: 'git version 2.45.1' },
          node: { ok: true, version: 'v22.14.0', raw: 'v22.14.0' },
        },
      }),
    })
    const runCommand = vi.fn().mockResolvedValue({
      stdout: [
        'sshd:skipped:no-sudo',
        'telemetry:configured',
        'installed:claude:1.0.31',
        'installed:codex:0.1.2503271400',
        'bootstrap:ok',
        '',
      ].join('\n'),
      stderr: '',
      code: 0,
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(['bootstrap', 'gpu-1'], {
      fetchImpl,
      readConfig: async () => config,
      runCommand,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    const out = stdout.read()
    // Loud warning header is present — operator can't miss it.
    expect(out).toContain('Remote sshd hardening was NOT applied')
    // Specific consequence is named.
    expect(out).toContain('Claude approval-bridge token cannot reach the PreToolUse hook')
    expect(out).toContain('approval service unreachable')
    // Manual sshd_config remediation is provided verbatim so operator can copy-paste.
    expect(out).toContain('AcceptEnv HAMMURABI_INTERNAL_TOKEN HAMMURABI_MACHINE_ENV_*')
    expect(out).toContain('MaxStartups 20:30:200')
    expect(out).toContain('hammurabi machine bootstrap gpu-1')
  })

  it('does NOT surface the sshd-hardening warning when bootstrap successfully configured sshd', async () => {
    // Negative case: when `sshd:configured:changed` (or unchanged) is in the
    // bootstrap output, the warning must NOT fire — the hardening was applied.
    const fetchImpl = createProviderAwareFetch({
      'https://hervald.gehirn.ai/api/agents/machines': jsonResponse([
        { id: 'gpu-1', label: 'GPU', host: '10.0.1.50', user: 'builder', port: 2222 },
      ]),
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/health': jsonResponse({
        machineId: 'gpu-1',
        mode: 'ssh',
        ssh: { ok: true, destination: 'builder@10.0.1.50' },
        tools: {
          claude: { ok: true, version: '1.0.31', raw: '1.0.31' },
          codex: { ok: true, version: '0.1.2503271400', raw: '0.1.2503271400' },
          gemini: { ok: true, version: '0.1.18', raw: '0.1.18' },
          git: { ok: true, version: 'git version 2.45.1', raw: 'git version 2.45.1' },
          node: { ok: true, version: 'v22.14.0', raw: 'v22.14.0' },
        },
      }),
    })
    const runCommand = vi.fn().mockResolvedValue({
      stdout: 'sshd:configured:changed\ntelemetry:configured\ninstalled:claude:1.0.31\nbootstrap:ok\n',
      stderr: '',
      code: 0,
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    await runMachinesCli(['bootstrap', 'gpu-1'], {
      fetchImpl,
      readConfig: async () => config,
      runCommand,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    const out = stdout.read()
    expect(out).not.toContain('Remote sshd hardening was NOT applied')
  })

  it('rejects add when host incorrectly includes user@host syntax', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(
      ['add', '--id', 'gpu-2', '--label', 'GPU 2', '--host', 'builder@10.0.1.60'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Invalid add arguments.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects add when both host and tailscale hostname are provided', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(
      ['add', '--id', 'gpu-2', '--label', 'GPU 2', '--host', '10.0.1.60', '--tailscale-hostname', 'gpu-2.tail.ts.net'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Invalid add arguments.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('prints provider auth status for a worker', async () => {
    const fetchImpl = createProviderAwareFetch({
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/auth-status': jsonResponse({
        machineId: 'gpu-1',
        envFile: '/Users/builder/.hammurabi-env',
        checkedAt: '2026-04-29T18:00:00.000Z',
        providers: {
          claude: {
            provider: 'claude',
            label: 'Claude',
            installed: true,
            version: '1.0.31',
            envConfigured: true,
            envSourceKey: 'CLAUDE_CODE_OAUTH_TOKEN',
            loginConfigured: false,
            configured: true,
            currentMethod: 'setup-token',
            verificationCommand: 'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status)',
          },
          codex: {
            provider: 'codex',
            label: 'Codex',
            installed: true,
            version: '0.1.2503271400',
            envConfigured: false,
            envSourceKey: null,
            loginConfigured: true,
            configured: true,
            currentMethod: 'device-auth',
            verificationCommand: 'codex --version && (test -n "$OPENAI_API_KEY" || codex login status)',
          },
          gemini: {
            provider: 'gemini',
            label: 'Gemini',
            installed: false,
            version: null,
            envConfigured: false,
            envSourceKey: null,
            loginConfigured: false,
            configured: false,
            currentMethod: 'missing',
            verificationCommand: 'gemini --version && (test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY")',
          },
        },
      }),
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(['auth-status', '--machine', 'gpu-1'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Machine: gpu-1')
    expect(stdout.read()).toContain('Env file: /Users/builder/.hammurabi-env')
    expect(stdout.read()).toContain('- Claude: ready (setup-token)')
    expect(stdout.read()).toContain('- Gemini: missing (missing)')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/auth-status',
      expect.objectContaining({
        method: 'GET',
      }),
    )
  })

  it('posts provider auth setup and prints the updated status', async () => {
    const fetchImpl = createProviderAwareFetch({
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/auth-setup': jsonResponse({
        machineId: 'gpu-1',
        envFile: '/Users/builder/.hammurabi-env',
        checkedAt: '2026-04-29T18:00:00.000Z',
        providers: {
          claude: {
            provider: 'claude',
            label: 'Claude',
            installed: true,
            version: '1.0.31',
            envConfigured: true,
            envSourceKey: 'CLAUDE_CODE_OAUTH_TOKEN',
            loginConfigured: false,
            configured: true,
            currentMethod: 'setup-token',
            verificationCommand: 'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status)',
          },
          codex: {
            provider: 'codex',
            label: 'Codex',
            installed: true,
            version: '0.1.2503271400',
            envConfigured: false,
            envSourceKey: null,
            loginConfigured: false,
            configured: false,
            currentMethod: 'missing',
            verificationCommand: 'codex --version && (test -n "$OPENAI_API_KEY" || codex login status)',
          },
          gemini: {
            provider: 'gemini',
            label: 'Gemini',
            installed: true,
            version: '0.1.18',
            envConfigured: false,
            envSourceKey: null,
            loginConfigured: false,
            configured: false,
            currentMethod: 'missing',
            verificationCommand: 'gemini --version && (test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY")',
          },
        },
      }),
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runMachinesCli(
      ['auth-setup', '--machine', 'gpu-1', '--provider', 'claude', '--mode', 'setup-token', '--secret', 'claude-token-value'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Updated claude auth on gpu-1.')
    expect(stdout.read()).toContain('- Claude: ready (setup-token)')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/machines/gpu-1/auth-setup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          provider: 'claude',
          mode: 'setup-token',
          secret: 'claude-token-value',
        }),
      }),
    )
  })
})

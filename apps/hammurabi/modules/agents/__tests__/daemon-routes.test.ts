import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket, type RawData } from 'ws'
import {
  AUTH_HEADERS,
  connectWs,
  createMissingMachinesRegistryPath,
  startServer,
} from './routes-test-harness'

async function waitForOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, response) => {
      reject(new Error(`Unexpected response ${response.statusCode}`))
    })
  })
}

async function waitForMessage<T>(ws: WebSocket, predicate: (value: T) => boolean): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      ws.off('message', onMessage)
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for daemon message'))
    }, 8_000)
    const onMessage = (raw: RawData) => {
      const parsed = JSON.parse(raw.toString()) as T
      if (!predicate(parsed)) {
        return
      }
      cleanup()
      resolve(parsed)
    }
    ws.on('message', onMessage)
  })
}

async function waitForSessionText(ws: WebSocket, expected: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      ws.off('message', onMessage)
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for session text: ${expected}`))
    }, 8_000)
    const onMessage = (raw: RawData) => {
      const text = raw.toString()
      if (!text.includes(expected)) {
        return
      }
      cleanup()
      resolve(text)
    }
    ws.on('message', onMessage)
  })
}

async function expectNoSessionText(ws: WebSocket, unexpected: string, durationMs = 150): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      ws.off('message', onMessage)
    }
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, durationMs)
    const onMessage = (raw: RawData) => {
      if (raw.toString().includes(unexpected)) {
        cleanup()
        reject(new Error(`Unexpected session text: ${unexpected}`))
      }
    }
    ws.on('message', onMessage)
  })
}

async function expectNoDaemonMessage(ws: WebSocket, predicate: (value: Record<string, unknown>) => boolean, durationMs = 150): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      ws.off('message', onMessage)
    }
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, durationMs)
    const onMessage = (raw: RawData) => {
      const parsed = JSON.parse(raw.toString()) as Record<string, unknown>
      if (predicate(parsed)) {
        cleanup()
        reject(new Error(`Unexpected daemon message: ${raw.toString()}`))
      }
    }
    ws.on('message', onMessage)
  })
}

async function waitForClose(ws: WebSocket): Promise<void> {
  if (ws.readyState === ws.CLOSED) {
    return
  }
  await new Promise<void>((resolve) => {
    ws.once('close', () => resolve())
  })
}

function readStreamEventKind(event: unknown): string | undefined {
  const record = event as { type?: string; ev?: { type?: string } }
  return record.type ?? record.ev?.type
}

async function pollJson<T>(url: string): Promise<T> {
  let last: T | null = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(url, { headers: AUTH_HEADERS })
    expect(response.status).toBe(200)
    last = await response.json() as T
    if ((last as { connected?: boolean }).connected === true) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return last as T
}

async function pairDaemon(server: Awaited<ReturnType<typeof startServer>>): Promise<{
  token: string
  websocketPath: string
}> {
  const pairResponse = await fetch(`${server.baseUrl}/api/agents/machines/mac-1/daemon/pair`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      label: 'Nick MacBook',
      cwd: '/Users/nick/work',
    }),
  })
  expect(pairResponse.status).toBe(201)
  const pairPayload = await pairResponse.json() as {
    pairing: {
      token: string
      websocketPath: string
    }
  }
  return pairPayload.pairing
}

async function connectDaemon(
  server: Awaited<ReturnType<typeof startServer>>,
  pairing: { token: string; websocketPath: string },
): Promise<WebSocket> {
  const ws = new WebSocket(
    `${server.baseUrl.replace('http://', 'ws://')}${pairing.websocketPath}`,
    ['hammurabi-daemon', pairing.token],
  )
  const welcomePromise = waitForMessage<{ type: string; machineId: string }>(
    ws,
    (message) => message.type === 'welcome',
  )
  await waitForOpen(ws)
  await expect(welcomePromise).resolves.toMatchObject({
    type: 'welcome',
    machineId: 'mac-1',
  })
  ws.send(JSON.stringify({
    type: 'hello',
    protocolVersion: 1,
    machineId: 'mac-1',
    daemonVersion: '0.1.0',
    pid: 123,
    platform: 'darwin',
    arch: 'arm64',
    providerHealth: {
      claude: {
        installed: true,
        authenticated: true,
        version: '1.0.31',
        authMethod: 'login',
      },
    },
  }))
  return ws
}

async function pairAndConnectDaemon(server: Awaited<ReturnType<typeof startServer>>): Promise<WebSocket> {
  return await connectDaemon(server, await pairDaemon(server))
}

describe('daemon machine routes', () => {
  it('pairs a daemon, accepts the outbound websocket, and reports daemon health', async () => {
    const registry = await createMissingMachinesRegistryPath()
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      const pairResponse = await fetch(`${server.baseUrl}/api/agents/machines/mac-1/daemon/pair`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          label: 'Nick MacBook',
          cwd: '/Users/nick/work',
        }),
      })
      expect(pairResponse.status).toBe(201)
      const pairPayload = await pairResponse.json() as {
        machine: {
          id: string
          transport: string
          daemon: Record<string, unknown>
        }
        pairing: {
          token: string
          websocketPath: string
          command: {
            shortCommand: string
            fullCommand: string
            disclosureLabel: string
          }
        }
        status: {
          displayLabel: string
          paired: boolean
          connected: boolean
          connectionLabel: string
          providerAuthLabel: string
          launchable: boolean
          launchUnsupportedReason: string | null
          allowedActions: Array<{ id: string; label: string }>
        }
      }

      expect(pairPayload.machine).toMatchObject({
        id: 'mac-1',
        transport: 'daemon',
      })
      expect(pairPayload.machine.daemon).not.toHaveProperty('pairingTokenHash')
      expect(pairPayload.pairing.token).toMatch(/^hmrd_/)
      expect(pairPayload.pairing.command.shortCommand).toBe(
        `hammurabi daemon run --machine mac-1 --pairing-token <pairing-token> --endpoint ${server.baseUrl}`,
      )
      expect(pairPayload.pairing.command.fullCommand).toBe(
        `hammurabi daemon run --machine mac-1 --pairing-token ${pairPayload.pairing.token} --endpoint ${server.baseUrl}`,
      )
      expect(pairPayload.pairing.command.disclosureLabel).toBe('Show full pairing command')
      expect(pairPayload.status).toMatchObject({
        displayLabel: 'Nick MacBook',
        paired: true,
        connected: false,
        connectionLabel: 'paired',
        providerAuthLabel: 'providers missing',
        launchable: false,
        allowedActions: [
          { id: 'rotate', label: 'Rotate Pairing' },
          { id: 'revoke', label: 'Revoke' },
        ],
      })

      const stored = JSON.parse(await readFile(registry.filePath, 'utf8')) as {
        machines: Array<{
          id: string
          daemon?: { pairingTokenHash?: string }
        }>
      }
      const storedMachine = stored.machines.find((entry) => entry.id === 'mac-1')
      expect(storedMachine?.daemon?.pairingTokenHash).toEqual(expect.any(String))
      expect(storedMachine?.daemon?.pairingTokenHash).not.toBe(pairPayload.pairing.token)
      expect(pairPayload.pairing.websocketPath).not.toContain('pairing_token')
      expect(pairPayload.pairing.websocketPath).not.toContain(pairPayload.pairing.token)

      const ws = new WebSocket(
        `${server.baseUrl.replace('http://', 'ws://')}${pairPayload.pairing.websocketPath}`,
        ['hammurabi-daemon', pairPayload.pairing.token],
      )
      const welcomePromise = waitForMessage<{
        type: string
        machineId: string
        connectionId: string
      }>(ws, (message) => message.type === 'welcome')
      await waitForOpen(ws)
      const welcome = await welcomePromise
      expect(welcome).toMatchObject({
        type: 'welcome',
        machineId: 'mac-1',
      })

      ws.send(JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        machineId: 'mac-1',
        daemonVersion: '0.1.0',
        pid: 123,
        platform: 'darwin',
        arch: 'arm64',
        providerHealth: {
          claude: {
            installed: true,
            authenticated: true,
            version: '1.0.31',
            authMethod: 'login',
          },
        },
      }))

      const status = await pollJson<{
        connected: boolean
        daemonVersion: string | null
        providerAuthReady: boolean
        launchable: boolean
        launchUnsupportedReason: string | null
      }>(`${server.baseUrl}/api/agents/machines/mac-1/daemon/status`)
      expect(status).toMatchObject({
        connected: true,
        daemonVersion: '0.1.0',
        providerAuthReady: true,
        launchable: true,
      })
      expect(status.launchUnsupportedReason).toBeNull()

      const healthResponse = await fetch(`${server.baseUrl}/api/agents/machines/mac-1/health`, {
        headers: AUTH_HEADERS,
      })
      expect(healthResponse.status).toBe(200)
      expect(await healthResponse.json()).toMatchObject({
        machineId: 'mac-1',
        mode: 'daemon',
        ssh: { ok: false },
        daemon: {
          connected: true,
          providerAuthReady: true,
          launchable: true,
        },
        tools: {
          claude: {
            ok: true,
            version: '1.0.31',
          },
        },
      })

      ws.close()
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('converts an existing SSH machine to daemon transport when pairing', async () => {
    const registry = await createMissingMachinesRegistryPath()
    await writeFile(registry.filePath, JSON.stringify({
      machines: [{
        id: 'mac-1',
        label: 'Existing SSH Mac',
        host: '100.64.1.1',
        transport: 'ssh',
        user: 'nick',
        cwd: '/Users/nick/old',
      }],
    }), 'utf8')
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      const pairResponse = await fetch(`${server.baseUrl}/api/agents/machines/mac-1/daemon/pair`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cwd: '/Users/nick/work' }),
      })
      expect(pairResponse.status).toBe(201)
      await expect(pairResponse.json()).resolves.toMatchObject({
        machine: {
          id: 'mac-1',
          label: 'Existing SSH Mac',
          host: '100.64.1.1',
          transport: 'daemon',
          user: 'nick',
          cwd: '/Users/nick/work',
        },
      })

      const stored = JSON.parse(await readFile(registry.filePath, 'utf8')) as {
        machines: Array<{ id: string; transport?: string; daemon?: Record<string, unknown> }>
      }
      expect(stored.machines.find((entry) => entry.id === 'mac-1')).toMatchObject({
        transport: 'daemon',
        daemon: { pairingTokenHash: expect.any(String) },
      })
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('rejects daemon websocket auth when the pairing token is only present in the URL', async () => {
    const registry = await createMissingMachinesRegistryPath()
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      const pairing = await pairDaemon(server)
      const ws = new WebSocket(
        `${server.baseUrl.replace('http://', 'ws://')}${pairing.websocketPath}&pairing_token=${encodeURIComponent(pairing.token)}`,
      )

      await expect(waitForOpen(ws)).rejects.toThrow('Unexpected response 400')
      ws.close()
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('routes daemon PTY session output and exit back to the browser websocket', async () => {
    const registry = await createMissingMachinesRegistryPath()
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      const daemonWs = await pairAndConnectDaemon(server)
      await pollJson(`${server.baseUrl}/api/agents/machines/mac-1/daemon/status`)

      const spawnPromise = waitForMessage<{
        type: string
        requestId: string
        processId: string
        mode: string
        command: string
      }>(daemonWs, (message) => message.type === 'spawn')

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'daemon-pty-1',
          mode: 'default',
          transportType: 'pty',
          agentType: 'claude',
          host: 'mac-1',
          cwd: '/Users/nick/work',
        }),
      })
      expect(createResponse.status).toBe(201)
      await expect(createResponse.json()).resolves.toMatchObject({
        sessionName: 'daemon-pty-1',
        transportType: 'pty',
        host: 'mac-1',
      })

      const spawnMessage = await spawnPromise
      expect(spawnMessage).toMatchObject({
        type: 'spawn',
        mode: 'pty',
        command: 'bash',
      })

      daemonWs.send(JSON.stringify({
        type: 'spawned',
        requestId: spawnMessage.requestId,
        processId: spawnMessage.processId,
        pid: 456,
      }))

      const browserWs = await connectWs(server.baseUrl, 'daemon-pty-1')
      const outputPromise = waitForSessionText(browserWs, 'hello from daemon pty')
      daemonWs.send(JSON.stringify({
        type: 'pty-data',
        processId: spawnMessage.processId,
        data: 'hello from daemon pty\r\n',
      }))
      await expect(outputPromise).resolves.toContain('hello from daemon pty')

      const exitPromise = waitForMessage<{ type: string; exitCode: number }>(
        browserWs,
        (message) => message.type === 'exit',
      )
      daemonWs.send(JSON.stringify({
        type: 'exit',
        processId: spawnMessage.processId,
        exitCode: 0,
        signal: null,
      }))
      await expect(exitPromise).resolves.toMatchObject({
        type: 'exit',
        exitCode: 0,
      })

      browserWs.close()
      daemonWs.close()
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('uses daemon process transport for Claude stream sessions on daemon machines', async () => {
    const registry = await createMissingMachinesRegistryPath()
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      const daemonWs = await pairAndConnectDaemon(server)
      await pollJson(`${server.baseUrl}/api/agents/machines/mac-1/daemon/status`)

      const spawnPromise = waitForMessage<{
        type: string
        requestId: string
        processId: string
        mode: string
        command: string
        args: string[]
        cwd?: string
        env?: Record<string, string>
      }>(daemonWs, (message) => message.type === 'spawn')
      const stdinPromise = waitForMessage<{
        type: string
        processId: string
        data: string
      }>(daemonWs, (message) => message.type === 'stdin')

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'daemon-stream-1',
          mode: 'default',
          transportType: 'stream',
          agentType: 'claude',
          host: 'mac-1',
          cwd: '/Users/nick/work',
          task: 'say hello',
        }),
      })
      expect(createResponse.status).toBe(201)
      await expect(createResponse.json()).resolves.toMatchObject({
        sessionName: 'daemon-stream-1',
        transportType: 'stream',
        host: 'mac-1',
      })

      const spawnMessage = await spawnPromise
      expect(spawnMessage.mode).toBe('pipe')
      expect(spawnMessage.command).toBe('sh')
      expect(spawnMessage.args.join(' ')).toContain('claude')
      expect(spawnMessage.cwd).toBe('/Users/nick/work')
      expect(spawnMessage.env?.HOME).toBeUndefined()
      expect(spawnMessage.env?.PATH).toBeUndefined()

      const stdinMessage = await stdinPromise
      expect(stdinMessage.processId).toBe(spawnMessage.processId)
      expect(stdinMessage.data).toContain('say hello')

      const browserWs = await connectWs(server.baseUrl, 'daemon-stream-1')
      const eventPromise = waitForMessage<unknown>(
        browserWs,
        (message) => readStreamEventKind(message) === 'message.start',
      )

      daemonWs.send(JSON.stringify({
        type: 'spawned',
        requestId: spawnMessage.requestId,
        processId: spawnMessage.processId,
        pid: 789,
      }))
      daemonWs.send(JSON.stringify({
        type: 'stdout',
        processId: spawnMessage.processId,
        data: `${JSON.stringify({
          type: 'message_start',
          message: { id: 'msg-1', role: 'assistant' },
        })}\n`,
      }))
      await expect(eventPromise).resolves.toMatchObject({
        ev: {
          type: 'message.start',
          role: 'assistant',
        },
      })

      browserWs.close()
      daemonWs.close()
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('keeps daemon-backed stream sessions alive across daemon reconnects without false exit', async () => {
    const registry = await createMissingMachinesRegistryPath()
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      const pairing = await pairDaemon(server)
      const daemonWs = await connectDaemon(server, pairing)
      await pollJson(`${server.baseUrl}/api/agents/machines/mac-1/daemon/status`)

      const spawnPromise = waitForMessage<{
        type: string
        requestId: string
        processId: string
      }>(daemonWs, (message) => message.type === 'spawn')

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'daemon-stream-reconnect',
          mode: 'default',
          transportType: 'stream',
          agentType: 'claude',
          host: 'mac-1',
          cwd: '/Users/nick/work',
          task: 'survive reconnect',
        }),
      })
      expect(createResponse.status).toBe(201)

      const spawnMessage = await spawnPromise
      daemonWs.send(JSON.stringify({
        type: 'spawned',
        requestId: spawnMessage.requestId,
        processId: spawnMessage.processId,
        pid: 790,
      }))

      const browserWs = await connectWs(server.baseUrl, 'daemon-stream-reconnect')
      const noExitPromise = expectNoSessionText(browserWs, '"type":"exit"')
      daemonWs.close()
      await waitForClose(daemonWs)
      await expect(noExitPromise).resolves.toBeUndefined()

      const reconnectedDaemonWs = await connectDaemon(server, pairing)
      const eventPromise = waitForMessage<unknown>(
        browserWs,
        (message) => readStreamEventKind(message) === 'message.start',
      )

      reconnectedDaemonWs.send(JSON.stringify({
        type: 'stdout',
        processId: spawnMessage.processId,
        data: `${JSON.stringify({
          type: 'message_start',
          message: { id: 'msg-reconnect', role: 'assistant' },
        })}\n`,
      }))
      await expect(eventPromise).resolves.toMatchObject({
        ev: {
          type: 'message.start',
          role: 'assistant',
        },
      })

      browserWs.close()
      reconnectedDaemonWs.close()
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('reattaches daemon-backed stream sessions across a server restart without spawning a replacement process', async () => {
    const registry = await createMissingMachinesRegistryPath()
    const sessionDir = await mkdtemp(join(tmpdir(), 'hammurabi-daemon-sessions-'))
    const sessionStorePath = join(sessionDir, 'stream-sessions.json')
    const server = await startServer({
      machinesFilePath: registry.filePath,
      sessionStorePath,
    })
    let serverClosed = false

    try {
      const pairing = await pairDaemon(server)
      const daemonWs = await connectDaemon(server, pairing)
      await pollJson(`${server.baseUrl}/api/agents/machines/mac-1/daemon/status`)

      const spawnPromise = waitForMessage<{
        type: string
        requestId: string
        processId: string
      }>(daemonWs, (message) => message.type === 'spawn')

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'daemon-stream-server-restart',
          mode: 'default',
          transportType: 'stream',
          agentType: 'claude',
          host: 'mac-1',
          cwd: '/Users/nick/work',
          task: 'survive server restart',
        }),
      })
      expect(createResponse.status).toBe(201)

      const spawnMessage = await spawnPromise
      daemonWs.send(JSON.stringify({
        type: 'spawned',
        requestId: spawnMessage.requestId,
        processId: spawnMessage.processId,
        pid: 791,
      }))

      await server.close()
      serverClosed = true
      await waitForClose(daemonWs)

      const persisted = JSON.parse(await readFile(sessionStorePath, 'utf8')) as {
        sessions: Array<{
          name: string
          daemonProcess?: { processId?: string; mode?: string }
        }>
      }
      expect(persisted.sessions).toEqual([
        expect.objectContaining({
          name: 'daemon-stream-server-restart',
          daemonProcess: {
            processId: spawnMessage.processId,
            mode: 'pipe',
          },
        }),
      ])

      const restartedServer = await startServer({
        autoResumeSessions: true,
        machinesFilePath: registry.filePath,
        sessionStorePath,
      })
      try {
        const reconnectedDaemonWs = await connectDaemon(restartedServer, pairing)
        await expect(expectNoDaemonMessage(
          reconnectedDaemonWs,
          (message) => message.type === 'spawn',
        )).resolves.toBeUndefined()

        const browserWs = await connectWs(restartedServer.baseUrl, 'daemon-stream-server-restart')
        const eventPromise = waitForMessage<unknown>(
          browserWs,
          (message) => readStreamEventKind(message) === 'message.start',
        )
        reconnectedDaemonWs.send(JSON.stringify({
          type: 'stdout',
          processId: spawnMessage.processId,
          data: `${JSON.stringify({
            type: 'message_start',
            message: { id: 'msg-restart', role: 'assistant' },
          })}\n`,
        }))
        await expect(eventPromise).resolves.toMatchObject({
          ev: {
            type: 'message.start',
            role: 'assistant',
          },
        })

        browserWs.close()
        reconnectedDaemonWs.close()
      } finally {
        await restartedServer.close()
      }
    } finally {
      if (!serverClosed) {
        await server.close()
      }
      await registry.cleanup()
      await rm(sessionDir, { recursive: true, force: true })
    }
  })
})

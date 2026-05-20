import { createServer, type Server } from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createProviderRegistryRouter } from '../http-router'

const INTERNAL_TOKEN = 'provider-registry-test-token'

let server: Server | null = null

afterEach(async () => {
  if (!server) {
    return
  }
  const closing = server
  server = null
  await new Promise<void>((resolve, reject) => {
    closing.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
})

async function startProviderServer(): Promise<string> {
  const app = express()
  app.use('/api', createProviderRegistryRouter({ internalToken: INTERNAL_TOKEN }))
  server = createServer(app)

  await new Promise<void>((resolve) => {
    server!.listen(0, () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve provider registry test server address')
  }
  return `http://127.0.0.1:${address.port}`
}

describe('provider registry router', () => {
  it('publishes backend-owned provider defaults, transports, and disabled state', async () => {
    const baseUrl = await startProviderServer()

    const response = await fetch(`${baseUrl}/api/providers`, {
      headers: { 'x-hammurabi-internal-token': INTERNAL_TOKEN },
    })
    expect(response.status).toBe(200)

    const body = await response.json() as {
      defaultProviderId?: string
      providers?: Array<{
        id: string
        capabilities?: { supportsMessageImages?: boolean }
        supportedTransports?: string[]
        defaults?: {
          transportType?: string
          permissionMode?: string
          model?: string | null
          effort?: string
          adaptiveThinking?: string
          maxThinkingTokens?: number
        }
        disabledReason?: string | null
      }>
    }
    const providers = body.providers ?? []
    const byId = new Map(providers.map((provider) => [provider.id, provider]))

    expect(body.defaultProviderId).toBe('claude')
    expect(byId.get('claude')).toEqual(expect.objectContaining({
      capabilities: expect.objectContaining({ supportsMessageImages: true }),
      supportedTransports: ['stream', 'pty'],
      defaults: expect.objectContaining({
        transportType: 'stream',
        permissionMode: 'default',
        model: 'claude-sonnet-4-6',
        effort: 'high',
        adaptiveThinking: 'disabled',
        maxThinkingTokens: 128000,
      }),
      disabledReason: null,
    }))
    expect(byId.get('codex')).toEqual(expect.objectContaining({
      capabilities: expect.objectContaining({ supportsMessageImages: true }),
      supportedTransports: ['stream', 'pty'],
      defaults: expect.objectContaining({ model: 'gpt-5.5' }),
      disabledReason: null,
    }))
    expect(byId.get('codex')?.defaults).not.toEqual(expect.objectContaining({
      effort: expect.any(String),
      adaptiveThinking: expect.any(String),
    }))
    expect(byId.get('gemini')).toEqual(expect.objectContaining({
      capabilities: expect.objectContaining({ supportsMessageImages: false }),
      supportedTransports: ['stream'],
      defaults: expect.objectContaining({ model: 'gemini-3.1-pro-preview' }),
      disabledReason: null,
    }))
    expect(byId.get('opencode')).toEqual(expect.objectContaining({
      capabilities: expect.objectContaining({ supportsMessageImages: false }),
      supportedTransports: ['stream'],
      defaults: expect.objectContaining({ model: null }),
      disabledReason: null,
    }))
  })
})

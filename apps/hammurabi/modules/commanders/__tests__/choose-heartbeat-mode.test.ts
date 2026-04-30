import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildFatHeartbeatMessage,
  chooseHeartbeatMode,
  resolveFatPinInterval,
} from '../choose-heartbeat-mode.js'

describe('resolveFatPinInterval', () => {
  it('defaults to 4 when interval is absent or invalid', () => {
    expect(resolveFatPinInterval(undefined)).toBe(4)
    expect(resolveFatPinInterval(0)).toBe(4)
    expect(resolveFatPinInterval(-2)).toBe(4)
    expect(resolveFatPinInterval(2.5)).toBe(4)
  })
})

describe('buildFatHeartbeatMessage', () => {
  let tmpDir: string
  const commanderId = '00000000-0000-4000-a000-000000000001'

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'heartbeat-mode-test-'))
    await mkdir(join(tmpDir, commanderId, '.memory'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns null when HEARTBEAT.md does not exist', async () => {
    const result = await buildFatHeartbeatMessage('[HEARTBEAT]', commanderId, tmpDir)
    expect(result).toBeNull()
  })

  it('returns null when HEARTBEAT.md is empty', async () => {
    const memoryRoot = join(tmpDir, commanderId, '.memory')
    await writeFile(join(memoryRoot, 'HEARTBEAT.md'), '', 'utf-8')

    const result = await buildFatHeartbeatMessage('[HEARTBEAT]', commanderId, tmpDir)
    expect(result).toBeNull()
  })

  it('appends HEARTBEAT.md content to base message', async () => {
    const memoryRoot = join(tmpDir, commanderId, '.memory')
    await writeFile(
      join(memoryRoot, 'HEARTBEAT.md'),
      '- [ ] Check task status\n- [ ] Review blockers',
      'utf-8',
    )

    const result = await buildFatHeartbeatMessage('[HEARTBEAT 2026-03-17]', commanderId, tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('[HEARTBEAT 2026-03-17]')
    expect(result).toContain('Read and follow the checklist below:')
    expect(result).toContain('- [ ] Check task status')
    expect(result).toContain('- [ ] Review blockers')
  })
})

describe('chooseHeartbeatMode', () => {
  it('keeps thin sessions thin even when stale fat cadence state remains', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 4, forceNextFatHeartbeat: true },
      {
        contextMode: 'thin',
        contextConfig: { fatPinInterval: 2 },
      },
      {},
    )
    expect(mode).toBe('thin')
  })

  it('returns fat on first heartbeat after start or restart', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 0, forceNextFatHeartbeat: false },
      { contextConfig: { fatPinInterval: 4 } },
      {},
    )
    expect(mode).toBe('fat')
  })

  it('returns fat after a resumed session marks forceNextFatHeartbeat', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 1, forceNextFatHeartbeat: true },
      { contextConfig: { fatPinInterval: 4 } },
      {},
    )
    expect(mode).toBe('fat')
  })

  it('returns fat after task transition marks forceNextFatHeartbeat', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 2, forceNextFatHeartbeat: true },
      { contextConfig: { fatPinInterval: 4 } },
      {},
    )
    expect(mode).toBe('fat')
  })

  it('returns fat after any forced reseed marks forceNextFatHeartbeat', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 3, forceNextFatHeartbeat: true },
      { contextConfig: { fatPinInterval: 4 } },
      {},
    )
    expect(mode).toBe('fat')
  })

  it('returns fat on configured cadence pin interval', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 6, forceNextFatHeartbeat: false },
      { contextConfig: { fatPinInterval: 3 } },
      {},
    )
    expect(mode).toBe('fat')
  })

  it('returns thin for routine heartbeat ticks between fat pins', () => {
    const mode = chooseHeartbeatMode(
      { heartbeatCount: 2, forceNextFatHeartbeat: false },
      { contextConfig: { fatPinInterval: 4 } },
      {},
    )
    expect(mode).toBe('thin')
  })
})

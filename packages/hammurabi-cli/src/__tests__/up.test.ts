import { describe, expect, it } from 'vitest'
import {
  buildManagedLaunchInvocation,
  parseDotenv,
  parseUpArgs,
  planLaunch,
  resolveLaunchScript,
  TMUX_SESSION,
} from '../up.js'

describe('parseUpArgs', () => {
  it('defaults to production, no port', () => {
    const parsed = parseUpArgs([])
    expect(parsed).toEqual({ dev: false, help: false })
  })

  it('parses --dev', () => {
    expect(parseUpArgs(['--dev']).dev).toBe(true)
  })

  it('parses --port with separate value', () => {
    expect(parseUpArgs(['--port', '21000']).port).toBe(21000)
  })

  it('parses --port=N form', () => {
    expect(parseUpArgs(['--port=21500']).port).toBe(21500)
  })

  it('combines flags', () => {
    const parsed = parseUpArgs(['--dev', '--port', '21100'])
    expect(parsed.dev).toBe(true)
    expect(parsed.port).toBe(21100)
  })

  it('rejects --port without value', () => {
    expect(parseUpArgs(['--port']).error).toMatch(/requires a value/)
  })

  it('rejects non-integer port', () => {
    expect(parseUpArgs(['--port', 'abc']).error).toMatch(/invalid port/)
    expect(parseUpArgs(['--port=0']).error).toMatch(/invalid port/)
  })

  it('rejects unknown args', () => {
    expect(parseUpArgs(['--nope']).error).toMatch(/unknown argument/)
  })

  it('supports --help / -h', () => {
    expect(parseUpArgs(['--help']).help).toBe(true)
    expect(parseUpArgs(['-h']).help).toBe(true)
  })
})

describe('parseDotenv', () => {
  it('parses simple KEY=VALUE pairs', () => {
    expect(parseDotenv('PORT=20001\nNAME=hammurabi\n')).toEqual({
      PORT: '20001',
      NAME: 'hammurabi',
    })
  })

  it('skips comments and blank lines', () => {
    const out = parseDotenv('# header\n\nPORT=123\n# trail\n')
    expect(out).toEqual({ PORT: '123' })
  })

  it('strips matching surrounding quotes', () => {
    expect(parseDotenv('A="quoted"\nB=\'single\'\nC=plain\n')).toEqual({
      A: 'quoted',
      B: 'single',
      C: 'plain',
    })
  })

  it('preserves = inside values', () => {
    expect(parseDotenv('URL=https://example.com?a=1&b=2\n')).toEqual({
      URL: 'https://example.com?a=1&b=2',
    })
  })

  it('ignores malformed lines without =', () => {
    expect(parseDotenv('NOTAPAIR\nGOOD=1\n')).toEqual({ GOOD: '1' })
  })
})

describe('managed dev launch', () => {
  it('plans dev launches for the managed path', () => {
    const plan = planLaunch({ dev: true, help: false, port: 21100 }, '/tmp/hammurabi', {})
    expect(plan).toMatchObject({
      mode: 'tmux',
      script: 'dev',
      port: 21100,
      session: TMUX_SESSION,
    })
  })

  it('builds launcher invocation for dev mode', () => {
    const plan = planLaunch({ dev: true, help: false, port: 21100 }, '/tmp/hammurabi', {
      PORT: '20001',
    })

    expect(buildManagedLaunchInvocation(plan)).toEqual({
      command: 'bash',
      args: [
        resolveLaunchScript('/tmp/hammurabi'),
        '--dev',
        '--port',
        '21100',
        '--session-name',
        TMUX_SESSION,
      ],
      cwd: '/tmp/hammurabi',
      env: expect.objectContaining({
        HAMMURABI_APP_DIR: '/tmp/hammurabi',
        NODE_ENV: 'development',
        PORT: '21100',
      }),
    })
  })
})

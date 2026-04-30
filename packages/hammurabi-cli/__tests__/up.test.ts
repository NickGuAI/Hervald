import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PORT,
  TMUX_SESSION,
  findPortListeners,
  killPortListeners,
  parseUpArgs,
  parseDotenv,
  planLaunch,
} from '../src/up.js'

// ---------------------------------------------------------------------------
// parseUpArgs
// ---------------------------------------------------------------------------

describe('parseUpArgs', () => {
  it('parses --dev flag', () => {
    const result = parseUpArgs(['--dev'])
    expect(result.dev).toBe(true)
    expect(result.help).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('parses --port with value', () => {
    const result = parseUpArgs(['--port', '3000'])
    expect(result.port).toBe(3000)
    expect(result.dev).toBe(false)
  })

  it('parses --port=value form', () => {
    const result = parseUpArgs(['--port=8080'])
    expect(result.port).toBe(8080)
  })

  it('parses --dev and --port together', () => {
    const result = parseUpArgs(['--dev', '--port', '9000'])
    expect(result.dev).toBe(true)
    expect(result.port).toBe(9000)
  })

  it('returns error for missing --port value', () => {
    const result = parseUpArgs(['--port'])
    expect(result.error).toBe('--port requires a value')
  })

  it('returns error for invalid port', () => {
    const result = parseUpArgs(['--port', 'abc'])
    expect(result.error).toBe('invalid port: abc')
  })

  it('returns error for negative port', () => {
    const result = parseUpArgs(['--port', '-1'])
    expect(result.error).toBe('invalid port: -1')
  })

  it('returns error for unknown argument', () => {
    const result = parseUpArgs(['--foo'])
    expect(result.error).toBe('unknown argument: --foo')
  })

  it('parses help flags', () => {
    expect(parseUpArgs(['--help']).help).toBe(true)
    expect(parseUpArgs(['-h']).help).toBe(true)
  })

  it('returns defaults for empty args', () => {
    const result = parseUpArgs([])
    expect(result.dev).toBe(false)
    expect(result.help).toBe(false)
    expect(result.port).toBeUndefined()
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// parseDotenv
// ---------------------------------------------------------------------------

describe('parseDotenv', () => {
  it('parses simple key=value pairs', () => {
    expect(parseDotenv('PORT=3000\nDB_HOST=localhost')).toEqual({
      PORT: '3000',
      DB_HOST: 'localhost',
    })
  })

  it('strips quotes from values', () => {
    expect(parseDotenv('KEY="hello"\nKEY2=\'world\'')).toEqual({
      KEY: 'hello',
      KEY2: 'world',
    })
  })

  it('ignores comments and blank lines', () => {
    expect(parseDotenv('# comment\n\nPORT=20001')).toEqual({ PORT: '20001' })
  })

  it('returns empty object for empty string', () => {
    expect(parseDotenv('')).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// planLaunch — pure decision logic
// ---------------------------------------------------------------------------

describe('planLaunch', () => {
  it('selects tmux mode for --dev', () => {
    const plan = planLaunch({ dev: true, help: false }, '/app', {})
    expect(plan.mode).toBe('tmux')
    expect(plan.session).toBe(TMUX_SESSION)
    expect(plan.script).toBe('dev')
    expect(plan.env.NODE_ENV).toBe('development')
    expect(plan.port).toBe(DEFAULT_PORT)
  })

  it('selects foreground mode without --dev', () => {
    const plan = planLaunch({ dev: false, help: false }, '/app', {})
    expect(plan.mode).toBe('foreground')
    expect(plan.session).toBeNull()
    expect(plan.script).toBe('start')
    expect(plan.env.NODE_ENV).toBe('production')
  })

  it('uses port from args over dotenv', () => {
    const plan = planLaunch(
      { dev: false, help: false, port: 9000 },
      '/app',
      { PORT: '3000' },
    )
    expect(plan.port).toBe(9000)
    expect(plan.env.PORT).toBe('9000')
  })

  it('falls back to dotenv PORT', () => {
    const plan = planLaunch({ dev: false, help: false }, '/app', {
      PORT: '4000',
    })
    expect(plan.port).toBe(4000)
  })

  it('falls back to DEFAULT_PORT when no port specified', () => {
    const plan = planLaunch({ dev: false, help: false }, '/app', {})
    expect(plan.port).toBe(DEFAULT_PORT)
  })

  it('preserves additional dotenv vars in the plan env', () => {
    const plan = planLaunch({ dev: false, help: false }, '/app', {
      DB_HOST: 'localhost',
      SECRET: 'abc',
    })
    expect(plan.env.DB_HOST).toBe('localhost')
    expect(plan.env.SECRET).toBe('abc')
  })

  it('stores appDir in the plan', () => {
    const plan = planLaunch({ dev: true, help: false }, '/my/app', {})
    expect(plan.appDir).toBe('/my/app')
  })
})

// ---------------------------------------------------------------------------
// findPortListeners — injectable exec
// ---------------------------------------------------------------------------

describe('findPortListeners', () => {
  it('returns PIDs from lsof output', () => {
    const exec = vi.fn().mockReturnValue('1234\n5678\n')
    const pids = findPortListeners(20001, exec)
    expect(pids).toEqual([1234, 5678])
    expect(exec).toHaveBeenCalledWith('lsof -ti :20001')
  })

  it('returns empty array when lsof finds nothing (throws)', () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error('exit code 1')
    })
    const pids = findPortListeners(20001, exec)
    expect(pids).toEqual([])
  })

  it('returns empty array for empty output', () => {
    const exec = vi.fn().mockReturnValue('')
    expect(findPortListeners(3000, exec)).toEqual([])
  })

  it('filters out NaN entries from malformed output', () => {
    const exec = vi.fn().mockReturnValue('1234\nbogus\n5678\n')
    expect(findPortListeners(3000, exec)).toEqual([1234, 5678])
  })
})

// ---------------------------------------------------------------------------
// killPortListeners — injectable find + kill
// ---------------------------------------------------------------------------

describe('killPortListeners', () => {
  it('sends SIGTERM to all listeners and returns count', () => {
    const kill = vi.fn()
    const findCalls: number[] = []
    const findListeners = vi.fn().mockImplementation(() => {
      findCalls.push(1)
      // First call: return PIDs. Second call (survivor check): empty.
      return findCalls.length === 1 ? [1234, 5678] : []
    })

    const count = killPortListeners(20001, { findListeners, kill })
    expect(count).toBe(2)
    expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM')
    expect(kill).toHaveBeenCalledWith(5678, 'SIGTERM')
  })

  it('sends SIGKILL to survivors after SIGTERM', () => {
    const kill = vi.fn()
    // Both calls return the same PID — it survived SIGTERM
    const findListeners = vi.fn().mockReturnValue([9999])

    killPortListeners(20001, { findListeners, kill })
    expect(kill).toHaveBeenCalledWith(9999, 'SIGTERM')
    expect(kill).toHaveBeenCalledWith(9999, 'SIGKILL')
  })

  it('returns 0 when no listeners found', () => {
    const kill = vi.fn()
    const findListeners = vi.fn().mockReturnValue([])

    const count = killPortListeners(20001, { findListeners, kill })
    expect(count).toBe(0)
    expect(kill).not.toHaveBeenCalled()
  })

  it('handles kill throwing (process already gone)', () => {
    const kill = vi.fn().mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const calls: number[] = []
    const findListeners = vi.fn().mockImplementation(() => {
      calls.push(1)
      return calls.length === 1 ? [1234] : []
    })

    // Should not throw even when kill fails
    expect(() =>
      killPortListeners(20001, { findListeners, kill }),
    ).not.toThrow()
    expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM')
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('exports expected defaults', () => {
    expect(TMUX_SESSION).toBe('hammurabi-dev')
    expect(DEFAULT_PORT).toBe(20001)
  })
})

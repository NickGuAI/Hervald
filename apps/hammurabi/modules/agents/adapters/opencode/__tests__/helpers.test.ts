import { describe, expect, it } from 'vitest'
import { buildOpenCodeAcpInvocation } from '../helpers'

describe('buildOpenCodeAcpInvocation', () => {
  it('includes the acp subcommand and model flag when provided', () => {
    const command = buildOpenCodeAcpInvocation({
      model: 'anthropic/claude-sonnet-4',
    })

    expect(command).toContain('opencode')
    expect(command).toContain('acp')
    expect(command).toContain('--model')
    expect(command).toContain('anthropic/claude-sonnet-4')
  })

  it('omits the model flag when no model is provided', () => {
    const command = buildOpenCodeAcpInvocation()

    expect(command).toContain('opencode')
    expect(command).toContain('acp')
    expect(command).not.toContain('--model')
  })
})

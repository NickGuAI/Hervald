import { describe, expect, it } from 'vitest'
import { buildGeminiAcpInvocation } from '../helpers.js'

describe('buildGeminiAcpInvocation', () => {
  it('appends --model when a model is provided', () => {
    const command = buildGeminiAcpInvocation('gemini-2.5-pro')

    expect(command).toContain('gemini')
    expect(command).toContain('--acp')
    expect(command).toContain('--model')
    expect(command).toContain('gemini-2.5-pro')
  })

  it('omits --model when the adapter default should be used', () => {
    const command = buildGeminiAcpInvocation()

    expect(command).toContain('gemini')
    expect(command).toContain('--acp')
    expect(command).not.toContain('--model')
  })
})

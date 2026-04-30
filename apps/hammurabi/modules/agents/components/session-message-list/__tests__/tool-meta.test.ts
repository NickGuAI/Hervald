import { describe, expect, it } from 'vitest'
import { formatToolDisplayName, isAgentAccentColor } from '../tool-meta'

describe('tool-meta', () => {
  it('formats MCP tool names into service and display labels', () => {
    expect(formatToolDisplayName('mcp__tavily__tavily_search')).toEqual({
      displayName: 'Tavily Search',
      service: 'tavily',
    })
    expect(formatToolDisplayName('ToolSearch')).toEqual({
      displayName: 'ToolSearch',
    })
  })

  it('accepts conservative agent accent color values', () => {
    expect(isAgentAccentColor('#22c55e')).toBe(true)
    expect(isAgentAccentColor('rgba(34, 197, 94, 0.8)')).toBe(true)
    expect(isAgentAccentColor('emerald')).toBe(true)
    expect(isAgentAccentColor('url(javascript:alert(1))')).toBe(false)
  })
})

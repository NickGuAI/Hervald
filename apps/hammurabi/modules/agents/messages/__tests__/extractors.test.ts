import { describe, expect, it } from 'vitest'
import {
  extractAgentMessageText,
  extractSubagentDescription,
  extractToolDetails,
  extractToolResultOutput,
} from '../extractors'

describe('message extractors', () => {
  it('extracts bash and edit tool details from structured input', () => {
    expect(extractToolDetails('Bash', { command: 'git status --short' })).toEqual({
      toolInput: 'git status --short',
      toolFile: 'git status --short',
      oldString: undefined,
      newString: undefined,
    })

    expect(
      extractToolDetails('Edit', {
        file_path: 'apps/hammurabi/modules/agents/page.tsx',
        old_string: 'before',
        new_string: 'after',
      }),
    ).toEqual({
      toolInput:
        '{"file_path":"apps/hammurabi/modules/agents/page.tsx","old_string":"before","new_string":"after"}',
      toolFile: 'apps/hammurabi/modules/agents/page.tsx',
      oldString: 'before',
      newString: 'after',
    })
  })

  it('extracts agent message text and subagent descriptions from nested payloads', () => {
    expect(
      extractAgentMessageText({
        content: [{ text: 'Inspect the diff' }, { message: { text: 'Run the tests' } }],
      }),
    ).toBe('Inspect the diff\nRun the tests')

    expect(
      extractSubagentDescription({
        description: 'Audit the replay path',
      }),
    ).toBe('Audit the replay path')
    expect(extractSubagentDescription({ prompt: 'Fallback prompt' })).toBe('Fallback prompt')
  })

  it('formats tool result output consistently', () => {
    expect(extractToolResultOutput('plain text')).toBe('plain text')
    expect(extractToolResultOutput({ status: 'ok', count: 2 })).toBe(
      '{\n  "status": "ok",\n  "count": 2\n}',
    )
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MsgItem } from '../../agents/messages/model'
import { ChatPane } from '../../../src/surfaces/hervald/ChatPane'

function renderMessages(messages: MsgItem[], themeClass = 'hv-light'): string {
  return renderToStaticMarkup(
    createElement(
      'div',
      { className: themeClass },
      createElement(ChatPane, {
        messages,
        approvals: [],
        onApprove: vi.fn(),
        onDeny: vi.fn(),
        onAnswer: vi.fn(),
      }),
    ),
  )
}

describe('ChatPane', () => {
  const markdownSample = [
    '**Bold** and *italic*',
    '',
    '```ts',
    'console.log("hi")',
    '```',
    '',
    '- one',
    '- two',
    '',
    '[link](https://example.com)',
  ].join('\n')

  it('renders agent markdown via the shared session message list', () => {
    const html = renderMessages([
      {
        id: 'agent-1',
        kind: 'agent',
        text: markdownSample,
      },
    ])

    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<pre><code class="language-ts">console.log(&quot;hi&quot;)')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('renders user markdown via the shared session message list', () => {
    const html = renderMessages([
      {
        id: 'user-1',
        kind: 'user',
        text: markdownSample,
      },
    ])

    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<pre><code class="language-ts">console.log(&quot;hi&quot;)')
    expect(html).toContain('<li>two</li>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('renders thinking blocks', () => {
    const html = renderMessages([
      {
        id: 'thinking-1',
        kind: 'thinking',
        text: 'Analyzing the dependency graph.',
      },
    ])

    expect(html).toContain('Thinking')
    expect(html).toContain('Analyzing the dependency graph.')
  })

  it('renders planning blocks', () => {
    const html = renderMessages([
      {
        id: 'planning-1',
        kind: 'planning',
        text: '- first\n- second',
        planningAction: 'proposed',
        planningPlan: '- first\n- second',
      },
    ])

    expect(html).toContain('Proposed Plan')
    expect(html).toContain('<li>first</li>')
  })

  it('keeps shared markdown bubbles theme-aware in light and dark shells', () => {
    const messages: MsgItem[] = [
      {
        id: 'agent-contrast',
        kind: 'agent',
        text: '# Heading\n\n`code`',
      },
      {
        id: 'planning-contrast',
        kind: 'planning',
        text: '1. review',
        planningAction: 'proposed',
        planningPlan: '1. review',
      },
    ]

    for (const themeClass of ['hv-light', 'hv-dark']) {
      const html = renderMessages(messages, themeClass)

      expect(html).toContain('msg-agent-md break-words text-zinc-900 dark:text-zinc-100')
      expect(html).toContain('msg-plan-markdown break-words text-zinc-900 dark:text-zinc-100')
      expect(html).not.toContain('msg-agent-md break-words text-zinc-100')
      expect(html).not.toContain('msg-plan-markdown break-words text-zinc-100')
      expect(html).not.toContain('prose-invert prose-sm max-w-none break-words text-zinc-100')
    }
  })

  it('renders tool blocks', () => {
    const html = renderMessages([
      {
        id: 'tool-1',
        kind: 'tool',
        text: 'Read package.json',
        toolName: 'Read',
        toolStatus: 'success',
        toolInput: 'package.json',
        toolOutput: '{"name":"hammurabi"}',
      },
    ])

    expect(html).toContain('Read')
    expect(html).toContain('done')
  })

  it('renders grouped tool calls', () => {
    const html = renderMessages([
      {
        id: 'tool-1',
        kind: 'tool',
        text: 'Read package.json',
        toolName: 'Read',
        toolStatus: 'success',
      },
      {
        id: 'tool-2',
        kind: 'tool',
        text: 'Glob src/**',
        toolName: 'Glob',
        toolStatus: 'running',
      },
    ])

    expect(html).toContain('2 tool calls')
    expect(html).toContain('1 running')
  })

  it('renders ask-user question blocks', () => {
    const html = renderMessages([
      {
        id: 'ask-1',
        kind: 'ask',
        text: 'Need approval',
        toolId: 'tool-ask-1',
        askQuestions: [
          {
            header: 'Deploy',
            question: 'Which environment?',
            multiSelect: false,
            options: [
              { label: 'staging' },
              { label: 'prod' },
            ],
          },
        ],
      },
    ])

    expect(html).toContain('Question')
    expect(html).toContain('Which environment?')
    expect(html).toContain('staging')
    expect(html).toContain('prod')
  })

  it('renders system dividers', () => {
    const html = renderMessages([
      {
        id: 'system-1',
        kind: 'system',
        text: 'Session started',
      },
    ])

    expect(html).toContain('Session started')
  })

  it('renders running sub-agent panels', () => {
    const html = renderMessages([
      {
        id: 'tool-agent-1',
        kind: 'tool',
        text: 'Dispatch swe-mbp',
        toolName: 'Agent',
        toolStatus: 'running',
        subagentDescription: 'Investigate flaky test',
      },
    ])

    expect(html).toContain('Running Sub-agents')
    expect(html).toContain('Investigate flaky test')
  })
})

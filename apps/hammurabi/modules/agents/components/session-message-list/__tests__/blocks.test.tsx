// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it } from 'vitest'
import { UserMessage } from '../blocks'
import { createUserMessage } from '../../../messages/model'

describe('UserMessage markdown rendering', () => {
  it('renders headings, lists, inline code, and fenced code blocks via ReactMarkdown', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const markdown = [
      '# Heading',
      '',
      '- item',
      '',
      '`inline` and',
      '',
      '```',
      'code block',
      '```',
    ].join('\n')

    flushSync(() => {
      root.render(createElement(UserMessage, { text: markdown }))
    })

    const wrapper = container.querySelector('.msg-user-md')
    if (!wrapper) {
      throw new Error('expected .msg-user-md wrapper to be rendered')
    }

    // Heading
    expect(wrapper.querySelector('h1')?.textContent).toBe('Heading')

    // List
    const list = wrapper.querySelector('ul')
    if (!list) {
      throw new Error('expected <ul> rendered from markdown list')
    }
    expect(list.querySelector('li')?.textContent).toBe('item')

    // Inline code and fenced code block — both produce <code> elements; fenced
    // block is wrapped in a <pre>.
    const codeElements = wrapper.querySelectorAll('code')
    expect(codeElements.length).toBeGreaterThanOrEqual(2)
    const inlineCode = Array.from(codeElements).find(
      (element) => element.textContent === 'inline',
    )
    expect(inlineCode).toBeDefined()

    const pre = wrapper.querySelector('pre')
    if (!pre) {
      throw new Error('expected <pre> rendered from fenced code block')
    }
    expect(pre.querySelector('code')?.textContent).toContain('code block')

    // The raw markdown source with literal backticks and hashes must not leak
    // into the DOM as visible text.
    expect(wrapper.textContent).not.toContain('# Heading')
    expect(wrapper.textContent).not.toContain('`inline`')
    expect(wrapper.textContent).not.toContain('```')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('createUserMessage text fidelity', () => {
  it('passes backticks through unchanged (no double-escape)', () => {
    const raw = 'hello `code`'
    const msg = createUserMessage('user-1', raw)
    expect(msg.text).toBe(raw)
    expect(msg.text).toBe('hello `code`')
    expect(msg.text).not.toContain('\\`')
  })

  it('preserves ${VAR} and heredoc-style content verbatim', () => {
    const raw = '- Branch: `${BRANCH_NAME}`'
    const msg = createUserMessage('user-2', raw)
    expect(msg.text).toBe(raw)
    expect(msg.text).not.toContain('\\`')
    expect(msg.text).not.toContain('\\$')
  })
})

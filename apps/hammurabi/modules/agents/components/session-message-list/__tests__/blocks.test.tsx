// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentActivityGroup,
  AgentMessage,
  ProviderActivityGroup,
  SubagentBlock,
  SystemDivider,
  ThinkingBlock,
  ToolBlock,
  ToolCallGroup,
  UserMessage,
} from '../blocks'
import { createUserMessage } from '../../../messages/model'

function mockClipboardWrite(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return writeText
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('UserMessage markdown rendering', () => {
  it('keeps bold chat markdown readable through Sumi-e semantic token classes', () => {
    const container = document.createElement('div')
    container.className = 'hv-dark hervald-chat-pane'
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement('div', undefined, [
          createElement(SystemDivider, { key: 'divider', text: 'session resumed' }),
          createElement(UserMessage, { key: 'user', text: '**Bold user text** with `inline code`.' }),
          createElement(AgentMessage, { key: 'agent', text: '**Bold agent text** with `inline code`.' }),
        ]),
      )
    })

    const userBubble = container.querySelector<HTMLElement>('.msg-user')
    const agentBubble = container.querySelector<HTMLElement>('.msg-agent')
    const dividerLine = container.querySelector<HTMLElement>('.msg-system-line')
    if (!userBubble || !agentBubble || !dividerLine) {
      throw new Error('expected chat token surfaces')
    }

    expect(userBubble.className).toContain('bg-[var(--hv-chat-user-bg,var(--hv-fg))]')
    expect(userBubble.className).toContain('text-[color:var(--hv-chat-user-fg,var(--hv-fg-inverse))]')
    expect(agentBubble.querySelector('strong')?.textContent).toBe('Bold agent text')
    expect(userBubble.querySelector('strong')?.textContent).toBe('Bold user text')
    expect(dividerLine.className).toContain('bg-[var(--hv-border-hair)]')

    const html = container.innerHTML
    expect(html).not.toContain('text-white')
    expect(html).not.toContain('bg-white')
    expect(html).not.toContain('text-sumi')
    expect(html).not.toContain('bg-washi')
    expect(html).not.toContain('border-ink')
    expect(html).not.toContain('text-amber')
    expect(html).not.toContain('text-violet')
    expect(html).not.toContain('text-red')
    expect(html).not.toContain('bg-red')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('marks the awaiting-input system divider for mobile suppression', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(SystemDivider, { text: 'AWAITING INPUT' }))
    })

    expect(container.querySelector('.msg-system--awaiting-input')).not.toBeNull()

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

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

  it('copies whole agent messages to the clipboard', async () => {
    const writeText = mockClipboardWrite()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const messageText = [
      'Use this:',
      '',
      'Hey Daniel - felt good from my side as well.',
    ].join('\n')

    flushSync(() => {
      root.render(createElement(AgentMessage, { text: messageText }))
    })

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy agent message"]')
    if (!copyButton) {
      throw new Error('expected agent message copy button')
    }

    const agentBubble = container.querySelector<HTMLElement>('.msg-agent')
    const agentActions = container.querySelector<HTMLElement>('.msg-agent-actions')
    if (!agentBubble || !agentActions) {
      throw new Error('expected agent bubble and action row')
    }
    expect(agentBubble.contains(copyButton)).toBe(false)
    expect(agentActions.contains(copyButton)).toBe(true)
    expect(agentActions.previousElementSibling).toBe(agentBubble)

    copyButton.click()
    await flushMicrotasks()

    expect(writeText).toHaveBeenCalledWith(messageText)

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders user message copy actions below the bubble', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(UserMessage, { text: 'can I add these to my apple care one?' }))
    })

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy user message"]')
    const userStack = container.querySelector<HTMLElement>('.msg-user-stack')
    const userBubble = container.querySelector<HTMLElement>('.msg-user')
    const userActions = container.querySelector<HTMLElement>('.msg-user-actions')
    if (!copyButton || !userStack || !userBubble || !userActions) {
      throw new Error('expected user bubble copy action row')
    }

    expect(userStack.className).toContain('w-full')
    expect(userStack.className).toContain('max-w-[85%]')
    expect(userStack.className).toContain('min-w-0')
    expect(userBubble.contains(copyButton)).toBe(false)
    expect(userActions.contains(copyButton)).toBe(true)
    expect(userActions.previousElementSibling).toBe(userBubble)

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('copies fenced markdown blocks independently from the full message', async () => {
    const writeText = mockClipboardWrite()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const markdown = [
      'Use this:',
      '',
      '```',
      'Hey Daniel - felt good from my side as well.',
      '',
      'For next week after Wednesday, I am available.',
      '```',
    ].join('\n')

    flushSync(() => {
      root.render(createElement(AgentMessage, { text: markdown }))
    })

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy markdown block"]')
    if (!copyButton) {
      throw new Error('expected markdown block copy button')
    }

    copyButton.click()
    await flushMicrotasks()

    expect(writeText).toHaveBeenCalledWith([
      'Hey Daniel - felt good from my side as well.',
      '',
      'For next week after Wednesday, I am available.',
    ].join('\n'))

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders safe Markdown images inline with bounded responsive styling in agent messages', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: [
          'Here are the generated images.',
          '',
          '![Remote chart](https://example.com/chart.png)',
          '![Inline preview](data:image/png;base64,abc123)',
        ].join('\n'),
      }))
    })

    const images = container.querySelectorAll<HTMLImageElement>('.msg-agent-md img')
    expect(images).toHaveLength(2)
    expect(images[0]?.getAttribute('src')).toBe('https://example.com/chart.png')
    expect(images[0]?.getAttribute('alt')).toBe('Remote chart')
    expect(images[0]?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(images[1]?.getAttribute('src')).toBe('data:image/png;base64,abc123')
    expect(images[1]?.getAttribute('alt')).toBe('Inline preview')
    expect(images[1]?.getAttribute('referrerpolicy')).toBe('no-referrer')

    for (const image of images) {
      expect(image.className).toContain('max-w-full')
      expect(image.className).toMatch(/max-h-/u)
    }
    expect(container.textContent).not.toContain('![Remote chart]')
    expect(container.textContent).not.toContain('![Inline preview]')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('does not render unsafe local Markdown image paths as browser images', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: [
          'Local artifacts:',
          '',
          '![File URL](file:///home/builder/App/apps/hammurabi/artifact.png)',
          '![Absolute path](/home/builder/App/apps/hammurabi/absolute.png)',
          '![Relative path](./screenshots/result.png)',
        ].join('\n'),
        onOpenWorkspaceFile,
      }))
    })

    expect(container.querySelectorAll('.msg-agent-md img')).toHaveLength(0)

    const buttons = container.querySelectorAll<HTMLButtonElement>('.msg-agent-md .workspace-file-link')
    expect(buttons).toHaveLength(3)

    flushSync(() => {
      buttons[0]?.click()
      buttons[1]?.click()
      buttons[2]?.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenNthCalledWith(
      1,
      '/home/builder/App/apps/hammurabi/artifact.png',
    )
    expect(onOpenWorkspaceFile).toHaveBeenNthCalledWith(
      2,
      '/home/builder/App/apps/hammurabi/absolute.png',
    )
    expect(onOpenWorkspaceFile).toHaveBeenNthCalledWith(3, './screenshots/result.png')
    expect(container.innerHTML).not.toContain('file:///home/builder/App')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders normalized structured assistant image attachments inline', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: 'Generated image result',
        images: [{ mediaType: 'image/webp', data: 'assistant-image-base64' }],
      }))
    })

    const image = container.querySelector<HTMLImageElement>('.msg-agent img')
    if (!image) {
      throw new Error('expected normalized assistant image attachment')
    }

    expect(image.getAttribute('src')).toBe('data:image/webp;base64,assistant-image-base64')
    expect(image.getAttribute('alt')).toBe('assistant image')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image.className).toContain('max-w')
    expect(image.className).toMatch(/max-h-/u)
    expect(container.querySelector('.msg-agent-md')?.textContent).toContain('Generated image result')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps existing user image attachments inline without rendering the image placeholder text', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(UserMessage, {
        text: '[image]',
        images: [{ mediaType: 'image/png', data: 'user-image-base64' }],
      }))
    })

    const image = container.querySelector<HTMLImageElement>('.msg-user .msg-attachment')
    if (!image) {
      throw new Error('expected user image attachment')
    }

    expect(image.getAttribute('src')).toBe('data:image/png;base64,user-image-base64')
    expect(image.getAttribute('alt')).toBe('attachment')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(container.textContent).not.toContain('[image]')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('prevents user-authored remote markdown images from leaking referrers', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(UserMessage, {
        text: '![uploaded chart](https://example.com/chart.png)',
      }))
    })

    const image = container.querySelector<HTMLImageElement>('.msg-user img')
    if (!image) {
      throw new Error('expected user markdown image')
    }

    expect(image.getAttribute('src')).toBe('https://example.com/chart.png')
    expect(image.getAttribute('alt')).toBe('uploaded chart')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('opens local file links through the workspace callback', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(UserMessage, {
        text: '[Open file](/home/builder/App/apps/hammurabi/README.md)',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('/home/builder/App/apps/hammurabi/README.md')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('strips source line suffixes from markdown file links before opening workspace files', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(UserMessage, {
        text: '[Open row](/home/builder/App/apps/hammurabi/modules/command-room/components/desktop/SessionRow.tsx:72)',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
      '/home/builder/App/apps/hammurabi/modules/command-room/components/desktop/SessionRow.tsx',
    )

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('opens backticked tilde file paths in agent messages through the workspace callback', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: 'Updated `~/App/agent-skills/general-skills/write-visual-email/SKILL.md`.',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('~/App/agent-skills/general-skills/write-visual-email/SKILL.md')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('strips source line and column suffixes from backticked tilde file paths', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenWorkspaceFile = vi.fn()

    flushSync(() => {
      root.render(createElement(AgentMessage, {
        text: 'Updated `~/App/agent-skills/general-skills/write-visual-email/SKILL.md:12:4`.',
        onOpenWorkspaceFile,
      }))
    })

    const button = container.querySelector<HTMLButtonElement>('.workspace-file-link')
    if (!button) {
      throw new Error('expected workspace file link button')
    }

    flushSync(() => {
      button.click()
    })

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('~/App/agent-skills/general-skills/write-visual-email/SKILL.md')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('session message status blocks', () => {
  it('renders Agent tool calls as full sub-agent blocks with nested activity', () => {
    const container = document.createElement('div')
    container.className = 'hv-dark hervald-chat-pane'
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement(SubagentBlock, {
          msg: {
            id: 'agent-tool-1',
            kind: 'tool',
            text: '',
            toolName: 'Agent',
            toolStatus: 'running',
            subagentDescription: 'Investigate flaky chat rendering',
            children: [
              {
                id: 'agent-child-1',
                kind: 'system',
                text: 'Read SessionMessageList',
              },
            ],
          },
          onAnswer: () => undefined,
        }),
      )
    })

    const block = container.querySelector<HTMLElement>('.msg-subagent')
    if (!block) {
      throw new Error('expected sub-agent block')
    }

    expect(block.textContent).toContain('Sub-agent')
    expect(block.textContent).toContain('Investigate flaky chat rendering')
    expect(block.textContent).toContain('running')
    expect(block.textContent).not.toContain('Read SessionMessageList')
    expect(block.textContent).not.toContain('Agent: Investigate flaky chat rendering')

    const toggle = container.querySelector<HTMLButtonElement>('.msg-subagent-header')
    if (!toggle) {
      throw new Error('expected sub-agent toggle')
    }
    flushSync(() => {
      toggle.click()
    })

    expect(block.textContent).toContain('activity')
    expect(block.textContent).toContain('Read SessionMessageList')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('uses Sumi-e semantic tokens for thinking and tool statuses', () => {
    const container = document.createElement('div')
    container.className = 'hv-dark hervald-chat-pane'
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(
        createElement('div', undefined, [
          createElement(ThinkingBlock, { key: 'thinking', text: 'Inspecting contrast.' }),
          createElement(ToolBlock, {
            key: 'tool',
            msg: {
              id: 'tool-1',
              kind: 'tool',
              text: 'Edit file',
              toolName: 'Edit',
              toolStatus: 'error',
              oldString: 'old',
              newString: 'new',
            },
            onAnswer: () => undefined,
          }),
          createElement(ToolCallGroup, {
            key: 'group',
            tools: [
              {
                id: 'tool-2',
                kind: 'tool',
                text: 'Read file',
                toolName: 'Read',
                toolStatus: 'running',
              },
            ],
            onAnswer: () => undefined,
          }),
        ]),
      )
    })

    const toolHeader = container.querySelector<HTMLButtonElement>('.msg-tool-header')
    if (!toolHeader) {
      throw new Error('expected tool header')
    }
    flushSync(() => {
      toolHeader.click()
    })

    const html = container.innerHTML
    expect(html).toContain('text-[color:var(--hv-fg-muted)]')
    expect(html).toContain('text-[color:var(--hv-accent-warning)]')
    expect(html).toContain('text-[color:var(--hv-accent-danger)]')
    expect(html).toContain('bg-[var(--hv-accent-danger-wash)]')
    expect(html).not.toContain('text-amber')
    expect(html).not.toContain('text-violet')
    expect(html).not.toContain('text-red')
    expect(html).not.toContain('bg-red')
    expect(html).not.toContain('border-violet')
    expect(html).not.toContain('border-amber')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('AgentActivityGroup', () => {
  it('collapses main-agent operational activity by default', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(AgentActivityGroup, {
        messages: [
          {
            id: 'tool-1',
            kind: 'tool',
            text: '',
            toolName: 'Read',
            toolStatus: 'success',
            toolInput: 'package.json',
          },
          {
            id: 'provider-1',
            kind: 'provider',
            text: 'Token usage updated',
            transcript: {
              source: { provider: 'codex', backend: 'rpc' },
              providerEventType: 'thread/tokenUsage/updated',
            },
          },
          {
            id: 'thinking-1',
            kind: 'thinking',
            text: 'Checking the message stream.',
          },
        ],
        onAnswer: () => undefined,
      }))
    })

    const group = container.querySelector<HTMLElement>('.msg-agent-activity')
    if (!group) {
      throw new Error('expected agent activity group')
    }

    expect(group.textContent).toContain('Main agent')
    expect(group.textContent).toContain('1 tool call')
    expect(group.textContent).toContain('1 event')
    expect(group.textContent).toContain('thinking')
    expect(group.textContent).not.toContain('package.json')
    expect(group.textContent).not.toContain('Checking the message stream.')

    const toggle = container.querySelector<HTMLButtonElement>('.msg-agent-activity-toggle')
    if (!toggle) {
      throw new Error('expected activity group toggle')
    }
    flushSync(() => {
      toggle.click()
    })

    expect(group.textContent).toContain('Read')
    expect(group.textContent).toContain('Token usage updated')
    expect(group.textContent).toContain('Checking the message stream.')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('labels collapsed activity by sub-agent count when subagents are present', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(AgentActivityGroup, {
        messages: [
          {
            id: 'agent-tool-1',
            kind: 'tool',
            text: '',
            toolName: 'Agent',
            toolStatus: 'running',
            subagentDescription: 'Investigate transcript noise',
            children: [
              {
                id: 'agent-child-1',
                kind: 'system',
                text: 'Read render-items.ts',
              },
            ],
          },
          {
            id: 'provider-1',
            kind: 'provider',
            text: 'Thread status changed',
            transcript: {
              source: { provider: 'claude', backend: 'cli' },
              providerEventType: 'thread/status/changed',
            },
          },
        ],
        onAnswer: () => undefined,
      }))
    })

    const group = container.querySelector<HTMLElement>('.msg-agent-activity')
    if (!group) {
      throw new Error('expected agent activity group')
    }

    expect(group.textContent).toContain('1 sub-agent')
    expect(group.textContent).toContain('1 running')
    expect(group.textContent).not.toContain('Investigate transcript noise')

    const groupToggle = container.querySelector<HTMLButtonElement>('.msg-agent-activity-toggle')
    if (!groupToggle) {
      throw new Error('expected activity group toggle')
    }
    flushSync(() => {
      groupToggle.click()
    })

    expect(group.textContent).toContain('Investigate transcript noise')
    expect(group.textContent).not.toContain('Read render-items.ts')

    const subagentToggle = container.querySelector<HTMLButtonElement>('.msg-subagent-header')
    if (!subagentToggle) {
      throw new Error('expected sub-agent toggle')
    }
    flushSync(() => {
      subagentToggle.click()
    })

    expect(group.textContent).toContain('Read render-items.ts')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('ProviderActivityGroup', () => {
  it('keeps raw provider rows hidden until the group is expanded', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => {
      root.render(createElement(ProviderActivityGroup, {
        messages: [
          {
            id: 'provider-1',
            kind: 'provider',
            text: 'codex raw: thread/tokenUsage/updated',
            transcript: {
              source: { provider: 'codex', backend: 'rpc' },
              providerEventType: 'thread/tokenUsage/updated',
              providerPayload: { tokenUsage: { total: { totalTokens: 42 } } },
            },
          },
          {
            id: 'provider-2',
            kind: 'provider',
            text: 'codex raw: item/started',
            transcript: {
              source: { provider: 'codex', backend: 'rpc' },
              providerEventType: 'item/started',
              providerPayload: { item: { type: 'agentMessage' } },
            },
          },
        ],
      }))
    })

    expect(container.querySelector('.msg-provider-group')?.textContent).toContain('2 events')
    expect(container.querySelectorAll('.msg-provider')).toHaveLength(0)

    const toggle = container.querySelector<HTMLButtonElement>('.msg-provider-group-toggle')
    if (!toggle) {
      throw new Error('expected provider group toggle')
    }
    flushSync(() => {
      toggle.click()
    })

    expect(container.querySelectorAll('.msg-provider')).toHaveLength(2)
    expect(container.textContent).toContain('thread/tokenUsage/updated')
    expect(container.textContent).toContain('item/started')

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

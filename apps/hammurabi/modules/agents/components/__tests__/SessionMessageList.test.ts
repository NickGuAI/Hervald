// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionMessageList } from '../SessionMessageList'
import type { MsgItem } from '../session-messages'

const THINKING_TEXT = 'Reason through the three git repos and compare status output.'

describe('SessionMessageList thinking blocks', () => {
  it('collapses replayed thinking content under main-agent activity by default', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages: MsgItem[] = [
      {
        id: 'thinking-1',
        kind: 'thinking',
        text: THINKING_TEXT,
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer: () => undefined }))
    })

    const toggle = container.querySelector<HTMLButtonElement>('.msg-agent-activity-toggle')
    if (!toggle) {
      throw new Error('expected activity toggle button')
    }
    const chevron = toggle.querySelector('svg.lucide-chevron-right')
    if (!chevron) {
      throw new Error('expected activity chevron icon')
    }

    expect(container.textContent).toContain('Main agent')
    expect(container.textContent).toContain('thinking')
    expect(container.textContent).not.toContain(THINKING_TEXT)
    expect(chevron.getAttribute('class')).not.toContain('rotate-90')

    flushSync(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain(THINKING_TEXT)
    expect(chevron.getAttribute('class')).toContain('rotate-90')

    flushSync(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).not.toContain(THINKING_TEXT)
    expect(chevron.getAttribute('class')).not.toContain('rotate-90')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('SessionMessageList queued transcript turns', () => {
  it('renders a processed queued user turn exactly once from the message projection', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages: MsgItem[] = [
      {
        id: 'queued-user-1',
        kind: 'user',
        text: 'processed queued follow-up',
      },
      {
        id: 'agent-1',
        kind: 'agent',
        text: 'I received the follow-up.',
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer: () => undefined }))
    })

    expect(container.textContent?.match(/processed queued follow-up/g) ?? []).toHaveLength(1)

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('SessionMessageList inline image panes', () => {
  it('renders assistant Markdown and structured images in desktop and mobile chat panes', () => {
    const messages: MsgItem[] = [
      {
        id: 'agent-markdown-image',
        kind: 'agent',
        text: 'Desktop and mobile preview:\n\n![Chart](https://example.com/chart.png)',
      },
      {
        id: 'agent-structured-image',
        kind: 'agent',
        text: '',
        images: [{ mediaType: 'image/png', data: 'structured-image-base64', alt: 'Generated chart' }],
      },
      {
        id: 'user-image-regression',
        kind: 'user',
        text: '[image]',
        images: [{ mediaType: 'image/png', data: 'user-image-base64' }],
      },
    ]

    for (const width of [1024, 360]) {
      const container = document.createElement('div')
      container.className = 'hervald-chat-pane hv-light'
      container.style.width = `${width}px`
      document.body.appendChild(container)
      const root = createRoot(container)

      flushSync(() => {
        root.render(createElement(SessionMessageList, {
          messages,
          onAnswer: () => undefined,
        }))
      })

      const agentBubble = container.querySelector<HTMLElement>('.msg-agent')
      if (!agentBubble) {
        throw new Error(`expected agent bubble at ${width}px`)
      }
      const inlineImage = agentBubble.querySelector<HTMLImageElement>('.msg-agent-md .msg-inline-image')
      const structuredImage = container.querySelector<HTMLImageElement>('.msg-agent-attachments .msg-attachment')
      const userImage = container.querySelector<HTMLImageElement>('.msg-user .msg-attachment')

      expect(inlineImage?.getAttribute('src')).toBe('https://example.com/chart.png')
      expect(inlineImage?.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(inlineImage?.className).toContain('max-w-full')
      expect(structuredImage?.getAttribute('src')).toBe('data:image/png;base64,structured-image-base64')
      expect(structuredImage?.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(structuredImage?.className).toContain('max-w-full')
      expect(userImage?.getAttribute('src')).toBe('data:image/png;base64,user-image-base64')
      expect(container.textContent).not.toContain('[image]')

      flushSync(() => {
        root.unmount()
      })
      container.remove()
    }
  })
})

describe('SessionMessageList planning blocks', () => {
  it('renders enter, proposed, and decision planning messages with collapsible plan text', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages: MsgItem[] = [
      {
        id: 'planning-enter',
        kind: 'planning',
        text: '',
        planningAction: 'enter',
      },
      {
        id: 'planning-proposed',
        kind: 'planning',
        text: '',
        planningAction: 'proposed',
        planningPlan: '1. Capture the event\n2. Render the plan',
      },
      {
        id: 'planning-decision',
        kind: 'planning',
        text: '',
        planningAction: 'decision',
        planningApproved: true,
        planningMessage: 'Looks good. Continue.',
      },
      {
        id: 'ask-1',
        kind: 'ask',
        text: '',
        toolId: 'ask-tool-1',
        toolName: 'AskUserQuestion',
        askQuestions: [
          {
            question: 'Keep ask rendering?',
            header: 'Plan',
            options: [{ label: 'Yes', description: 'Keep it visible' }],
            multiSelect: false,
          },
        ],
        askAnswered: false,
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer: () => undefined }))
    })

    expect(container.textContent).toContain('Agent entered plan mode')
    expect(container.textContent).toContain('Proposed Plan')
    expect(container.textContent).toContain('Capture the event')
    expect(container.textContent).toContain('Approved')
    expect(container.textContent).toContain('Looks good. Continue.')
    expect(container.textContent).toContain('Keep ask rendering?')

    const buttons = Array.from(container.querySelectorAll('button'))
    const proposedToggle = buttons.find((button) => button.textContent?.includes('Proposed Plan'))
    if (!proposedToggle) {
      throw new Error('expected proposed plan toggle button')
    }

    flushSync(() => {
      proposedToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('Capture the event')

    flushSync(() => {
      proposedToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('Capture the event')

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders plan approval asks and submits provider decisions', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onAnswer = vi.fn()

    const messages: MsgItem[] = [
      {
        id: 'plan-approval',
        kind: 'ask',
        text: '',
        toolId: 'plan-exit',
        toolName: 'ExitPlanMode',
        askInteractionKind: 'plan_approval',
        askAnswered: false,
        planApprovalPlan: '1. Inspect stream handling\n2. Patch replay',
        planApprovalApproveLabel: 'Approve',
        planApprovalRejectLabel: 'Reject',
        planApprovalCustomResponseLabel: 'Add response',
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer }))
    })

    expect(container.textContent).toContain('Plan Approval')
    expect(container.textContent).toContain('Inspect stream handling')

    const textarea = container.querySelector('textarea')
    if (!textarea) {
      throw new Error('expected plan response textarea')
    }
    const textareaValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set
    flushSync(() => {
      textareaValueSetter?.call(textarea, 'Ship this plan.')
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    const approveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Approve'))
    if (!approveButton) {
      throw new Error('expected approve button')
    }
    flushSync(() => {
      approveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onAnswer).toHaveBeenCalledWith('plan-exit', {
      decision: ['approve'],
      message: ['Ship this plan.'],
    })

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders Codex MCP user questions without the plan approval card', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onAnswer = vi.fn()

    const messages: MsgItem[] = [
      {
        id: 'codex-mcp-question',
        kind: 'ask',
        text: '',
        toolId: 'codex-mcp-elicitation-913',
        toolName: 'Codex MCP Elicitation',
        askInteractionKind: 'ask_user_question',
        askQuestions: [
          {
            id: 'response',
            header: 'Response',
            question: 'Which value should Codex use?',
            options: [],
            multiSelect: false,
          },
        ] as MsgItem['askQuestions'],
        askAnswered: false,
      },
    ]

    flushSync(() => {
      root.render(createElement(SessionMessageList, { messages, onAnswer }))
    })

    expect(container.textContent).toContain('Question')
    expect(container.textContent).toContain('Which value should Codex use?')
    expect(container.textContent).not.toContain('Plan Approval')

    const input = container.querySelector('input')
    if (!input) {
      throw new Error('expected free-text answer input')
    }
    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    flushSync(() => {
      inputValueSetter?.call(input, 'Use the default.')
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    const submitButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Submit'))
    if (!submitButton) {
      throw new Error('expected submit button')
    }
    flushSync(() => {
      submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onAnswer).toHaveBeenCalledWith('codex-mcp-elicitation-913', {
      response: ['Use the default.'],
    })

    flushSync(() => {
      root.unmount()
    })
    container.remove()
  })
})

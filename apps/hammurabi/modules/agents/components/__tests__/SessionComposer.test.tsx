// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionComposer } from '../SessionComposer'

const speechRecognitionMock = {
  isListening: false,
  transcript: '',
  startListening: vi.fn(),
  stopListening: vi.fn(),
  isSupported: true,
}

vi.mock('@/hooks/use-openai-transcription', () => ({
  useOpenAITranscriptionConfig: () => ({ data: { openaiConfigured: false } }),
  useOpenAITranscription: () => ({
    isSupported: false,
    isListening: false,
    transcript: '',
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-speech-recognition', () => ({
  useSpeechRecognition: () => speechRecognitionMock,
}))

vi.mock('../SkillsPicker', () => ({
  SkillsPicker: ({ visible }: { visible: boolean }) => (
    <div data-testid="skills-picker" data-visible={String(visible)} />
  ),
}))

type ComposerProps = ComponentProps<typeof SessionComposer>

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    sessionName: 'commander-atlas',
    theme: 'dark',
    onSend: vi.fn(() => true),
    onQueue: vi.fn(() => true),
    ...overrides,
  }
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(<SessionComposer {...buildProps(overrides)} />)
  })
}

function composerRow(): HTMLElement {
  const row = document.body.querySelector('.composer-row')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector(`button[aria-label="${label}"]`)
  expect(button, `Expected button with aria-label ${label}`).not.toBeNull()
  return button as HTMLButtonElement
}

function setDraftText(value: string) {
  const textarea = document.body.querySelector('textarea')
  expect(textarea).not.toBeNull()

  flushSync(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    descriptor?.set?.call(textarea, value)
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    textarea?.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  speechRecognitionMock.isListening = false
  speechRecognitionMock.transcript = ''
  speechRecognitionMock.isSupported = true
  speechRecognitionMock.startListening.mockReset()
  speechRecognitionMock.stopListening.mockReset()
})

afterEach(() => {
  if (root) {
    flushSync(() => {
      root?.unmount()
    })
  }

  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('SessionComposer', () => {
  it('does not render the composer-mode-toggle', async () => {
    renderComposer()

    expect(document.body.querySelector('.composer-mode-toggle')).toBeNull()
  })

  it('does not render a markdown preview', async () => {
    renderComposer()
    setDraftText('Preview mode is gone')

    expect(document.body.querySelector('textarea')).not.toBeNull()
    expect(document.body.querySelector('.composer-preview-markdown')).toBeNull()
  })

  it('ignores Cmd+Shift+P after the preview shortcut was removed', async () => {
    renderComposer()
    setDraftText('Stay in the textarea')

    flushSync(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'P',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }))
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    expect(textarea?.value).toBe('Stay in the textarea')
    expect(document.body.querySelector('.composer-preview-markdown')).toBeNull()
  })

  it('renders exactly three bottom-row controls in the mobile variant', async () => {
    renderComposer({ variant: 'mobile' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(3)
    expect(findButtonByLabel('Add to chat')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(findButtonByLabel('Send message')).toBeDefined()
  })

  it('sends from the mobile primary action when the session is idle', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
      onQueue,
    })
    setDraftText('Ship the mobile redesign')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    expect(onSend).toHaveBeenCalledWith({ text: 'Ship the mobile redesign', images: undefined })
    expect(onQueue).not.toHaveBeenCalled()
  })

  it('queues from the mobile primary action while streaming without calling send', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue,
    })
    setDraftText('Queue this follow-up')

    flushSync(() => {
      findButtonByLabel('Add to queue').click()
    })

    expect(onQueue).toHaveBeenCalledWith({ text: 'Queue this follow-up', images: undefined })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps the mobile primary action sendable while streaming when queue drafts are unsupported', async () => {
    const onSend = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue: undefined,
    })
    setDraftText('Keep follow-up send enabled')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    expect(onSend).toHaveBeenCalledWith({ text: 'Keep follow-up send enabled', images: undefined })
  })

  it('keeps the desktop variant on the existing five-control row', async () => {
    renderComposer({ variant: 'desktop' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(5)
    expect(findButtonByLabel('Attach image')).toBeDefined()
    expect(findButtonByLabel('Skills')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(document.body.textContent).toContain('Queue')
  })
})

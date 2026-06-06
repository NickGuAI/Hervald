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

const composerAbilitiesMock = vi.hoisted(() => ({
  customAbilitiesEnabled: false,
  addCustomAbility: vi.fn(),
  removeCustomAbility: vi.fn(),
  useComposerAbilities: vi.fn(() => ({
    abilities: [
      {
        id: 'think-hard',
        label: 'Think Hard',
        prompt: 'Think ultra hard internally and keep the user-visible answer concise.',
        enabled: true,
        source: 'default',
      },
    ],
    settings: {
      defaultAbilities: [],
      customAbilities: [],
      customAbilitiesEnabled: composerAbilitiesMock.customAbilitiesEnabled,
    },
    customAbilitiesEnabled: composerAbilitiesMock.customAbilitiesEnabled,
    addCustomAbility: composerAbilitiesMock.addCustomAbility,
    removeCustomAbility: composerAbilitiesMock.removeCustomAbility,
    isLoading: false,
    isSaving: false,
  })),
}))

const composerSkillSlotsMock = vi.hoisted(() => ({
  primarySkillName: null as string | null,
  setPrimarySkillName: vi.fn(async (skillName: string) => {
    composerSkillSlotsMock.primarySkillName = skillName.replace(/^\/+/u, '')
    return true
  }),
  clearPrimarySkillName: vi.fn(async () => {
    composerSkillSlotsMock.primarySkillName = null
    return true
  }),
  useComposerSkillSlots: vi.fn(() => ({
    settings: {
      slots: [{
        id: 'primary',
        skillName: composerSkillSlotsMock.primarySkillName,
      }],
    },
    primarySkillName: composerSkillSlotsMock.primarySkillName,
    setPrimarySkillName: composerSkillSlotsMock.setPrimarySkillName,
    clearPrimarySkillName: composerSkillSlotsMock.clearPrimarySkillName,
    isLoading: false,
    isSaving: false,
  })),
}))

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

vi.mock('@/hooks/use-composer-abilities', () => ({
  useComposerAbilities: composerAbilitiesMock.useComposerAbilities,
}))

vi.mock('@/hooks/use-composer-skill-slots', () => ({
  useComposerSkillSlots: composerSkillSlotsMock.useComposerSkillSlots,
}))

vi.mock('../SkillsPicker', () => ({
  SkillsPicker: ({
    visible,
    onSelectSkill,
  }: {
    visible: boolean
    onSelectSkill: (command: string) => void
  }) => (
    <div data-testid="skills-picker" data-visible={String(visible)}>
      {visible && (
        <button type="button" aria-label="Pick create-quests skill" onClick={() => onSelectSkill('/create-quests')}>
          /create-quests
        </button>
      )}
    </div>
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
  composerAbilitiesMock.customAbilitiesEnabled = false
  composerAbilitiesMock.addCustomAbility.mockReset()
  composerAbilitiesMock.removeCustomAbility.mockReset()
  composerAbilitiesMock.useComposerAbilities.mockClear()
  composerSkillSlotsMock.primarySkillName = null
  composerSkillSlotsMock.setPrimarySkillName.mockClear()
  composerSkillSlotsMock.clearPrimarySkillName.mockClear()
  composerSkillSlotsMock.useComposerSkillSlots.mockClear()
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
  vi.useRealTimers()
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

  it('restores a just-typed draft after immediate unmount before the debounce advances', async () => {
    vi.useFakeTimers()
    renderComposer({
      sessionName: 'conversation-conv-1',
      variant: 'mobile',
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()

    flushSync(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      descriptor?.set?.call(textarea, 'draft before debounce')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
      textarea?.dispatchEvent(new Event('change', { bubbles: true }))
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null

    expect(window.localStorage.getItem('hammurabi:draft:conversation-conv-1')).toBe('draft before debounce')

    renderComposer({
      sessionName: 'conversation-conv-1',
      variant: 'desktop',
    })

    await vi.waitFor(() => {
      const restoredTextarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
      expect(restoredTextarea?.value).toBe('draft before debounce')
    })
  })

  it('flushes the latest draft on pagehide before the debounce advances', async () => {
    vi.useFakeTimers()
    renderComposer({ sessionName: 'conversation-conv-1' })
    setDraftText('flush from pagehide')

    expect(window.localStorage.getItem('hammurabi:draft:conversation-conv-1')).toBeNull()

    window.dispatchEvent(new Event('pagehide'))

    expect(window.localStorage.getItem('hammurabi:draft:conversation-conv-1')).toBe('flush from pagehide')
  })

  it('renders composer abilities in the mobile variant when queue access is unavailable', async () => {
    renderComposer({ variant: 'mobile' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(5)
    expect(findButtonByLabel('Add to chat')).toBeDefined()
    expect(findButtonByLabel('Configure quick skill slot')).toBeDefined()
    expect(findButtonByLabel('Enable Think Hard ability')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(findButtonByLabel('Send message')).toBeDefined()
    expect(document.body.querySelector('button[aria-label="Add custom composer ability"]')).toBeNull()
  })

  it('keeps the mobile textarea above a compact action row with mic next to send', async () => {
    renderComposer({ variant: 'mobile' })

    const composer = document.body.querySelector('.hervald-session-composer--mobile')
    expect(composer).not.toBeNull()

    const row = composerRow()
    expect(row.querySelector('.composer-field-stack textarea')).toBeNull()
    expect(composer?.querySelector(':scope > .input-bar > .composer-field-stack textarea')).not.toBeNull()
    expect(row.querySelector('button[aria-label="Add to chat"]')).not.toBeNull()
    expect(row.querySelector('button[aria-label="Configure quick skill slot"]')).not.toBeNull()
    expect(row.querySelector('button[aria-label="Enable Think Hard ability"]')).not.toBeNull()

    const primaryActions = row.querySelector('.composer-mobile-primary-actions')
    expect(primaryActions?.children.item(0)?.getAttribute('aria-label')).toBe('Start voice input')
    expect(primaryActions?.children.item(1)?.getAttribute('aria-label')).toBe('Send message')
  })

  it('renders the mobile queue button and opens the queue panel with controls', async () => {
    const onClearQueue = vi.fn()
    const onMoveQueuedMessage = vi.fn()
    const onRemoveQueuedMessage = vi.fn()

    renderComposer({
      variant: 'mobile',
      queueSnapshot: {
        currentMessage: null,
        items: [{
          id: 'queued-1',
          text: 'Investigate the mobile shell gap',
          priority: 'normal',
          queuedAt: '2026-04-21T15:00:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      },
      onClearQueue,
      onMoveQueuedMessage,
      onRemoveQueuedMessage,
    })

    const queueButton = findButtonByLabel('Open queue')
    expect(queueButton.textContent?.trim()).toBe('1/8')

    flushSync(() => {
      queueButton.click()
    })

    const panel = document.body.querySelector('[data-testid="queue-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Investigate the mobile shell gap')
    expect(panel?.textContent).toContain('Clear')
    expect(document.body.querySelector('button[aria-label="Move queued message 1 up"]')).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="Move queued message 1 down"]')).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="Remove queued message 1"]')).not.toBeNull()
  })

  it('queues the current draft from the explicit mobile queue message button', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
      onQueue,
      queueSnapshot: {
        currentMessage: null,
        items: [],
        totalCount: 0,
        maxSize: 8,
      },
    })

    const queueMessageButton = findButtonByLabel('Queue message')
    expect(queueMessageButton.disabled).toBe(true)

    setDraftText('Queue this on mobile')
    expect(queueMessageButton.disabled).toBe(false)

    flushSync(() => {
      queueMessageButton.click()
    })

    expect(onQueue).toHaveBeenCalledWith({ text: 'Queue this on mobile', images: undefined })
    expect(onSend).not.toHaveBeenCalled()
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

  it('clears the mobile draft immediately after an async send is accepted', async () => {
    const onSend = vi.fn(() => Promise.resolve(true))

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
    })
    setDraftText('Clear this after tapping send')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea?.value).toBe('')
    expect(onSend).toHaveBeenCalledWith({ text: 'Clear this after tapping send', images: undefined })
  })

  it('keeps the mobile draft when send is rejected synchronously', async () => {
    const onSend = vi.fn(() => false)

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
    })
    setDraftText('Do not clear this')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea?.value).toBe('Do not clear this')
    expect(onSend).toHaveBeenCalledWith({ text: 'Do not clear this', images: undefined })
  })

  it('sends workspace file, directory, and annotation context as structured payload', async () => {
    const onSend = vi.fn(() => true)

    renderComposer({
      onSend,
      contextFilePaths: ['docs/spec.md'],
      contextDirectoryPaths: ['src'],
      contextFileAnnotations: [{
        id: 'annotation-1',
        path: 'docs/spec.md',
        body: 'Please tighten this section.',
        quote: null,
        range: null,
      }],
    })
    setDraftText('Review this')

    flushSync(() => {
      findButtonByLabel('Send').click()
    })

    expect(onSend).toHaveBeenCalledWith({
      text: 'Review this',
      images: undefined,
      context: {
        filePaths: ['docs/spec.md'],
        directoryPaths: ['src'],
        fileAnnotations: [{
          path: 'docs/spec.md',
          body: 'Please tighten this section.',
          quote: null,
          range: null,
        }],
      },
    })
  })

  it('queues from the explicit mobile queue action while streaming without calling send', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue,
      queueSnapshot: {
        currentMessage: null,
        items: [],
        totalCount: 0,
        maxSize: 8,
      },
    })
    setDraftText('Queue this follow-up')

    flushSync(() => {
      findButtonByLabel('Queue message').click()
    })

    expect(onQueue).toHaveBeenCalledWith({ text: 'Queue this follow-up', images: undefined })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps the mobile primary action sendable while streaming when queue drafts are supported', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue,
      queueSnapshot: {
        currentMessage: null,
        items: [],
        totalCount: 0,
        maxSize: 8,
      },
    })
    setDraftText('Send this directly')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    expect(onSend).toHaveBeenCalledWith({ text: 'Send this directly', images: undefined })
    expect(onQueue).not.toHaveBeenCalled()
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

  it('keeps the desktop abilities inside the existing action row', async () => {
    renderComposer({ variant: 'desktop' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(7)
    expect(findButtonByLabel('Attach image')).toBeDefined()
    expect(findButtonByLabel('Skills')).toBeDefined()
    expect(findButtonByLabel('Configure quick skill slot')).toBeDefined()
    expect(findButtonByLabel('Enable Think Hard ability')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(document.body.textContent).toContain('Queue')
    expect(document.body.querySelector('button[aria-label="Add custom composer ability"]')).toBeNull()
  })

  it('configures the quick skill slot from the skills picker', async () => {
    renderComposer()

    flushSync(() => {
      findButtonByLabel('Configure quick skill slot').click()
    })
    flushSync(() => {
      findButtonByLabel('Pick create-quests skill').click()
    })

    expect(composerSkillSlotsMock.setPrimarySkillName).toHaveBeenCalledWith('/create-quests')
  })

  it('applies the configured quick skill slot to the draft without losing context', async () => {
    const onSend = vi.fn(() => true)
    composerSkillSlotsMock.primarySkillName = 'create-quests'

    renderComposer({
      onSend,
      contextFilePaths: ['docs/spec.md'],
    })
    setDraftText('Break this into implementation work')

    flushSync(() => {
      findButtonByLabel('Apply /create-quests skill').click()
    })
    flushSync(() => {
      findButtonByLabel('Send').click()
    })

    expect(onSend).toHaveBeenCalledWith({
      text: '/create-quests Break this into implementation work',
      images: undefined,
      context: {
        filePaths: ['docs/spec.md'],
      },
    })
  })

  it('applies the selected Think Hard ability to the mobile queue payload', async () => {
    const onSend = vi.fn(() => true)
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'mobile',
      isStreaming: true,
      onSend,
      onQueue,
      queueSnapshot: {
        currentMessage: null,
        items: [],
        totalCount: 0,
        maxSize: 8,
      },
    })
    setDraftText('Compare the options')

    flushSync(() => {
      findButtonByLabel('Enable Think Hard ability').click()
    })
    flushSync(() => {
      findButtonByLabel('Queue message').click()
    })

    expect(onQueue).toHaveBeenCalledWith({
      text: expect.stringContaining('Think Hard: Think ultra hard internally'),
      images: undefined,
    })
    const payload = onQueue.mock.calls[0]?.[0] as { text: string }
    expect(payload.text).toContain('[User message]\nCompare the options')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('opens the queue panel from the desktop queue button', async () => {
    renderComposer({
      variant: 'desktop',
      queueSnapshot: {
        currentMessage: null,
        items: [{
          id: 'queued-desktop-1',
          text: 'Queue from desktop composer',
          priority: 'normal',
          queuedAt: '2026-05-15T14:00:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      },
    })

    const queueButton = findButtonByLabel('Open queue')
    expect(queueButton.textContent).toBe('Queue 1/8')

    flushSync(() => {
      queueButton.click()
    })

    const panel = document.body.querySelector('[data-testid="queue-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Queue from desktop composer')
    expect(panel?.textContent).toContain('Press Tab')
    expect(panel?.textContent).toContain('Clear')
  })

  it('queues the current draft from the queue panel', async () => {
    const onQueue = vi.fn(() => true)

    renderComposer({
      variant: 'desktop',
      onQueue,
      queueSnapshot: {
        currentMessage: null,
        items: [],
        totalCount: 0,
        maxSize: 8,
      },
    })
    setDraftText('Queue from the sheet')

    flushSync(() => {
      findButtonByLabel('Open queue').click()
    })

    const queueDraftButton = findButtonByLabel('Queue current draft')
    expect(queueDraftButton.textContent).toContain('Queue this draft')

    flushSync(() => {
      queueDraftButton.click()
    })

    expect(onQueue).toHaveBeenCalledWith({ text: 'Queue from the sheet', images: undefined })
    expect(document.body.querySelector('[data-testid="queue-panel"]')).toBeNull()
  })
})

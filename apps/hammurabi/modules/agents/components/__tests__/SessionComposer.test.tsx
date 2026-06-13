// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionComposer } from '../SessionComposer'
import { MAX_MESSAGE_IMAGE_BYTES, MAX_MESSAGE_IMAGE_SIZE_MB } from '../../message-images'

const speechRecognitionMock = {
  isListening: false,
  transcript: '',
  startListening: vi.fn(),
  stopListening: vi.fn(),
  isSupported: true,
}

const composerAbilitiesMock = vi.hoisted(() => ({
  customAbilitiesEnabled: false,
  loadError: null as Error | null,
  retryLoad: vi.fn(),
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
    loadError: composerAbilitiesMock.loadError,
    retryLoad: composerAbilitiesMock.retryLoad,
  })),
}))

const composerSkillSlotsMock = vi.hoisted(() => ({
  primarySkillName: null as string | null,
  loadError: null as Error | null,
  retryLoad: vi.fn(),
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
    loadError: composerSkillSlotsMock.loadError,
    retryLoad: composerSkillSlotsMock.retryLoad,
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

function fileWithSize(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', {
    configurable: true,
    value: size,
  })
  return file
}

async function attachComposerImage(file = new File(['fake-image'], 'draft.png', { type: 'image/png' })) {
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(input).not.toBeNull()
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  })

  flushSync(() => {
    input?.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await vi.waitFor(() => {
    expect(document.body.querySelector('.composer-attachment')).not.toBeNull()
  })
}

beforeEach(() => {
  speechRecognitionMock.isListening = false
  speechRecognitionMock.transcript = ''
  speechRecognitionMock.isSupported = true
  speechRecognitionMock.startListening.mockReset()
  speechRecognitionMock.stopListening.mockReset()
  composerAbilitiesMock.customAbilitiesEnabled = false
  composerAbilitiesMock.loadError = null
  composerAbilitiesMock.retryLoad.mockReset()
  composerAbilitiesMock.addCustomAbility.mockReset()
  composerAbilitiesMock.removeCustomAbility.mockReset()
  composerAbilitiesMock.useComposerAbilities.mockClear()
  composerSkillSlotsMock.primarySkillName = null
  composerSkillSlotsMock.loadError = null
  composerSkillSlotsMock.retryLoad.mockReset()
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

  it('persists and restores pending image attachments with the session draft', async () => {
    renderComposer({
      sessionName: 'conversation-image-draft',
      variant: 'mobile',
    })

    await attachComposerImage()

    flushSync(() => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null

    const storedImages = window.localStorage.getItem('hammurabi:draft-images:conversation-image-draft')
    expect(storedImages).not.toBeNull()
    expect(JSON.parse(storedImages ?? '{}')).toEqual({
      images: [{ mediaType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' }],
    })

    renderComposer({
      sessionName: 'conversation-image-draft',
      variant: 'desktop',
    })

    await vi.waitFor(() => {
      const restoredImage = document.body.querySelector('.composer-attachment img') as HTMLImageElement | null
      expect(restoredImage?.src).toBe('data:image/png;base64,ZmFrZS1pbWFnZQ==')
    })
  })

  it('clears persisted pending image attachments after send', async () => {
    const onSend = vi.fn(() => true)
    renderComposer({
      sessionName: 'conversation-image-send-clear',
      onSend,
    })

    await attachComposerImage()
    window.dispatchEvent(new Event('pagehide'))
    expect(window.localStorage.getItem('hammurabi:draft-images:conversation-image-send-clear')).not.toBeNull()

    flushSync(() => {
      findButtonByLabel('Send').click()
    })

    await vi.waitFor(() => {
      expect(window.localStorage.getItem('hammurabi:draft-images:conversation-image-send-clear')).toBeNull()
      expect(document.body.querySelector('.composer-attachment')).toBeNull()
    })
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      text: '',
      images: [{ mediaType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' }],
      clientSendId: expect.stringMatching(/^send-/u),
    }))
  })

  it('clears persisted pending image attachments when the image is removed', async () => {
    renderComposer({ sessionName: 'conversation-image-remove-clear' })

    await attachComposerImage()
    window.dispatchEvent(new Event('pagehide'))
    expect(window.localStorage.getItem('hammurabi:draft-images:conversation-image-remove-clear')).not.toBeNull()

    flushSync(() => {
      findButtonByLabel('Remove image').click()
    })
    window.dispatchEvent(new Event('pagehide'))

    expect(window.localStorage.getItem('hammurabi:draft-images:conversation-image-remove-clear')).toBeNull()
    expect(document.body.querySelector('.composer-attachment')).toBeNull()
  })

  it('renders composer abilities in the mobile variant when queue access is unavailable', async () => {
    renderComposer({ variant: 'mobile' })

    const buttons = Array.from(composerRow().querySelectorAll('button'))
    expect(buttons).toHaveLength(6)
    expect(findButtonByLabel('Add to chat')).toBeDefined()
    expect(findButtonByLabel('Insert skill')).toBeDefined()
    expect(findButtonByLabel('Configure quick skill slot')).toBeDefined()
    expect(findButtonByLabel('Enable Think Hard ability')).toBeDefined()
    expect(findButtonByLabel('Start voice input')).toBeDefined()
    expect(findButtonByLabel('Send message')).toBeDefined()
    expect(document.body.querySelector('button[aria-label="Add custom composer ability"]')).toBeNull()
  })

  it('shows a settings retry affordance when composer settings fail to load', async () => {
    composerAbilitiesMock.loadError = new Error('Request failed (401): Unauthorized')
    composerSkillSlotsMock.loadError = new Error('Request failed (401): Unauthorized')

    renderComposer({ variant: 'desktop' })

    expect(document.body.textContent).toContain('Unable to load composer settings.')
    const retryButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent === 'Retry',
    )
    expect(retryButton).not.toBeNull()

    flushSync(() => {
      retryButton?.click()
    })

    expect(composerAbilitiesMock.retryLoad).toHaveBeenCalled()
    expect(composerSkillSlotsMock.retryLoad).toHaveBeenCalled()
  })

  it('keeps the mobile textarea above a compact action row with mic next to send', async () => {
    renderComposer({ variant: 'mobile' })

    const composer = document.body.querySelector('.hervald-session-composer--mobile')
    expect(composer).not.toBeNull()

    const row = composerRow()
    expect(row.querySelector('.composer-field-stack textarea')).toBeNull()
    expect(composer?.querySelector(':scope > .input-bar > .composer-field-stack textarea')).not.toBeNull()
    expect(row.querySelector('button[aria-label="Add to chat"]')).not.toBeNull()
    expect(row.querySelector('button[aria-label="Insert skill"]')).not.toBeNull()
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

  it('replaces the mobile input with a queueing status while enqueue is in flight', async () => {
    const onSend = vi.fn(() => true)
    let resolveQueue: ((queued: boolean) => void) | null = null
    const queuePromise = new Promise<boolean>((resolve) => {
      resolveQueue = resolve
    })
    const onQueue = vi.fn(() => queuePromise)

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

    setDraftText('Queue this once')
    const queueMessageButton = findButtonByLabel('Queue message')

    flushSync(() => {
      queueMessageButton.click()
      queueMessageButton.click()
    })

    expect(onQueue).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
    expect(document.body.querySelector('textarea')).toBeNull()
    expect(document.body.querySelector('[role="status"][aria-label="Queuing message"]')?.textContent)
      .toContain('Queuing message...')
    expect(findButtonByLabel('Queue message').disabled).toBe(true)

    await act(async () => {
      resolveQueue?.(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    expect(textarea?.value).toBe('')
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

  it('clears the mobile draft after an async send is accepted', async () => {
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

    await vi.waitFor(() => {
      const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
      expect(textarea?.value).toBe('')
    })
    expect(onSend).toHaveBeenCalledWith({ text: 'Clear this after tapping send', images: undefined })
  })

  it('keeps the mobile draft when an async fallback send resolves false', async () => {
    const onSend = vi.fn(() => Promise.resolve(false))

    renderComposer({
      variant: 'mobile',
      isStreaming: false,
      onSend,
    })
    setDraftText('Keep failed fallback draft')

    flushSync(() => {
      findButtonByLabel('Send message').click()
    })

    await vi.waitFor(() => {
      expect(onSend).toHaveBeenCalledWith({ text: 'Keep failed fallback draft', images: undefined })
    })
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea?.value).toBe('Keep failed fallback draft')
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

  it('shows a clear error when an attached image is too large', async () => {
    const onSend = vi.fn(() => true)
    renderComposer({ onSend })

    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [fileWithSize('huge-chat-image.png', 'image/png', MAX_MESSAGE_IMAGE_BYTES + (5 * 1024 * 1024))],
    })

    flushSync(() => {
      input?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(document.body.querySelector('.composer-image-error')?.textContent).toContain(
      `Image too large: huge-chat-image.png is 35.0 MB. Maximum is ${MAX_MESSAGE_IMAGE_SIZE_MB} MB per image.`,
    )
    expect(document.body.querySelector('.composer-attachment')).toBeNull()

    setDraftText('Try to send text only')
    flushSync(() => {
      findButtonByLabel('Send').click()
    })
    expect(onSend).toHaveBeenCalledWith({ text: 'Try to send text only', images: undefined })
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

  it('opens the insert skills picker from the mobile composer', async () => {
    renderComposer({ variant: 'mobile' })

    expect(document.body.querySelector('[data-testid="skills-picker"]')?.getAttribute('data-visible')).toBe('false')

    flushSync(() => {
      findButtonByLabel('Insert skill').click()
    })

    expect(document.body.querySelector('[data-testid="skills-picker"]')?.getAttribute('data-visible')).toBe('true')
    expect(findButtonByLabel('Insert skill').getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps selected mobile ability styles after the transparent mobile reset', async () => {
    const fs = (process as typeof process & {
      getBuiltinModule?: (id: 'fs') => { readFileSync: (filePath: string, encoding: BufferEncoding) => string }
    }).getBuiltinModule?.('fs')
    if (!fs) {
      throw new Error('Node fs builtin is unavailable in this test environment')
    }
    const css = fs.readFileSync(`${process.cwd()}/src/index.css`, 'utf8')
    const resetIndex = css.indexOf('.hervald-session-composer--mobile .composer-add-btn,')
    const activeIndex = css.indexOf(
      '.hervald-session-composer--mobile .composer-row--mobile .composer-ability-btn.composer-ability-btn--active',
    )

    expect(resetIndex).toBeGreaterThanOrEqual(0)
    expect(activeIndex).toBeGreaterThan(resetIndex)
    expect(css.slice(activeIndex, activeIndex + 500)).toContain('background: var(--hv-bg-raised)')
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

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUp, ListPlus, Mic, Paperclip, Plus, Zap } from 'lucide-react'
import { useOpenAITranscription, useOpenAITranscriptionConfig } from '@/hooks/use-openai-transcription'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import type { AgentType } from '@/types'
import { cn } from '@/lib/utils'
import { supportsQueuedDrafts } from '../queue-capability'
import { SkillsPicker } from './SkillsPicker'
import { useSessionDraft } from '../page-shell/use-session-draft'

export interface SessionComposerImage {
  mediaType: string
  data: string
}

export interface SessionComposerSubmitPayload {
  text: string
  images?: SessionComposerImage[]
}

interface SessionComposerProps {
  sessionName: string
  agentType?: AgentType
  theme?: 'light' | 'dark'
  variant?: 'desktop' | 'mobile'
  placeholder?: string
  disabled?: boolean
  disabledMessage?: string
  sendReady?: boolean
  isStreaming?: boolean
  contextFilePaths?: string[]
  onRemoveContextFilePath?: (filePath: string) => void
  onClearContextFilePaths?: () => void
  onOpenWorkspace?: () => void
  onOpenAddToChat?: () => void
  showWorkspaceShortcut?: boolean
  onSend: (payload: SessionComposerSubmitPayload) => boolean | void | Promise<boolean | void>
  onQueue?: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
}

export interface SessionComposerHandle {
  seedText: (nextText: string) => void
  openImagePicker: () => void
  openSkillsPicker: () => void
}

const MAX_PENDING_IMAGES = 5

function basename(filePath: string): string {
  const cleanPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath
  const parts = cleanPath.split('/')
  const name = parts[parts.length - 1] || cleanPath
  return filePath.endsWith('/') ? `${name}/` : name
}

export const SessionComposer = forwardRef<SessionComposerHandle, SessionComposerProps>(function SessionComposer({
  sessionName,
  agentType,
  theme = 'light',
  variant = 'desktop',
  placeholder = 'Send a message...',
  disabled = false,
  disabledMessage,
  sendReady = true,
  isStreaming = false,
  contextFilePaths = [],
  onRemoveContextFilePath,
  onClearContextFilePaths,
  onOpenWorkspace,
  onOpenAddToChat,
  showWorkspaceShortcut = false,
  onSend,
  onQueue,
}, ref) {
  const {
    inputMode,
    inputText,
    resizeTextarea,
    setInputMode,
    setInputText,
    showDraftSaved,
    switchToEditMode,
    textareaRef,
    clearDraft,
  } = useSessionDraft(sessionName)
  const [pendingImages, setPendingImages] = useState<SessionComposerImage[]>([])
  const [showSkills, setShowSkills] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { data: realtimeTranscriptionConfig } = useOpenAITranscriptionConfig()
  const openAITranscription = useOpenAITranscription({
    enabled: Boolean(realtimeTranscriptionConfig?.openaiConfigured),
  })
  const speechRecognition = useSpeechRecognition()
  const activeTranscription =
    realtimeTranscriptionConfig?.openaiConfigured && openAITranscription.isSupported
      ? openAITranscription
      : speechRecognition
  const {
    isListening: isMicListening,
    transcript: speechTranscript,
    startListening,
    stopListening,
    isSupported: isMicSupported,
  } = activeTranscription

  const isMobileVariant = variant === 'mobile'
  const queueDraftsSupported = !disabled && supportsQueuedDrafts(agentType) && typeof onQueue === 'function'
  const canQueueDraft = (
    queueDraftsSupported
    && (inputText.trim().length > 0 || pendingImages.length > 0)
  )
  const canSend = !disabled && sendReady && (inputText.trim().length > 0 || pendingImages.length > 0)
  const primaryActionUsesQueue = isMobileVariant && isStreaming && queueDraftsSupported
  const primaryActionDisabled = primaryActionUsesQueue ? !canQueueDraft : !canSend
  const primaryActionLabel = primaryActionUsesQueue
    ? 'Add to queue'
    : isMobileVariant
      ? 'Send message'
      : 'Send'
  const primaryActionTitle = primaryActionUsesQueue
    ? 'Add to queue'
    : !sendReady && !disabled
      ? 'Connecting…'
      : isMobileVariant
        ? 'Send message'
        : 'Send'
  const queueButtonTitle = !queueDraftsSupported
    ? 'Queue is only available for stream agent sessions'
    : 'Queue message (Tab)'
  const footerHint = disabled
    ? (disabledMessage ?? 'Composer unavailable')
    : queueDraftsSupported
      ? 'Enter send · Tab queue'
      : 'Enter send'

  useImperativeHandle(ref, () => ({
    seedText(nextText: string) {
      setInputText(nextText)
      switchToEditMode(true)
    },
    openImagePicker() {
      fileInputRef.current?.click()
    },
    openSkillsPicker() {
      setShowSkills(true)
    },
  }), [setInputText, setShowSkills, switchToEditMode])

  useEffect(() => {
    function handleTogglePreview(event: globalThis.KeyboardEvent) {
      const isToggleShortcut =
        (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && event.key.toLowerCase() === 'p'
      if (!isToggleShortcut) {
        return
      }
      event.preventDefault()
      setInputMode((prev) => {
        const nextMode = prev === 'edit' ? 'preview' : 'edit'
        if (nextMode === 'edit') {
          requestAnimationFrame(() => {
            resizeTextarea()
            textareaRef.current?.focus()
          })
        }
        return nextMode
      })
    }

    window.addEventListener('keydown', handleTogglePreview)
    return () => window.removeEventListener('keydown', handleTogglePreview)
  }, [resizeTextarea, setInputMode, textareaRef])

  useEffect(() => {
    const normalizedTranscript = speechTranscript.trim()
    if (!normalizedTranscript) {
      return
    }

    setInputText((prev) => {
      const currentText = prev.trimEnd()
      return currentText ? `${currentText} ${normalizedTranscript}` : normalizedTranscript
    })
    switchToEditMode(true)
  }, [setInputText, speechTranscript, switchToEditMode])

  function clearComposer() {
    setPendingImages([])
    onClearContextFilePaths?.()
    clearDraft()
  }

  async function handleSend() {
    const text = inputText.trim()
    if ((!text && pendingImages.length === 0) || disabled || !sendReady) {
      return
    }

    const images = pendingImages.slice()
    const sent = await onSend({
      text: contextFilePaths.length > 0
        ? `${contextFilePaths.map((filePath) => `@${filePath}`).join(' ')}\n${text}`.trim()
        : text,
      images: images.length > 0 ? images : undefined,
    })
    if (sent === false) {
      return
    }
    clearComposer()
  }

  async function handleQueueDraft() {
    if (!canQueueDraft || !onQueue) {
      return
    }

    const images = pendingImages.slice()
    const queued = await onQueue({
      text: contextFilePaths.length > 0
        ? `${contextFilePaths.map((filePath) => `@${filePath}`).join(' ')}\n${inputText.trim()}`.trim()
        : inputText.trim(),
      images: images.length > 0 ? images : undefined,
    })
    if (queued === false) {
      return
    }
    clearComposer()
  }

  function handleImageFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      return
    }

    imageFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = typeof event.target?.result === 'string' ? event.target.result : undefined
        if (!result) {
          return
        }
        const data = result.split(',')[1]
        if (!data) {
          return
        }
        setPendingImages((prev) => {
          if (prev.length >= MAX_PENDING_IMAGES) {
            return prev
          }
          return [...prev, { mediaType: file.type, data }]
        })
      }
      reader.readAsDataURL(file)
    })
  }

  function handleTextareaInput(event: ChangeEvent<HTMLTextAreaElement>) {
    setInputText(event.target.value)
    const textarea = event.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }

  function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    switchToEditMode(true)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (queueDraftsSupported && event.key === 'Tab' && !event.shiftKey && canQueueDraft) {
      event.preventDefault()
      void handleQueueDraft()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData.items
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length === 0) {
      return
    }

    event.preventDefault()
    handleImageFiles(imageFiles)
  }

  function handleMicToggle() {
    if (isMicListening) {
      stopListening()
      return
    }
    startListening()
  }

  function renderComposerField() {
    if (inputMode === 'edit') {
      return (
        <textarea
          ref={textareaRef}
          className="input-field"
          rows={1}
          placeholder={placeholder}
          value={inputText}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
        />
      )
    }

    return (
      <div
        className="composer-preview input-field overflow-y-auto whitespace-pre-wrap"
        tabIndex={disabled ? -1 : 0}
        role="region"
        aria-label="Markdown preview"
        onKeyDown={handlePreviewKeyDown}
      >
        {inputText.trim() ? (
          <div className="composer-preview-markdown break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{inputText}</ReactMarkdown>
          </div>
        ) : (
          <p className="composer-preview-empty text-sm text-sumi-mist">Nothing to preview yet.</p>
        )}
      </div>
    )
  }

  return (
    <div className="hervald-session-composer">
      <div className="input-bar">
        {contextFilePaths.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1">
            {contextFilePaths.map((filePath) => (
              <span
                key={filePath}
                className="file-chip"
                title={filePath}
              >
                {basename(filePath)}
                <button
                  type="button"
                  onClick={() => onRemoveContextFilePath?.(filePath)}
                  className="file-chip-remove"
                  aria-label={`Remove ${basename(filePath)}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {pendingImages.length > 0 && (
          <div className="composer-attachments flex flex-wrap gap-2 px-2 pb-2">
            {pendingImages.map((image, index) => (
              <div key={`${image.mediaType}-${index}`} className="composer-attachment relative inline-block">
                <img
                  src={`data:${image.mediaType};base64,${image.data}`}
                  className="h-16 w-16 rounded border object-cover"
                  alt="attachment"
                />
                <button
                  type="button"
                  className="composer-attachment-remove absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-sumi-black text-washi-white text-xs leading-none"
                  onClick={() => setPendingImages((prev) => prev.filter((_, imageIndex) => imageIndex !== index))}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-toolbar mb-1 flex items-center justify-between px-1">
          <div className="composer-mode-toggle inline-flex items-center rounded-md border border-[var(--msg-border)] bg-[var(--msg-surface)] p-0.5">
            <button
              type="button"
              className={cn(
                'composer-mode-button rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors',
                inputMode === 'edit'
                  ? 'bg-[var(--msg-surface-elevated)] text-[var(--msg-text)]'
                  : 'text-[var(--msg-text-muted)] hover:text-[var(--msg-text-secondary)]',
              )}
              onClick={() => switchToEditMode(true)}
              aria-pressed={inputMode === 'edit'}
            >
              Edit
            </button>
            <button
              type="button"
              className={cn(
                'composer-mode-button rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors',
                inputMode === 'preview'
                  ? 'bg-[var(--msg-surface-elevated)] text-[var(--msg-text)]'
                  : 'text-[var(--msg-text-muted)] hover:text-[var(--msg-text-secondary)]',
              )}
              onClick={() => setInputMode('preview')}
              aria-pressed={inputMode === 'preview'}
            >
              Preview
            </button>
          </div>
          <span className="composer-shortcut-hint font-mono text-[10px] text-[var(--msg-text-muted)]">
            {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl+'}Shift+P
          </span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              handleImageFiles(event.target.files)
            }
            event.target.value = ''
          }}
        />

        {isMobileVariant ? (
          <>
            <div className="composer-field-stack">
              {renderComposerField()}
            </div>

            <div className="composer-row composer-row--mobile">
              <button
                type="button"
                className="composer-add-btn"
                onClick={onOpenAddToChat}
                aria-label="Add to chat"
                title="Add to chat"
                disabled={disabled}
              >
                <Plus size={18} />
              </button>

              <div className="composer-mobile-actions">
                {isMicSupported && (
                  <button
                    type="button"
                    className={cn('mic-btn', isMicListening && 'recording')}
                    onClick={handleMicToggle}
                    aria-label={isMicListening ? 'Stop voice input' : 'Start voice input'}
                    aria-pressed={isMicListening}
                    title={isMicListening ? 'Stop listening' : 'Start voice input'}
                    disabled={disabled}
                  >
                    <Mic size={18} />
                  </button>
                )}

                <button
                  type="button"
                  className={cn('send-btn', primaryActionUsesQueue && 'send-btn--queue')}
                  onClick={() => {
                    if (primaryActionUsesQueue) {
                      void handleQueueDraft()
                      return
                    }
                    void handleSend()
                  }}
                  disabled={primaryActionDisabled}
                  aria-label={primaryActionLabel}
                  title={primaryActionTitle}
                >
                  {primaryActionUsesQueue ? <ListPlus size={18} /> : <ArrowUp size={18} />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="composer-row flex items-end gap-2">
            {renderComposerField()}

            <button
              type="button"
              className="composer-icon-btn p-2 text-[var(--msg-text-muted)] transition-colors hover:text-[var(--msg-text)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach image"
              title="Attach image"
              disabled={disabled || pendingImages.length >= MAX_PENDING_IMAGES}
            >
              <Paperclip size={18} />
            </button>

            <button
              type="button"
              className={cn(
                'composer-icon-btn p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                showSkills ? 'text-[var(--msg-text)]' : 'text-[var(--msg-text-muted)] hover:text-[var(--msg-text)]',
              )}
              onClick={() => setShowSkills(true)}
              aria-label="Skills"
              disabled={disabled}
            >
              <Zap size={18} />
            </button>

            {isMicSupported && (
              <button
                type="button"
                className={cn('mic-btn', isMicListening && 'recording')}
                onClick={handleMicToggle}
                aria-label={isMicListening ? 'Stop voice input' : 'Start voice input'}
                aria-pressed={isMicListening}
                title={isMicListening ? 'Stop listening' : 'Start voice input'}
                disabled={disabled}
              >
                <Mic size={18} />
              </button>
            )}

            <button
              type="button"
              className="composer-queue-btn rounded-lg border border-[var(--msg-border)] px-3 py-2 font-mono text-[11px] text-[var(--msg-text-muted)] transition-colors hover:bg-[var(--msg-surface-elevated)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void handleQueueDraft()}
              disabled={!canQueueDraft}
              title={queueButtonTitle}
            >
              Queue
            </button>

            <button
              type="button"
              className="send-btn"
              onClick={() => void handleSend()}
              disabled={!canSend}
              aria-label="Send"
              title={!sendReady && !disabled ? 'Connecting…' : 'Send'}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        )}

        <div className="composer-footer flex items-center justify-between px-3 pb-1 pt-0.5">
          <span className="font-mono text-[10px] text-[var(--msg-text-muted)]">
            {showDraftSaved ? 'Draft saved · ' : ''}
            {footerHint}
          </span>
          {!isMobileVariant && showWorkspaceShortcut && onOpenWorkspace && (
            <button
              type="button"
              className="font-mono text-[10px] text-[var(--msg-text-muted)] transition-colors hover:text-[var(--msg-text-secondary)]"
              onClick={onOpenWorkspace}
            >
              {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl+'}K workspace
            </button>
          )}
        </div>
      </div>

      <SkillsPicker
        visible={showSkills}
        variant="hervald"
        theme={theme}
        onSelectSkill={(command) => {
          setInputText(`${command} `)
          switchToEditMode(true)
        }}
        onClose={() => setShowSkills(false)}
      />
    </div>
  )
})

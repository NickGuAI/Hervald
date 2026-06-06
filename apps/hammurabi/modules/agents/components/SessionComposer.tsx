import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowUp, BrainCircuit, ListChecks, ListPlus, Mic, Paperclip, Plus, X, Zap } from 'lucide-react'
import { useOpenAITranscription, useOpenAITranscriptionConfig } from '@/hooks/use-openai-transcription'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { useComposerAbilities } from '@/hooks/use-composer-abilities'
import { useComposerSkillSlots } from '@/hooks/use-composer-skill-slots'
import type { AgentType, SessionQueueSnapshot } from '@/types'
import { cn } from '@/lib/utils'
import { getQueuePendingCount } from '../queue-state'
import { SkillsPicker } from './SkillsPicker'
import { QueuePanel } from './QueuePanel'
import { useSessionDraft } from '../page-shell/use-session-draft'
import type { WorkspaceContextRequest, WorkspacePendingFileAnnotation } from '@modules/workspace/use-workspace'
import {
  applyComposerAbilitiesToText,
  type ComposerAbility,
} from '@modules/settings/composer-abilities'

export interface SessionComposerImage {
  mediaType: string
  data: string
}

export interface SessionComposerSubmitPayload {
  text: string
  images?: SessionComposerImage[]
  context?: Pick<WorkspaceContextRequest, 'filePaths' | 'directoryPaths' | 'fileAnnotations'>
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
  contextDirectoryPaths?: string[]
  contextFileAnnotations?: WorkspacePendingFileAnnotation[]
  onRemoveContextFilePath?: (filePath: string) => void
  onRemoveContextDirectoryPath?: (directoryPath: string) => void
  onRemoveContextFileAnnotation?: (annotationId: string) => void
  onClearContextFilePaths?: () => void
  onOpenWorkspace?: () => void
  onOpenAddToChat?: () => void
  showWorkspaceShortcut?: boolean
  queueSnapshot?: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating?: boolean
  onClearQueue?: () => void
  onMoveQueuedMessage?: (id: string, offset: number) => void
  onRemoveQueuedMessage?: (id: string) => void
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
type SkillsPickerMode = 'insert' | 'quick-slot'

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
  contextFilePaths = [],
  contextDirectoryPaths = [],
  contextFileAnnotations = [],
  onRemoveContextFilePath,
  onRemoveContextDirectoryPath,
  onRemoveContextFileAnnotation,
  onClearContextFilePaths,
  onOpenWorkspace,
  onOpenAddToChat,
  showWorkspaceShortcut = false,
  queueSnapshot,
  queueError,
  isQueueMutating = false,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  onSend,
  onQueue,
}, ref) {
  const {
    inputText,
    setInputText,
    showDraftSaved,
    focusTextarea,
    textareaRef,
    clearDraft,
  } = useSessionDraft(sessionName)
  const [pendingImages, setPendingImages] = useState<SessionComposerImage[]>([])
  const [skillsPickerMode, setSkillsPickerMode] = useState<SkillsPickerMode | null>(null)
  const [showQueuePanel, setShowQueuePanel] = useState(false)
  const [selectedAbilityIds, setSelectedAbilityIds] = useState<string[]>([])
  const [showCustomAbilityForm, setShowCustomAbilityForm] = useState(false)
  const [customAbilityLabel, setCustomAbilityLabel] = useState('')
  const [customAbilityPrompt, setCustomAbilityPrompt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    abilities: composerAbilities,
    customAbilitiesEnabled,
    addCustomAbility,
    removeCustomAbility,
    isSaving: isSavingComposerAbility,
  } = useComposerAbilities()
  const {
    primarySkillName,
    setPrimarySkillName,
    clearPrimarySkillName,
    isSaving: isSavingSkillSlot,
  } = useComposerSkillSlots()
  const { data: realtimeTranscriptionConfig } = useOpenAITranscriptionConfig()
  const realtimeTranscriptionTerms = useMemo(
    () => [sessionName, agentType].filter((term): term is string => typeof term === 'string' && term.length > 0),
    [agentType, sessionName],
  )
  const openAITranscription = useOpenAITranscription({
    enabled: Boolean(realtimeTranscriptionConfig?.openaiConfigured),
    terms: realtimeTranscriptionTerms,
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
  const queueDraftsSupported = !disabled && typeof onQueue === 'function'
  const totalQueuedCount = getQueuePendingCount(queueSnapshot)
  const queueMaxSize = typeof queueSnapshot?.maxSize === 'number' ? queueSnapshot.maxSize : 0
  const canOpenQueuePanel = !disabled && queueMaxSize > 0
  const showMobileQueueButton = isMobileVariant && canOpenQueuePanel
  const showMobileQueueDraftButton = isMobileVariant && canOpenQueuePanel && queueDraftsSupported
  const queueButtonLabel = queueMaxSize > 0
    ? `Queue ${totalQueuedCount}/${queueMaxSize}`
    : 'Queue'
  const hasContextAttachments = contextFilePaths.length > 0 || contextDirectoryPaths.length > 0 || contextFileAnnotations.length > 0
  const canQueueDraft = (
    queueDraftsSupported
    && (inputText.trim().length > 0 || pendingImages.length > 0 || hasContextAttachments)
  )
  const canSend = !disabled && sendReady && (inputText.trim().length > 0 || pendingImages.length > 0 || hasContextAttachments)
  const primaryActionDisabled = !canSend
  const primaryActionLabel = isMobileVariant ? 'Send message' : 'Send'
  const primaryActionTitle = !sendReady && !disabled ? 'Connecting…' : primaryActionLabel
  const queueButtonTitle = canOpenQueuePanel
    ? 'Open queue'
    : !queueDraftsSupported
      ? 'Queue is only available for stream agent sessions'
      : 'Queue unavailable'
  const footerHint = disabled
    ? (disabledMessage ?? 'Composer unavailable')
    : queueDraftsSupported
      ? 'Enter send · Tab queue'
      : 'Enter send'
  const selectedAbilities = composerAbilities.filter((ability) => selectedAbilityIds.includes(ability.id))
  const showSkills = skillsPickerMode !== null

  useImperativeHandle(ref, () => ({
    seedText(nextText: string) {
      setInputText(nextText)
      focusTextarea()
    },
    openImagePicker() {
      fileInputRef.current?.click()
    },
    openSkillsPicker() {
      setSkillsPickerMode('insert')
    },
  }), [focusTextarea, setInputText])

  useEffect(() => {
    const normalizedTranscript = speechTranscript.trim()
    if (!normalizedTranscript) {
      return
    }

    setInputText((prev) => {
      const currentText = prev.trimEnd()
      return currentText ? `${currentText} ${normalizedTranscript}` : normalizedTranscript
    })
    focusTextarea()
  }, [focusTextarea, setInputText, speechTranscript])

  function clearComposer() {
    setPendingImages([])
    setSelectedAbilityIds([])
    onClearContextFilePaths?.()
    clearDraft()
  }

  function buildContextPayload(): SessionComposerSubmitPayload['context'] | undefined {
    const filePaths = contextFilePaths.filter((filePath) => filePath.trim().length > 0)
    const directoryPaths = contextDirectoryPaths.filter((directoryPath) => directoryPath.trim().length > 0)
    const fileAnnotations = contextFileAnnotations
      .filter((annotation) => annotation.path.trim().length > 0 && annotation.body.trim().length > 0)
      .map((annotation) => ({
        path: annotation.path,
        body: annotation.body,
        quote: annotation.quote ?? null,
        range: annotation.range ?? null,
      }))
    if (filePaths.length === 0 && directoryPaths.length === 0 && fileAnnotations.length === 0) {
      return undefined
    }
    return {
      ...(filePaths.length > 0 ? { filePaths } : {}),
      ...(directoryPaths.length > 0 ? { directoryPaths } : {}),
      ...(fileAnnotations.length > 0 ? { fileAnnotations } : {}),
    }
  }

  function handleSend() {
    const text = inputText.trim()
    const context = buildContextPayload()
    if ((!text && pendingImages.length === 0 && !context) || disabled || !sendReady) {
      return
    }

    const images = pendingImages.slice()
    let sent: boolean | void | Promise<boolean | void>
    try {
      sent = onSend({
        text: applyComposerAbilitiesToText(text, selectedAbilities),
        images: images.length > 0 ? images : undefined,
        context,
      })
    } catch {
      return
    }
    if (sent === false) {
      return
    }
    clearComposer()
    void Promise.resolve(sent).catch(() => {
      // Transport errors are surfaced by the owner callback; the composer only owns draft state.
    })
  }

  async function handleQueueDraft() {
    if (!canQueueDraft || !onQueue) {
      return
    }

    const images = pendingImages.slice()
    const context = buildContextPayload()
    const queued = await onQueue({
      text: applyComposerAbilitiesToText(inputText.trim(), selectedAbilities),
      images: images.length > 0 ? images : undefined,
      context,
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
    textarea.style.height = `${Math.min(textarea.scrollHeight, isMobileVariant ? 148 : 120)}px`
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

  function toggleAbility(abilityId: string) {
    setSelectedAbilityIds((current) => (
      current.includes(abilityId)
        ? current.filter((id) => id !== abilityId)
        : [...current, abilityId]
    ))
  }

  function skillCommand(skillName: string): string {
    return `/${skillName.trim().replace(/^\/+/u, '')}`
  }

  function applySkillCommand(command: string) {
    const normalizedCommand = command.trim()
    if (!normalizedCommand) {
      return
    }

    setInputText((current) => {
      const trimmed = current.trim()
      if (!trimmed) {
        return `${normalizedCommand} `
      }
      if (trimmed === normalizedCommand || trimmed.startsWith(`${normalizedCommand} `)) {
        return current
      }
      return `${normalizedCommand} ${trimmed}`
    })
    focusTextarea()
  }

  function abilityIcon(ability: ComposerAbility) {
    if (ability.id === 'think-hard') {
      return <BrainCircuit size={14} />
    }
    return <ListChecks size={14} />
  }

  async function handleCustomAbilitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const added = await addCustomAbility(customAbilityLabel, customAbilityPrompt)
    if (!added) {
      return
    }
    setCustomAbilityLabel('')
    setCustomAbilityPrompt('')
    setShowCustomAbilityForm(false)
  }

  async function handleRemoveCustomAbility(abilityId: string) {
    const removed = await removeCustomAbility(abilityId)
    if (!removed) {
      return
    }
    setSelectedAbilityIds((current) => current.filter((id) => id !== abilityId))
  }

  function renderQuickSkillSlot() {
    const configuredSkill = primarySkillName?.trim() || null
    const disabledSlot = disabled || isSavingSkillSlot

    if (!configuredSkill) {
      return (
        <span className="composer-ability-chip">
          <button
            type="button"
            className="composer-ability-btn"
            onClick={() => setSkillsPickerMode('quick-slot')}
            aria-label="Configure quick skill slot"
            title="Configure quick skill slot"
            disabled={disabledSlot}
          >
            <Plus size={14} />
            <span>Skill Slot</span>
          </button>
        </span>
      )
    }

    const command = skillCommand(configuredSkill)
    return (
      <span className="composer-ability-chip">
        <button
          type="button"
          className="composer-ability-btn composer-ability-btn--with-remove"
          onClick={() => applySkillCommand(command)}
          aria-label={`Apply ${command} skill`}
          title={`Apply ${command}`}
          disabled={disabledSlot}
        >
          <Zap size={14} />
          <span>{command}</span>
        </button>
        <button
          type="button"
          className="composer-ability-remove-btn"
          onClick={() => void clearPrimarySkillName()}
          aria-label={`Clear ${command} quick skill slot`}
          title={`Clear ${command}`}
          disabled={disabledSlot}
        >
          <X size={12} />
        </button>
      </span>
    )
  }

  function renderAbilityActions() {
    if (composerAbilities.length === 0 && !customAbilitiesEnabled) {
      return null
    }

    return (
      <>
        {composerAbilities.map((ability) => {
          const selected = selectedAbilityIds.includes(ability.id)
          return (
            <span key={ability.id} className="composer-ability-chip">
              <button
                type="button"
                className={cn('composer-ability-btn', selected && 'composer-ability-btn--active')}
                onClick={() => toggleAbility(ability.id)}
                aria-label={`${selected ? 'Disable' : 'Enable'} ${ability.label} ability`}
                aria-pressed={selected}
                title={ability.label}
                disabled={disabled}
              >
                {abilityIcon(ability)}
                <span>{ability.label}</span>
              </button>
              {customAbilitiesEnabled && ability.source === 'custom' && (
                <button
                  type="button"
                  className="composer-ability-remove-btn"
                  onClick={() => void handleRemoveCustomAbility(ability.id)}
                  aria-label={`Remove ${ability.label} ability`}
                  title={`Remove ${ability.label}`}
                  disabled={disabled || isSavingComposerAbility}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          )
        })}
        {customAbilitiesEnabled && (
          <button
            type="button"
            className="composer-ability-btn composer-ability-btn--custom"
            onClick={() => setShowCustomAbilityForm((visible) => !visible)}
            aria-label="Add custom composer ability"
            aria-expanded={showCustomAbilityForm}
            disabled={disabled}
          >
            <Plus size={14} />
            <span>Custom</span>
          </button>
        )}
      </>
    )
  }

  function renderComposerField() {
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
    <div className={cn('hervald-session-composer', isMobileVariant && 'hervald-session-composer--mobile')}>
      <div className="input-bar">
        {hasContextAttachments && (
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
            {contextDirectoryPaths.map((directoryPath) => (
              <span
                key={directoryPath}
                className="file-chip"
                title={directoryPath}
              >
                {basename(`${directoryPath.replace(/\/+$/u, '')}/`)}
                <button
                  type="button"
                  onClick={() => onRemoveContextDirectoryPath?.(directoryPath)}
                  className="file-chip-remove"
                  aria-label={`Remove ${basename(`${directoryPath.replace(/\/+$/u, '')}/`)}`}
                >
                  ×
                </button>
              </span>
            ))}
            {contextFileAnnotations.map((annotation) => (
              <span
                key={annotation.id}
                className="file-chip"
                title={`${annotation.path}\n${annotation.body}`}
              >
                {basename(annotation.path)} annotation
                <button
                  type="button"
                  onClick={() => onRemoveContextFileAnnotation?.(annotation.id)}
                  className="file-chip-remove"
                  aria-label={`Remove annotation for ${basename(annotation.path)}`}
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
                  className="composer-attachment-remove absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)] text-xs leading-none"
                  onClick={() => setPendingImages((prev) => prev.filter((_, imageIndex) => imageIndex !== index))}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {customAbilitiesEnabled && showCustomAbilityForm && (
          <form className="composer-custom-ability-form" onSubmit={handleCustomAbilitySubmit}>
            <input
              value={customAbilityLabel}
              onChange={(event) => setCustomAbilityLabel(event.target.value)}
              placeholder="Ability name"
              aria-label="Custom ability name"
              maxLength={40}
              disabled={disabled || isSavingComposerAbility}
            />
            <textarea
              value={customAbilityPrompt}
              onChange={(event) => setCustomAbilityPrompt(event.target.value)}
              placeholder="Prompt instructions"
              aria-label="Custom ability prompt"
              rows={2}
              maxLength={4000}
              disabled={disabled || isSavingComposerAbility}
            />
            <div className="composer-custom-ability-actions">
              <button
                type="button"
                onClick={() => setShowCustomAbilityForm(false)}
                disabled={isSavingComposerAbility}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSavingComposerAbility
                  || customAbilityLabel.trim().length === 0
                  || customAbilityPrompt.trim().length === 0
                }
              >
                Add
              </button>
            </div>
          </form>
        )}
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
            <div className="composer-field-stack composer-field-stack--mobile">
              {renderComposerField()}
            </div>

            <div className="composer-row composer-row--mobile">
              <div className="composer-mobile-utility-actions">
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

                {showMobileQueueButton && (
                  <button
                    type="button"
                    className="composer-queue-btn composer-queue-btn--mobile"
                    onClick={() => setShowQueuePanel(true)}
                    aria-label="Open queue"
                    title={queueButtonLabel}
                  >
                    <ListChecks size={16} />
                    <span>{totalQueuedCount}/{queueMaxSize}</span>
                  </button>
                )}

                {showMobileQueueDraftButton && (
                  <button
                    type="button"
                    className="composer-queue-message-btn"
                    onClick={() => {
                      void handleQueueDraft()
                    }}
                    disabled={!canQueueDraft}
                    aria-label="Queue message"
                    title={canQueueDraft ? 'Queue message' : 'Type a message to queue'}
                  >
                    <ListPlus size={18} />
                  </button>
                )}

                {renderQuickSkillSlot()}
                {renderAbilityActions()}
              </div>

              <div className="composer-mobile-primary-actions">
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
                  className="send-btn"
                  onClick={() => {
                    void handleSend()
                  }}
                  disabled={primaryActionDisabled}
                  aria-label={primaryActionLabel}
                  title={primaryActionTitle}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="composer-field-stack">
              {renderComposerField()}
            </div>

            <div className="composer-row composer-row--desktop">
              <div className="composer-desktop-actions">
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
                  onClick={() => setSkillsPickerMode('insert')}
                  aria-label="Skills"
                  disabled={disabled}
                >
                  <Zap size={18} />
                </button>

                {renderQuickSkillSlot()}
                {renderAbilityActions()}

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
                  className="composer-queue-btn composer-queue-btn--mobile rounded-lg border border-[var(--msg-border)] px-3 py-2 font-mono text-[11px] text-[var(--msg-text-muted)] transition-colors hover:bg-[var(--msg-surface-elevated)] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setShowQueuePanel(true)}
                  disabled={!canOpenQueuePanel}
                  aria-label="Open queue"
                  title={queueButtonTitle}
                >
                  {queueButtonLabel}
                </button>
              </div>

              <div className="composer-desktop-actions composer-desktop-actions--right">
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
            </div>
          </>
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
          if (skillsPickerMode === 'quick-slot') {
            return setPrimarySkillName(command)
          }
          setInputText(`${command} `)
          focusTextarea()
          return true
        }}
        onClose={() => setSkillsPickerMode(null)}
      />

      <QueuePanel
        open={showQueuePanel}
        theme={theme}
        queueSnapshot={queueSnapshot}
        queueError={queueError}
        isQueueMutating={isQueueMutating}
        canQueueDraft={canQueueDraft}
        onQueueDraft={handleQueueDraft}
        onClearQueue={onClearQueue}
        onMoveQueuedMessage={onMoveQueuedMessage}
        onRemoveQueuedMessage={onRemoveQueuedMessage}
        onClose={() => setShowQueuePanel(false)}
      />
    </div>
  )
})

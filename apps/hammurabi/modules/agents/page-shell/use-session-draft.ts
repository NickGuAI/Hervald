import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

const DRAFT_STORAGE_PREFIX = 'hammurabi:draft:'
const DRAFT_MAX_BYTES = 50 * 1024
const DRAFT_SAVE_DEBOUNCE_MS = 500
const DRAFT_SAVED_LABEL_MS = 2000

export function useSessionDraft(sessionName: string) {
  const [inputText, setInputTextState] = useState('')
  const [showDraftSaved, setShowDraftSaved] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const latestInputTextRef = useRef('')
  const draftSaveTimerRef = useRef<number | null>(null)
  const draftSavedIndicatorTimerRef = useRef<number | null>(null)
  const skipDraftSaveCountRef = useRef(1)

  const draftStorageKey = useMemo(() => `${DRAFT_STORAGE_PREFIX}${sessionName}`, [sessionName])

  const setInputText = useCallback((nextInputText: SetStateAction<string>) => {
    const resolvedInputText = typeof nextInputText === 'function'
      ? (nextInputText as (previousInputText: string) => string)(latestInputTextRef.current)
      : nextInputText

    latestInputTextRef.current = resolvedInputText
    setInputTextState(resolvedInputText)
  }, [])

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }, [])

  const clearDraftSavedIndicatorTimer = useCallback(() => {
    if (draftSavedIndicatorTimerRef.current !== null) {
      window.clearTimeout(draftSavedIndicatorTimerRef.current)
      draftSavedIndicatorTimerRef.current = null
    }
  }, [])

  const clearDraftSaveTimer = useCallback(() => {
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
  }, [])

  const showDraftSavedIndicator = useCallback(() => {
    setShowDraftSaved(true)
    clearDraftSavedIndicatorTimer()
    draftSavedIndicatorTimerRef.current = window.setTimeout(() => {
      setShowDraftSaved(false)
      draftSavedIndicatorTimerRef.current = null
    }, DRAFT_SAVED_LABEL_MS)
  }, [clearDraftSavedIndicatorTimer])

  const persistDraft = useCallback((value: string, showIndicator = true) => {
    try {
      if (!value) {
        localStorage.removeItem(draftStorageKey)
        if (showIndicator) {
          setShowDraftSaved(false)
        }
        return
      }

      if (new Blob([value]).size > DRAFT_MAX_BYTES) {
        localStorage.removeItem(draftStorageKey)
        if (showIndicator) {
          setShowDraftSaved(false)
        }
        return
      }

      localStorage.setItem(draftStorageKey, value)
      if (showIndicator) {
        showDraftSavedIndicator()
      }
    } catch {
      // Ignore localStorage errors (quota, private mode, etc.)
    }
  }, [draftStorageKey, showDraftSavedIndicator])

  const focusTextarea = useCallback(() => {
    requestAnimationFrame(() => {
      resizeTextarea()
      textareaRef.current?.focus()
    })
  }, [resizeTextarea])

  const clearDraft = useCallback(() => {
    latestInputTextRef.current = ''
    clearDraftSaveTimer()
    clearDraftSavedIndicatorTimer()
    try {
      localStorage.removeItem(draftStorageKey)
    } catch {
      // Ignore localStorage errors.
    }
    setInputTextState('')
    setShowDraftSaved(false)
    requestAnimationFrame(() => {
      resizeTextarea()
    })
  }, [clearDraftSaveTimer, clearDraftSavedIndicatorTimer, draftStorageKey, resizeTextarea])

  useEffect(() => {
    resizeTextarea()
  }, [inputText, resizeTextarea])

  useEffect(() => {
    const previousInput = latestInputTextRef.current
    setShowDraftSaved(false)

    let restoredDraft = ''
    try {
      restoredDraft = localStorage.getItem(draftStorageKey) ?? ''
    } catch {
      restoredDraft = ''
    }

    skipDraftSaveCountRef.current = restoredDraft === previousInput ? 1 : 2
    latestInputTextRef.current = restoredDraft
    setInputTextState(restoredDraft)
    requestAnimationFrame(() => {
      resizeTextarea()
    })
  }, [draftStorageKey, resizeTextarea])

  useEffect(() => {
    if (skipDraftSaveCountRef.current > 0) {
      skipDraftSaveCountRef.current -= 1
      return
    }

    clearDraftSaveTimer()
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null
      persistDraft(inputText)
    }, DRAFT_SAVE_DEBOUNCE_MS)

    return () => {
      clearDraftSaveTimer()
    }
  }, [clearDraftSaveTimer, inputText, persistDraft])

  const flushLatestDraft = useCallback(() => {
    clearDraftSaveTimer()
    persistDraft(latestInputTextRef.current, false)
  }, [clearDraftSaveTimer, persistDraft])

  useEffect(() => {
    window.addEventListener('beforeunload', flushLatestDraft)
    window.addEventListener('pagehide', flushLatestDraft)
    return () => {
      window.removeEventListener('beforeunload', flushLatestDraft)
      window.removeEventListener('pagehide', flushLatestDraft)
    }
  }, [flushLatestDraft])

  useEffect(() => {
    return () => {
      clearDraftSavedIndicatorTimer()
      flushLatestDraft()
    }
  }, [clearDraftSavedIndicatorTimer, flushLatestDraft])

  return {
    inputText,
    latestInputTextRef,
    resizeTextarea,
    setInputText,
    showDraftSaved,
    focusTextarea,
    textareaRef,
    clearDraft,
  }
}

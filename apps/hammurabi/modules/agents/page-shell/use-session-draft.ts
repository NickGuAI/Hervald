import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import {
  ALLOWED_MESSAGE_IMAGE_TYPES,
  MAX_MESSAGE_IMAGE_B64_LEN,
  MAX_MESSAGE_IMAGE_COUNT,
} from '../message-images'

const DRAFT_STORAGE_PREFIX = 'hammurabi:draft:'
const DRAFT_IMAGES_STORAGE_PREFIX = 'hammurabi:draft-images:'
const DRAFT_MAX_BYTES = 50 * 1024
const DRAFT_IMAGES_MAX_BYTES = 12 * 1024 * 1024
const DRAFT_SAVE_DEBOUNCE_MS = 500
const DRAFT_SAVED_LABEL_MS = 2000

export interface SessionDraftImage {
  mediaType: string
  data: string
}

function normalizeDraftImages(value: unknown): SessionDraftImage[] {
  const rawImages = Array.isArray(value)
    ? value
    : (
        value
        && typeof value === 'object'
        && Array.isArray((value as { images?: unknown }).images)
          ? (value as { images: unknown[] }).images
          : []
      )
  const images: SessionDraftImage[] = []
  for (const rawImage of rawImages) {
    if (!rawImage || typeof rawImage !== 'object') {
      continue
    }
    const mediaType = (rawImage as { mediaType?: unknown }).mediaType
    const data = (rawImage as { data?: unknown }).data
    if (
      typeof mediaType === 'string'
      && ALLOWED_MESSAGE_IMAGE_TYPES.has(mediaType)
      && typeof data === 'string'
      && data.length > 0
      && data.length <= MAX_MESSAGE_IMAGE_B64_LEN
    ) {
      images.push({ mediaType, data })
    }
    if (images.length >= MAX_MESSAGE_IMAGE_COUNT) {
      break
    }
  }
  return images
}

export function useSessionDraft(sessionName: string) {
  const [inputText, setInputTextState] = useState('')
  const [pendingImages, setPendingImagesState] = useState<SessionDraftImage[]>([])
  const [showDraftSaved, setShowDraftSaved] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const latestInputTextRef = useRef('')
  const latestPendingImagesRef = useRef<SessionDraftImage[]>([])
  const draftSaveTimerRef = useRef<number | null>(null)
  const draftSavedIndicatorTimerRef = useRef<number | null>(null)
  const skipDraftSaveCountRef = useRef(1)

  const draftStorageKey = useMemo(() => `${DRAFT_STORAGE_PREFIX}${sessionName}`, [sessionName])
  const draftImagesStorageKey = useMemo(() => `${DRAFT_IMAGES_STORAGE_PREFIX}${sessionName}`, [sessionName])

  const setInputText = useCallback((nextInputText: SetStateAction<string>) => {
    const resolvedInputText = typeof nextInputText === 'function'
      ? (nextInputText as (previousInputText: string) => string)(latestInputTextRef.current)
      : nextInputText

    latestInputTextRef.current = resolvedInputText
    setInputTextState(resolvedInputText)
  }, [])

  const setPendingImages = useCallback((nextPendingImages: SetStateAction<SessionDraftImage[]>) => {
    const resolvedPendingImages = typeof nextPendingImages === 'function'
      ? (nextPendingImages as (previousPendingImages: SessionDraftImage[]) => SessionDraftImage[])(latestPendingImagesRef.current)
      : nextPendingImages
    const normalizedPendingImages = normalizeDraftImages(resolvedPendingImages)

    latestPendingImagesRef.current = normalizedPendingImages
    setPendingImagesState(normalizedPendingImages)
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

  const persistDraft = useCallback((value: string, images: SessionDraftImage[], showIndicator = true) => {
    let persistedSomething = false
    try {
      if (!value) {
        localStorage.removeItem(draftStorageKey)
      } else if (new Blob([value]).size > DRAFT_MAX_BYTES) {
        localStorage.removeItem(draftStorageKey)
      } else {
        localStorage.setItem(draftStorageKey, value)
        persistedSomething = true
      }
    } catch {
      // Ignore localStorage errors (quota, private mode, etc.)
    }

    try {
      if (images.length === 0) {
        localStorage.removeItem(draftImagesStorageKey)
      } else {
        const payload = JSON.stringify({ images })
        if (new Blob([payload]).size > DRAFT_IMAGES_MAX_BYTES) {
          localStorage.removeItem(draftImagesStorageKey)
        } else {
          localStorage.setItem(draftImagesStorageKey, payload)
          persistedSomething = true
        }
      }
    } catch {
      // Ignore localStorage errors (quota, private mode, etc.)
    }

    if (showIndicator) {
      if (persistedSomething) {
        showDraftSavedIndicator()
      } else {
        setShowDraftSaved(false)
      }
    }
  }, [draftImagesStorageKey, draftStorageKey, showDraftSavedIndicator])

  const focusTextarea = useCallback(() => {
    requestAnimationFrame(() => {
      resizeTextarea()
      textareaRef.current?.focus()
    })
  }, [resizeTextarea])

  const clearDraft = useCallback(() => {
    latestInputTextRef.current = ''
    latestPendingImagesRef.current = []
    clearDraftSaveTimer()
    clearDraftSavedIndicatorTimer()
    try {
      localStorage.removeItem(draftStorageKey)
      localStorage.removeItem(draftImagesStorageKey)
    } catch {
      // Ignore localStorage errors.
    }
    setInputTextState('')
    setPendingImagesState([])
    setShowDraftSaved(false)
    requestAnimationFrame(() => {
      resizeTextarea()
    })
  }, [clearDraftSaveTimer, clearDraftSavedIndicatorTimer, draftImagesStorageKey, draftStorageKey, resizeTextarea])

  useEffect(() => {
    resizeTextarea()
  }, [inputText, resizeTextarea])

  useLayoutEffect(() => {
    const previousInput = latestInputTextRef.current
    setShowDraftSaved(false)

    let restoredDraft = ''
    let restoredImages: SessionDraftImage[] = []
    try {
      restoredDraft = localStorage.getItem(draftStorageKey) ?? ''
    } catch {
      restoredDraft = ''
    }
    try {
      const rawImages = localStorage.getItem(draftImagesStorageKey)
      restoredImages = rawImages && new Blob([rawImages]).size <= DRAFT_IMAGES_MAX_BYTES
        ? normalizeDraftImages(JSON.parse(rawImages))
        : []
    } catch {
      restoredImages = []
    }

    const previousImages = latestPendingImagesRef.current
    const imagesUnchanged = JSON.stringify(restoredImages) === JSON.stringify(previousImages)
    skipDraftSaveCountRef.current = restoredDraft === previousInput && imagesUnchanged ? 1 : 2
    latestInputTextRef.current = restoredDraft
    latestPendingImagesRef.current = restoredImages
    setInputTextState(restoredDraft)
    setPendingImagesState(restoredImages)
    requestAnimationFrame(() => {
      resizeTextarea()
    })
  }, [draftImagesStorageKey, draftStorageKey, resizeTextarea])

  useEffect(() => {
    if (skipDraftSaveCountRef.current > 0) {
      skipDraftSaveCountRef.current -= 1
      return
    }

    clearDraftSaveTimer()
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null
      persistDraft(inputText, pendingImages)
    }, DRAFT_SAVE_DEBOUNCE_MS)

    return () => {
      clearDraftSaveTimer()
    }
  }, [clearDraftSaveTimer, inputText, pendingImages, persistDraft])

  const flushLatestDraft = useCallback(() => {
    clearDraftSaveTimer()
    persistDraft(latestInputTextRef.current, latestPendingImagesRef.current, false)
  }, [clearDraftSaveTimer, persistDraft])

  useLayoutEffect(() => {
    return () => {
      flushLatestDraft()
    }
  }, [flushLatestDraft])

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
    }
  }, [clearDraftSavedIndicatorTimer])

  return {
    inputText,
    latestInputTextRef,
    pendingImages,
    latestPendingImagesRef,
    resizeTextarea,
    setInputText,
    setPendingImages,
    showDraftSaved,
    focusTextarea,
    textareaRef,
    clearDraft,
  }
}

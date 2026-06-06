import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import {
  getDefaultComposerSkillSlotSettings,
  getPrimaryComposerSkillName,
  normalizePersistedComposerSkillSlotSettings,
  setPrimaryComposerSkillName,
  type ComposerSkillSlotSettings,
} from '@modules/settings/composer-skill-slots'

interface AppSettingsResponse {
  settings?: {
    composerSkillSlots?: unknown
  }
}

function normalizeComposerSkillSlotSettings(payload: unknown): ComposerSkillSlotSettings {
  const source = (
    typeof payload === 'object' && payload !== null && 'settings' in payload
      ? (payload as AppSettingsResponse).settings?.composerSkillSlots
      : payload
  )
  return normalizePersistedComposerSkillSlotSettings(source)
}

async function fetchComposerSkillSlotSettings(): Promise<ComposerSkillSlotSettings> {
  return normalizeComposerSkillSlotSettings(await fetchJson<unknown>('/api/settings'))
}

async function patchComposerSkillSlotSettings(
  settings: ComposerSkillSlotSettings,
): Promise<ComposerSkillSlotSettings> {
  return normalizeComposerSkillSlotSettings(await fetchJson<unknown>('/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ composerSkillSlots: settings }),
  }))
}

export function useComposerSkillSlots(): {
  settings: ComposerSkillSlotSettings
  primarySkillName: string | null
  setPrimarySkillName: (skillName: string) => Promise<boolean>
  clearPrimarySkillName: () => Promise<boolean>
  isLoading: boolean
  isSaving: boolean
} {
  const [settings, setSettings] = useState<ComposerSkillSlotSettings>(() =>
    getDefaultComposerSkillSlotSettings(),
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let disposed = false

    async function loadSettings() {
      try {
        const nextSettings = await fetchComposerSkillSlotSettings()
        if (!disposed) {
          setSettings(nextSettings)
        }
      } catch {
        // Keep the empty slot available when settings are unavailable.
      } finally {
        if (!disposed) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      disposed = true
    }
  }, [])

  const persistSettings = useCallback(async (nextSettings: ComposerSkillSlotSettings): Promise<boolean> => {
    const previous = settings
    setSettings(nextSettings)
    setIsSaving(true)
    try {
      const savedSettings = await patchComposerSkillSlotSettings(nextSettings)
      setSettings(savedSettings)
      return true
    } catch {
      setSettings(previous)
      return false
    } finally {
      setIsSaving(false)
    }
  }, [settings])

  const updatePrimarySkillName = useCallback(async (skillName: string | null): Promise<boolean> => {
    return persistSettings(setPrimaryComposerSkillName(settings, skillName))
  }, [persistSettings, settings])

  return {
    settings,
    primarySkillName: getPrimaryComposerSkillName(settings),
    setPrimarySkillName: (skillName: string) => updatePrimarySkillName(skillName),
    clearPrimarySkillName: () => updatePrimarySkillName(null),
    isLoading,
    isSaving,
  }
}

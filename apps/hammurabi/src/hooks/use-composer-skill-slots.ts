import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

const COMPOSER_SKILL_SLOT_SETTINGS_QUERY_KEY = ['settings', 'composer-skill-slots'] as const

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
  loadError: Error | null
  retryLoad: () => void
} {
  const [settings, setSettings] = useState<ComposerSkillSlotSettings>(() =>
    getDefaultComposerSkillSlotSettings(),
  )
  const [isSaving, setIsSaving] = useState(false)
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: COMPOSER_SKILL_SLOT_SETTINGS_QUERY_KEY,
    queryFn: fetchComposerSkillSlotSettings,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data)
    }
  }, [settingsQuery.data])

  const persistSettings = useCallback(async (nextSettings: ComposerSkillSlotSettings): Promise<boolean> => {
    const previous = settings
    setSettings(nextSettings)
    setIsSaving(true)
    try {
      const savedSettings = await patchComposerSkillSlotSettings(nextSettings)
      queryClient.setQueryData(COMPOSER_SKILL_SLOT_SETTINGS_QUERY_KEY, savedSettings)
      setSettings(savedSettings)
      return true
    } catch {
      setSettings(previous)
      return false
    } finally {
      setIsSaving(false)
    }
  }, [queryClient, settings])

  const updatePrimarySkillName = useCallback(async (skillName: string | null): Promise<boolean> => {
    return persistSettings(setPrimaryComposerSkillName(settings, skillName))
  }, [persistSettings, settings])

  return {
    settings,
    primarySkillName: getPrimaryComposerSkillName(settings),
    setPrimarySkillName: (skillName: string) => updatePrimarySkillName(skillName),
    clearPrimarySkillName: () => updatePrimarySkillName(null),
    isLoading: settingsQuery.isLoading,
    isSaving,
    loadError: settingsQuery.error,
    retryLoad: () => {
      void settingsQuery.refetch()
    },
  }
}

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'

export type AppTheme = 'light' | 'dark'

export interface AppSettings {
  theme: AppTheme
  updatedAt?: string
}

interface AppSettingsResponse {
  settings?: AppSettings
}

interface ThemeContextValue {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
  isLoading: boolean
  isSaving: boolean
}

const SETTINGS_QUERY_KEY = ['settings'] as const
const ThemeContext = createContext<ThemeContextValue | null>(null)

function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light'
}

function normalizeSettings(payload: unknown): AppSettings {
  const source = (
    typeof payload === 'object' && payload !== null && 'settings' in payload
      ? (payload as AppSettingsResponse).settings
      : payload
  ) as AppSettings | undefined

  return {
    theme: normalizeTheme(source?.theme),
    updatedAt: typeof source?.updatedAt === 'string' ? source.updatedAt : undefined,
  }
}

function readDocumentTheme(): AppTheme {
  if (typeof document === 'undefined') {
    return 'light'
  }
  return document.documentElement.classList.contains('hv-dark') ? 'dark' : 'light'
}

function applyDocumentTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.classList.remove('hv-light', 'hv-dark')
  document.documentElement.classList.add(theme === 'dark' ? 'hv-dark' : 'hv-light')
}

async function fetchSettings(): Promise<AppSettings> {
  return normalizeSettings(await fetchJson<unknown>('/api/settings'))
}

async function patchTheme(theme: AppTheme): Promise<AppSettings> {
  return normalizeSettings(await fetchJson<unknown>('/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ theme }),
  }))
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const fallbackTheme = readDocumentTheme()
  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettings,
    staleTime: 30_000,
  })
  const theme = settingsQuery.data?.theme ?? fallbackTheme

  const themeMutation = useMutation({
    mutationFn: patchTheme,
    onMutate: async (nextTheme) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY })
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_QUERY_KEY)
      const previousTheme = previous?.theme ?? readDocumentTheme()
      queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, {
        ...(previous ?? { updatedAt: new Date().toISOString() }),
        theme: nextTheme,
      })
      applyDocumentTheme(nextTheme)
      return { previous, previousTheme }
    },
    onError: (_error, _nextTheme, context) => {
      if (context?.previous) {
        queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, context.previous)
        applyDocumentTheme(context.previous.theme)
        return
      }

      applyDocumentTheme(context?.previousTheme ?? 'light')
    },
    onSuccess: (settings) => {
      queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, settings)
      applyDocumentTheme(settings.theme)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
    },
  })

  useEffect(() => {
    applyDocumentTheme(theme)
  }, [theme])

  const setTheme = useCallback((nextTheme: AppTheme) => {
    themeMutation.mutate(normalizeTheme(nextTheme))
  }, [themeMutation])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
    toggleTheme,
    isLoading: settingsQuery.isLoading,
    isSaving: themeMutation.isPending,
  }), [
    setTheme,
    settingsQuery.isLoading,
    theme,
    themeMutation.isPending,
    toggleTheme,
  ])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context) {
    return context
  }

  const theme = readDocumentTheme()
  return {
    theme,
    setTheme: applyDocumentTheme,
    toggleTheme: () => applyDocumentTheme(theme === 'dark' ? 'light' : 'dark'),
    isLoading: false,
    isSaving: false,
  }
}

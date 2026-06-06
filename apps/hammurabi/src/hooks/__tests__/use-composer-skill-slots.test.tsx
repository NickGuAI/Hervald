// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import { useComposerSkillSlots } from '@/hooks/use-composer-skill-slots'

let root: Root | null = null
let container: HTMLDivElement | null = null
let latestSkillSlots: ReturnType<typeof useComposerSkillSlots> | null = null

function createSettings(skillName: string | null) {
  return {
    settings: {
      theme: 'light',
      fontScale: 1,
      composerSkillSlots: {
        slots: [{
          id: 'primary',
          skillName,
        }],
      },
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  }
}

function Harness() {
  latestSkillSlots = useComposerSkillSlots()
  return createElement('span', null, latestSkillSlots.primarySkillName ?? 'empty')
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderHookHarness(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(createElement(Harness))
  })
}

async function unmountHarness(): Promise<void> {
  if (!root) {
    return
  }
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
}

beforeEach(() => {
  latestSkillSlots = null
})

afterEach(async () => {
  await unmountHarness()
  latestSkillSlots = null
  vi.clearAllMocks()
})

describe('useComposerSkillSlots', () => {
  it('persists the primary skill slot and reads it back on remount', async () => {
    let savedSkillName: string | null = null
    mocks.fetchJson.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (!init) {
        return createSettings(savedSkillName)
      }

      const body = JSON.parse(String(init.body)) as {
        composerSkillSlots?: {
          slots?: Array<{ id: string; skillName: string | null }>
        }
      }
      savedSkillName = body.composerSkillSlots?.slots?.find((slot) => slot.id === 'primary')?.skillName ?? null
      return createSettings(savedSkillName)
    })

    await renderHookHarness()
    await flushMicrotasks()

    expect(latestSkillSlots?.primarySkillName).toBeNull()

    await act(async () => {
      await latestSkillSlots?.setPrimarySkillName('/create-quests')
    })
    await flushMicrotasks()

    expect(mocks.fetchJson).toHaveBeenNthCalledWith(2, '/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        composerSkillSlots: {
          slots: [{
            id: 'primary',
            skillName: 'create-quests',
          }],
        },
      }),
    })
    expect(savedSkillName).toBe('create-quests')
    expect(latestSkillSlots?.primarySkillName).toBe('create-quests')

    await unmountHarness()
    await renderHookHarness()
    await flushMicrotasks()

    expect(latestSkillSlots?.primarySkillName).toBe('create-quests')
  })
})

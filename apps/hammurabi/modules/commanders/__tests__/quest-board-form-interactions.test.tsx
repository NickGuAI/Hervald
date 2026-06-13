// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestBoard } from '../components/QuestBoard'

const mocks = vi.hoisted(() => ({
  createQuest: vi.fn(),
  deleteQuest: vi.fn(),
  mutationCallIndex: 0,
  createOnSuccess: null as null | ((data: unknown, input: unknown) => Promise<void> | void),
  deleteOnSuccess: null as null | ((data: unknown, input: unknown) => Promise<void> | void),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
    useQuery: (options: { queryKey?: unknown[] }) => {
      const key = options.queryKey ?? []
      if (key[0] === 'skills') {
        return {
          data: [
            {
              name: 'legion-investigate',
              description: 'Investigate a codebase problem.',
              userInvocable: true,
            },
            {
              name: 'legion-implement',
              description: 'Implement a GitHub issue.',
              userInvocable: true,
            },
          ],
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }
      }
      if (key[0] === 'agents' && key[1] === 'directories') {
        return {
          data: { parent: '/Users/yugu', directories: ['/Users/yugu/App'] },
          isLoading: false,
          isError: false,
          error: null,
        }
      }
      return {
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }
    },
    useMutation: (options: { onSuccess?: (data: unknown, input: unknown) => Promise<void> | void }) => {
      const isCreateMutation = mocks.mutationCallIndex % 2 === 0
      mocks.mutationCallIndex += 1
      if (isCreateMutation) {
        mocks.createOnSuccess = options.onSuccess ?? null
      } else {
        mocks.deleteOnSuccess = options.onSuccess ?? null
      }
      return {
        mutateAsync: isCreateMutation ? mocks.createQuest : mocks.deleteQuest,
        isPending: false,
        error: null,
      }
    },
  }
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderQuestBoard() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      createElement(QuestBoard, {
        commanders: [{ id: 'commander-1', host: 'atlas' }],
        selectedCommanderId: 'commander-1',
      }),
    )
    await Promise.resolve()
  })
}

function clickButton(label: string): void {
  const button = Array.from(document.body.querySelectorAll('button')).findLast(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`)
  }
  act(() => {
    button.click()
  })
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  if (!valueSetter) {
    throw new Error('Missing input value setter')
  }
  act(() => {
    valueSetter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function getInstructionField(): HTMLTextAreaElement {
  const textarea = Array.from(document.body.querySelectorAll('textarea')).findLast(
    (candidate): candidate is HTMLTextAreaElement => candidate instanceof HTMLTextAreaElement,
  )
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('Missing instruction textarea')
  }
  return textarea
}

function getWorkingDirectoryField(): HTMLInputElement {
  const input = Array.from(document.body.querySelectorAll('input'))
    .findLast((candidate): candidate is HTMLInputElement =>
      candidate.type !== 'checkbox' && candidate.placeholder.includes('home directory'),
    )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Missing working directory picker input')
  }
  return input
}

async function openQuestForm(): Promise<void> {
  clickButton('Add Quest')
  await vi.waitFor(() => {
    expect(document.body.querySelector('textarea')).not.toBeNull()
  })
}

beforeEach(() => {
  previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  window.sessionStorage.clear()
  mocks.mutationCallIndex = 0
  mocks.createOnSuccess = null
  mocks.deleteOnSuccess = null
  mocks.createQuest.mockReset()
  mocks.deleteQuest.mockReset()
  mocks.createQuest.mockImplementation(async (input: unknown) => {
    await mocks.createOnSuccess?.({}, input)
    return {}
  })
  mocks.deleteQuest.mockImplementation(async (input: unknown) => {
    await mocks.deleteOnSuccess?.({}, input)
    return {}
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  window.sessionStorage.clear()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('QuestBoard create form interactions', () => {
  it('submits selected directory and discovered skills, then resets the draft', async () => {
    await renderQuestBoard()
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Add Quest')
    })
    await openQuestForm()

    setInputValue(getInstructionField(), 'Investigate auth drift')
    setInputValue(getWorkingDirectoryField(), '/Users/yugu/App')

    const skillCheckbox = Array.from(document.body.querySelectorAll('input[type="checkbox"]'))
      .find((input) => input instanceof HTMLInputElement && input.parentElement?.textContent?.includes('/legion-investigate'))
    if (!(skillCheckbox instanceof HTMLInputElement)) {
      throw new Error('Missing discovered skill checkbox')
    }
    act(() => {
      skillCheckbox.click()
    })

    await act(async () => {
      const form = Array.from(document.body.querySelectorAll('form')).findLast(
        (candidate): candidate is HTMLFormElement => candidate instanceof HTMLFormElement,
      )
      if (!(form instanceof HTMLFormElement)) {
        throw new Error('Missing quest form')
      }
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Quest added.')
    })

    expect(mocks.createQuest).toHaveBeenCalledWith({
      commanderId: 'commander-1',
      instruction: 'Investigate auth drift',
      source: 'manual',
      contract: {
        cwd: '/Users/yugu/App',
        agentType: 'claude',
        permissionMode: 'default',
        skillsToUse: ['legion-investigate'],
      },
    })
    expect(document.body.textContent).toContain('Quest added.')

    await openQuestForm()
    expect(getInstructionField().value).toBe('')
    expect(getWorkingDirectoryField().value).toBe('')
    const reopenedSkill = Array.from(document.body.querySelectorAll('input[type="checkbox"]'))
      .find((input) => input instanceof HTMLInputElement && input.parentElement?.textContent?.includes('/legion-investigate'))
    expect((reopenedSkill as HTMLInputElement | undefined)?.checked).toBe(false)
  })

  it('clears drafts and warns before dirty dismiss', async () => {
    await renderQuestBoard()
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Add Quest')
    })
    await openQuestForm()

    setInputValue(getInstructionField(), 'Draft survives until cleared')
    clickButton('Clear draft')
    await vi.waitFor(() => {
      expect(getInstructionField().value).toBe('')
    })

    setInputValue(getInstructionField(), 'Dirty dismiss warning')
    clickButton('Close')
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Discard quest draft?')
    })
    clickButton('Cancel')
    await vi.waitFor(() => {
      expect(getInstructionField().value).toBe('Dirty dismiss warning')
    })

    clickButton('Close')
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Discard quest draft?')
    })
    clickButton('Discard draft')
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Dirty dismiss warning')
    })

    await openQuestForm()
    expect(getInstructionField().value).toBe('')
  })

  it('restores dirty drafts after the quest board unmounts', async () => {
    await renderQuestBoard()
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Add Quest')
    })
    await openQuestForm()

    setInputValue(getInstructionField(), 'Persist this quest through navigation')
    setInputValue(getWorkingDirectoryField(), '/Users/yugu/App')
    await vi.waitFor(() => {
      expect(window.sessionStorage.getItem('hammurabi:quest-board:draft:v1'))
        .toContain('Persist this quest through navigation')
    })

    act(() => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''

    await renderQuestBoard()

    await vi.waitFor(() => {
      expect(getInstructionField().value).toBe('Persist this quest through navigation')
    })
    expect(getWorkingDirectoryField().value).toBe('/Users/yugu/App')
  })
})

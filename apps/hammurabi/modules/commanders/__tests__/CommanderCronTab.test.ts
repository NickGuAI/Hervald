// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommanderCronTab } from '../components/CommanderCronTab'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useMachines: vi.fn(),
  useDirectories: vi.fn(),
  useSkills: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

vi.mock('@/hooks/use-agents', () => ({
  useMachines: mocks.useMachines,
  useDirectories: mocks.useDirectories,
}))

vi.mock('@/hooks/use-skills', () => ({
  useSkills: mocks.useSkills,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let originalMatchMedia: typeof window.matchMedia | undefined
let mountedRoots: Root[] = []

function setElementValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype

  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  valueSetter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderTab(props: Partial<ComponentProps<typeof CommanderCronTab>> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  const addCron = vi.fn().mockResolvedValue(undefined)
  const toggleCron = vi.fn().mockResolvedValue(undefined)
  const updateCron = vi.fn().mockResolvedValue(undefined)
  const triggerCron = vi.fn().mockResolvedValue(undefined)
  const deleteCron = vi.fn().mockResolvedValue(undefined)

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(CommanderCronTab, {
          scope: {
            kind: 'commander',
            commander: {
              id: 'commander-1',
              host: 'swe-mbp',
              state: 'running',
              created: '2026-04-19T00:00:00.000Z',
              heartbeat: {
                intervalMs: 900_000,
                messageTemplate: 'Check status',
                lastSentAt: null,
              },
              lastHeartbeat: null,
              taskSource: null,
              currentTask: null,
              completedTasks: 0,
              questCount: 0,
              scheduleCount: 0,
              totalCostUsd: 0,
              effort: 'max',
            },
          },
          crons: [],
          cronsLoading: false,
          cronsError: null,
          addCron,
          addCronPending: false,
          toggleCron,
          toggleCronPending: false,
          toggleCronId: null,
          updateCron,
          updateCronPending: false,
          updateCronId: null,
          triggerCron,
          triggerCronPending: false,
          triggerCronId: null,
          deleteCron,
          deleteCronPending: false,
          deleteCronId: null,
          ...props,
        }),
      ),
    )
  })

  return { addCron, toggleCron, updateCron, triggerCron, deleteCron }
}

describe('CommanderCronTab', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    mocks.useMachines.mockReturnValue({ data: [] })
    mocks.fetchJson.mockResolvedValue([])
    mocks.useDirectories.mockReturnValue({
      data: {
        parent: '/Users/yugu',
        directories: [],
      },
    })
    mocks.useSkills.mockReturnValue({ data: [], isLoading: false })
  })

  afterEach(async () => {
    for (const root of mountedRoots) {
      await act(async () => {
        root.unmount()
      })
    }
    mountedRoots = []
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    mocks.useMachines.mockReset()
    mocks.fetchJson.mockReset()
    mocks.useDirectories.mockReset()
    mocks.useSkills.mockReset()
    document.body.innerHTML = ''
  })

  it('reuses the shared main popup to create commander automation', async () => {
    const { addCron } = await renderTab()

    const launchButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add Automation',
    )
    if (!launchButton) {
      throw new Error('Could not find Add Automation button')
    }

    await act(async () => {
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('New Cron Task')
    expect(document.body.textContent).toContain('Task Name')
    expect(document.body.textContent).toContain('Schedule')

    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[]

    const nameInput = inputs.find((input) => input.placeholder === 'nightly-deploy')
    const scheduleInput = inputs.find((input) => input.placeholder === '0 2 * * *')
    const taskInput = textareas.find((textarea) =>
      textarea.placeholder === 'Run the nightly test suite and report results',
    )

    if (!nameInput || !scheduleInput || !taskInput) {
      throw new Error('Expected shared create-task form fields to render')
    }

    await act(async () => {
      setElementValue(nameInput, 'daily-review')
      setElementValue(scheduleInput, '30 09 * * 1-5')
      setElementValue(taskInput, 'Review pending quests and send a summary.')
    })

    const submitButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Create Task',
    )
    if (!submitButton) {
      throw new Error('Could not find Create Task button')
    }

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(addCron).toHaveBeenCalledWith({
      commanderId: 'commander-1',
      name: 'daily-review',
      schedule: '30 09 * * 1-5',
      instruction: 'Review pending quests and send a summary.',
      enabled: true,
      agentType: 'claude',
      sessionType: 'stream',
      permissionMode: 'default',
      workDir: '',
      machine: '',
    })
  })

  it('creates and manages global automation without attaching a commander id', async () => {
    const { addCron, toggleCron, deleteCron } = await renderTab({
      scope: { kind: 'global' },
      crons: [{
        id: 'global-1',
        name: 'global-review',
        schedule: '0 * * * *',
        instruction: 'Check global inbox.',
        enabled: true,
        lastRun: null,
        lastRunStatus: 'complete',
        nextRun: null,
        createdAt: '2026-04-20T09:00:00.000Z',
      }],
    })

    const launchButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add Automation',
    )
    if (!launchButton) {
      throw new Error('Could not find Add Automation button')
    }

    await act(async () => {
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    const nameInput = inputs.find((input) => input.placeholder === 'nightly-deploy')
    const scheduleInput = inputs.find((input) => input.placeholder === '0 2 * * *')
    const taskInput = textareas.find((textarea) =>
      textarea.placeholder === 'Run the nightly test suite and report results',
    )

    if (!nameInput || !scheduleInput || !taskInput) {
      throw new Error('Expected shared create-task form fields to render')
    }

    await act(async () => {
      setElementValue(nameInput, 'global-review')
      setElementValue(scheduleInput, '15 * * * *')
      setElementValue(taskInput, 'Review unattached automations.')
    })

    const submitButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Create Task',
    )
    if (!submitButton) {
      throw new Error('Could not find Create Task button')
    }

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(addCron).toHaveBeenCalledWith({
      commanderId: undefined,
      name: 'global-review',
      schedule: '15 * * * *',
      instruction: 'Review unattached automations.',
      enabled: true,
      agentType: 'claude',
      sessionType: 'stream',
      permissionMode: 'default',
      workDir: '',
      machine: '',
    })

    const toggleButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Disable'),
    )
    const deleteButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Del'),
    )

    if (!toggleButton || !(deleteButton instanceof HTMLButtonElement)) {
      throw new Error('Expected global automation controls to render')
    }

    await act(async () => {
      toggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(toggleCron).toHaveBeenCalledWith({
      commanderId: undefined,
      cronId: 'global-1',
      enabled: false,
    })
    expect(deleteCron).toHaveBeenCalledWith({
      commanderId: undefined,
      cronId: 'global-1',
    })
  })

  it('renders the canonical task card affordances, including run history, for cron rows', async () => {
    await renderTab({
      crons: [{
        id: 'cron-1',
        name: 'daily-review',
        schedule: '30 09 * * 1-5',
        instruction: 'Review pending quests and send a summary.',
        enabled: true,
        lastRun: '2026-04-20T09:30:00.000Z',
        lastRunStatus: 'complete',
        nextRun: '2026-04-21T09:30:00.000Z',
        createdAt: '2026-04-19T09:00:00.000Z',
        agentType: 'claude',
        sessionType: 'stream',
        permissionMode: 'default',
        workDir: '/Users/example/example-repo-fixture',
        machine: '',
      }],
    })

    expect(document.body.textContent).toContain('daily-review')
    expect(document.body.textContent).toContain('Edit')
    expect(document.body.textContent).toContain('Run')
    expect(document.body.textContent).toContain('Runs')
    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/command-room/tasks/cron-1/runs')
  })
})

import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  useMachines: vi.fn(),
  useDirectories: vi.fn(),
  useSkills: vi.fn(),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  let useStateCallCount = 0
  const mockedUseState = ((initialState: unknown) => {
    useStateCallCount += 1
    if (useStateCallCount === 1) {
      return [true, vi.fn()] as unknown as ReturnType<typeof actual.useState>
    }
    return actual.useState(initialState as never)
  }) as typeof actual.useState

  return {
    ...actual,
    useState: mockedUseState,
  }
})

vi.mock('@/hooks/use-agents', () => ({
  useMachines: mocks.useMachines,
  useDirectories: mocks.useDirectories,
}))

vi.mock('@/hooks/use-skills', () => ({
  useSkills: mocks.useSkills,
}))

import { TaskList } from '../components/TaskList'

describe('TaskList modal form', () => {
  it('renders cron-task modal fields when new-task modal is open', () => {
    mocks.useMachines.mockReturnValue({
      data: [],
      isLoading: false,
    })
    mocks.useDirectories.mockReturnValue({
      data: {
        directories: [],
        parent: '/home/ec2-user',
      },
      isLoading: false,
    })
    mocks.useSkills.mockReturnValue({
      data: [],
      isLoading: false,
    })

    const html = renderToStaticMarkup(
      createElement(TaskList, {
        tasks: [],
        selectedTaskId: null,
        onSelect: vi.fn(),
        onCreate: vi.fn(async () => undefined),
        onToggle: vi.fn(async () => undefined),
        onDelete: vi.fn(async () => undefined),
        onRunNow: vi.fn(async () => undefined),
        createPending: false,
        updateTaskId: null,
        deleteTaskId: null,
        triggerTaskId: null,
        loading: false,
      }),
    )

    expect(html).toContain('New Cron Task')
    expect(html).toContain('Task Name')
    expect(html).toContain('Schedule')
    expect(html).toContain('Timezone')
    expect(html).toContain('Create Task')
    expect(html).toMatch(/<form[\s\S]*Timezone[\s\S]*Create Task[\s\S]*<\/form>/)
  })
})

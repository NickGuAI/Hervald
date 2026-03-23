import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useMachines: vi.fn(),
  useDirectories: vi.fn(),
  navigate: vi.fn(),
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/hooks/use-agents', () => ({
  useMachines: mocks.useMachines,
  useDirectories: mocks.useDirectories,
}))

vi.mock('../hooks/useCommander', () => ({
  useCommander: mocks.useCommander,
}))

vi.mock('../components/CommanderList', () => ({
  CommanderList: () => createElement('div', null, 'CommanderList'),
}))

vi.mock('../components/QuestBoard', () => ({
  QuestBoard: () => createElement('div', null, 'QuestBoard'),
}))

vi.mock('../components/HeartbeatMonitor', () => ({
  HeartbeatMonitor: () => createElement('div', null, 'HeartbeatMonitor'),
}))

import CommandersPage from '../page'

describe('CommandersPage scheduled-run modal', () => {
  it('renders the scheduled-run modal form with key controls', () => {
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

    mocks.useCommander.mockReturnValue({
      commanders: [],
      selectedCommanderId: 'commander-1',
      selectedCommander: {
        id: 'commander-1',
      },
      setSelectedCommanderId: vi.fn(),
      commandersLoading: false,
      commandersError: null,
      createCommander: vi.fn(),
      createCommanderPending: false,
      deleteCommander: vi.fn(),
      deleteCommanderPending: false,
      startCommander: vi.fn(),
      stopCommander: vi.fn(),
      startPending: false,
      stopPending: false,
      addCron: vi.fn(),
      addCronPending: false,
      toggleCron: vi.fn(),
      toggleCronPending: false,
      deleteCron: vi.fn(),
      deleteCronPending: false,
      cronsLoading: false,
      crons: [],
      cronsError: null,
      actionError: null,
    })

    const html = renderToStaticMarkup(createElement(CommandersPage))

    expect(html).toContain('Add Scheduled Run')
    expect(html).toContain('Schedule')
    expect(html).toContain('Instruction')
    expect(html).toContain('Permission Mode')
  })
})

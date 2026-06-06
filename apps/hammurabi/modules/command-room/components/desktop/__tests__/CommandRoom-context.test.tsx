// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureLocalStorage } from '../../../__tests__/ensureLocalStorage'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
  fetchWorkspacePathResolution: vi.fn(),
  openWorkspaceTarget: vi.fn(),
  workspacePanelProps: [] as Array<{
    source?: { targetId?: string }
    requestedPath?: string | null
    requestedPathToken?: number
    onRequestedPathConsumed?: (token: number) => void
    onRecoverStaleTarget?: (source: { kind: 'target'; targetId: string }) => Promise<unknown>
  }>,
  sessionsColumnProps: [] as Array<{
    workers?: unknown[]
    workerSessions?: unknown[]
    automationSessions?: Array<{
      id?: string
      label?: string
      parentCommanderId?: string | null
    }>
  }>,
  centerColumnProps: [] as Array<{
    onOpenWorkspaceFile?: (path: string) => void
    automationSessions?: Array<{
      id?: string
      label?: string
      parentCommanderId?: string | null
    }>
  }>,
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

vi.mock('@/hooks/use-agents', () => ({
  createMachine: vi.fn(),
  createSession: vi.fn(),
  getDebriefStatus: vi.fn(),
  killSession: vi.fn(),
  resumeSession: vi.fn(),
  triggerPreKillDebrief: vi.fn(),
  useAgentSessions: mocks.useAgentSessions,
  useMachines: mocks.useMachines,
  verifyTailscaleHostname: vi.fn(),
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
}))

vi.mock('@modules/commanders/hooks/useCommander', () => ({
  GLOBAL_COMMANDER_ID: '__global__',
  isGlobalCommanderId: (value: string) => value === '__global__',
  useCommander: mocks.useCommander,
}))

vi.mock('../SessionsColumn', () => ({
  SessionsColumn: (props: {
    onSelectChat: (sessionId: string) => void
    workers?: unknown[]
    workerSessions?: unknown[]
    automationSessions?: Array<{
      id?: string
      label?: string
      parentCommanderId?: string | null
    }>
  }) => {
    const { onSelectChat } = props
    mocks.sessionsColumnProps.push(props)
    return createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'select-chat',
        onClick: () => onSelectChat('worker-1'),
      },
      'Select worker chat',
    )
  },
}))

vi.mock('../CenterColumn', () => ({
  CenterColumn: (props: {
    contextFilePaths?: string[]
    onRemoveContextFilePath?: (path: string) => void
    onClearContextFilePaths?: () => void
    onOpenWorkspace?: () => void
    onOpenWorkspaceFile?: (path: string) => void
    automationSessions?: Array<{
      id?: string
      label?: string
      parentCommanderId?: string | null
    }>
  }) => {
    const {
      contextFilePaths = [],
      onRemoveContextFilePath,
      onClearContextFilePaths,
      onOpenWorkspace,
      onOpenWorkspaceFile,
    } = props
    mocks.centerColumnProps.push(props)
    return createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'open-chat-file',
          onClick: () => onOpenWorkspaceFile?.('/tmp/external/spec.md'),
        },
        'Open chat file',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'open-workspace',
          onClick: () => onOpenWorkspace?.(),
        },
        'Open workspace',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'remove-context',
          onClick: () => onRemoveContextFilePath?.('docs/spec.md'),
        },
        'Remove context path',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'clear-context',
          onClick: () => onClearContextFilePaths?.(),
        },
        'Clear context paths',
      ),
      createElement(
        'div',
        {
          'data-testid': 'context-paths',
          'data-context-paths': contextFilePaths.join('|'),
        },
        contextFilePaths.join('|'),
      ),
    )
  },
}))

vi.mock('@modules/workspace/use-workspace', () => ({
  fetchWorkspacePathResolution: mocks.fetchWorkspacePathResolution,
  getWorkspaceSourceKey: (source: { targetId?: string }) => `workspace:${source.targetId ?? 'target'}`,
  isWorkspaceTargetNotFoundError: (error: unknown) =>
    error instanceof Error && error.message.includes('Workspace target not found'),
  materializeWorkspaceContext: vi.fn(async () => ({ text: '', filePaths: [], directoryPaths: [], fileAnnotations: [] })),
  openWorkspaceTarget: mocks.openWorkspaceTarget,
}))

vi.mock('@modules/workspace/components/WorkspacePanel', () => ({
  WorkspacePanel: (props: {
    source?: { targetId?: string }
    requestedPath?: string | null
    requestedPathToken?: number
    onInsertPath?: (path: string) => void
    onRequestedPathConsumed?: (token: number) => void
    onRecoverStaleTarget?: (source: { kind: 'target'; targetId: string }) => Promise<unknown>
  }) => {
    mocks.workspacePanelProps.push(props)
    return createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'insert-path',
          onClick: () => props.onInsertPath?.('docs/spec.md'),
        },
        'Insert docs/spec.md',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'recover-stale-target',
          onClick: () => {
            void props.onRecoverStaleTarget?.({ kind: 'target', targetId: props.source?.targetId ?? '' })
          },
        },
        'Recover stale target',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'consume-requested-path',
          onClick: () => props.onRequestedPathConsumed?.(props.requestedPathToken ?? 0),
        },
        'Consume requested path',
      ),
      createElement(
        'div',
        {
          'data-testid': 'workspace-panel-source',
          'data-target-id': props.source?.targetId ?? '',
          'data-requested-path': props.requestedPath ?? '',
        },
      ),
    )
  },
}))

vi.mock('@modules/commanders/components/QuestBoard', () => ({
  QuestBoard: () => createElement('div', { 'data-testid': 'quest-board' }, 'QuestBoard'),
}))

vi.mock('@modules/commanders/components/AutomationPanel', () => ({
  AutomationPanel: () => createElement('div', { 'data-testid': 'automation-panel' }, 'AutomationPanel'),
}))

vi.mock('@modules/commanders/components/CommanderIdentityTab', () => ({
  CommanderIdentityTab: () => createElement('div', { 'data-testid': 'identity-panel' }, 'Identity'),
}))

vi.mock('@modules/components/ModalFormContainer', () => ({
  ModalFormContainer: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? createElement('div', null, children) : null),
}))

vi.mock('@modules/agents/components/NewSessionForm', () => ({
  NewSessionForm: () => null,
}))

vi.mock('@modules/commanders/components/CreateCommanderWizard', () => ({
  CreateCommanderWizard: () => null,
}))

vi.mock('@modules/command-room/components/mobile/MobileCommandRoom', () => ({
  MobileCommandRoom: () => null,
}))

import { CommandRoom } from '../../CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildCommander() {
  return {
    id: 'cmd-1',
    host: 'atlas',
    displayName: 'Test Commander',
    pid: null,
    state: 'running',
    created: '2026-04-20T16:00:00.000Z',
    agentType: 'claude',
    effort: 'medium',
    cwd: '/tmp/atlas',
    heartbeat: {
      intervalMs: 900_000,
      messageTemplate: '',
      lastSentAt: null,
    },
    lastHeartbeat: null,
    taskSource: null,
    currentTask: null,
    completedTasks: 0,
    questCount: 0,
    scheduleCount: 0,
    totalCostUsd: 0,
    avatarUrl: null,
    ui: null,
  }
}

async function renderRoom(initialEntry = '/command-room') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  flushSync(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/command-room/*" element={<CommandRoom />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

describe('CommandRoom context file wiring', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    ensureLocalStorage().clear()
    mocks.sessionsColumnProps.length = 0
    mocks.centerColumnProps.length = 0
    mocks.workspacePanelProps.length = 0
    mocks.fetchJson.mockImplementation(async (path: string) => {
      if (path === '/api/workspace/preferences') {
        return { panelDefault: 'last-used' }
      }
      if (path.includes('/conversations')) {
        return []
      }
      if (path === '/api/automations') {
        return []
      }
      return {}
    })
    mocks.fetchWorkspacePathResolution.mockImplementation(async (_source: unknown, requestedPath: string) => ({
      workspace: {},
      requestedPath,
      path: requestedPath,
      type: 'file',
      treePath: '',
    }))
    mocks.openWorkspaceTarget.mockImplementation(async (input: { sessionName?: string }) => ({
      targetId: input.sessionName ? 'wt-worker-1' : 'wt-commander-1',
      label: input.sessionName ? 'local:/tmp/worker-1' : 'local:/tmp/atlas',
      host: 'local',
      rootPath: input.sessionName ? '/tmp/worker-1' : '/tmp/atlas',
      isReadOnly: false,
    }))

    const commander = buildCommander()

    mocks.useCommander.mockReturnValue({
      commanders: [commander],
      selectedCommanderId: commander.id,
      selectedCommander: commander,
      setSelectedCommanderId: vi.fn(),
      crons: [],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(async () => undefined),
      addCronPending: false,
      toggleCron: vi.fn(async () => undefined),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(async () => undefined),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(async () => undefined),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(async () => undefined),
      deleteCronPending: false,
      deleteCronId: null,
      startCommander: vi.fn(async () => undefined),
      stopCommander: vi.fn(async () => undefined),
      createCommander: vi.fn(async () => commander),
      createCommanderPending: false,
    })

    mocks.useAgentSessions.mockReturnValue({
      data: [
        {
          id: 'worker-1',
          name: 'worker-1',
          label: 'Worker 1',
          created: '2026-04-20T12:00:00.000Z',
          pid: 4242,
          status: 'running',
          agentType: 'codex',
          sessionType: 'worker',
          transportType: 'stream',
          processAlive: true,
          spawnedBy: 'commander-cmd-1',
        },
      ],
      refetch: vi.fn(async () => ({ data: [] })),
    })
    mocks.useMachines.mockReturnValue({ data: [] })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(async () => true),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'connected',
    })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
  })

  afterEach(async () => {
    if (root) {
      flushSync(() => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('resets contextFilePaths when the workspace source key changes', async () => {
    await renderRoom()

    const contextPaths = () => document.body.querySelector('[data-testid="context-paths"]')
      ?.getAttribute('data-context-paths') ?? ''

    expect(contextPaths()).toBe('')

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="open-workspace"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="insert-path"]')).not.toBeNull()
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="insert-path"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(contextPaths()).toBe('docs/spec.md')
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="select-chat"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(contextPaths()).toBe('')
    })
  })

  it('preserves a chat-linked location retarget after a stale auto-open response settles', async () => {
    let resolveInitialAutoOpen!: (value: {
      targetId: string
      label: string
      host: string
      rootPath: string
      isReadOnly: boolean
    }) => void
    const initialAutoOpen = new Promise<{
      targetId: string
      label: string
      host: string
      rootPath: string
      isReadOnly: boolean
    }>((resolve) => {
      resolveInitialAutoOpen = resolve
    })
    let commanderOpenCount = 0
    mocks.openWorkspaceTarget.mockImplementation(async () => {
      commanderOpenCount += 1
      if (commanderOpenCount === 1) {
        return initialAutoOpen
      }
      return {
        targetId: 'wt-commander-1',
        label: 'local:/tmp/atlas',
        host: 'local',
        rootPath: '/tmp/atlas',
        isReadOnly: false,
      }
    })
    mocks.fetchWorkspacePathResolution.mockResolvedValue({
      workspace: {},
      requestedPath: '/tmp/external/spec.md',
      path: 'spec.md',
      type: 'file',
      treePath: '',
      targetId: 'wt-location-1',
      targetLabel: 'local:/tmp/external',
      targetReadOnly: false,
    })

    await renderRoom()

    await vi.waitFor(() => {
      expect(mocks.openWorkspaceTarget).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      ;(document.body.querySelector('[data-testid="open-chat-file"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      const latestProps = mocks.workspacePanelProps.at(-1)
      expect(latestProps?.source?.targetId).toBe('wt-location-1')
      expect(latestProps?.requestedPath).toBe('spec.md')
    })

    await act(async () => {
      resolveInitialAutoOpen({
        targetId: 'wt-commander-stale',
        label: 'local:/tmp/stale-atlas',
        host: 'local',
        rootPath: '/tmp/stale-atlas',
        isReadOnly: false,
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-location-1')
      expect(
        document.body.querySelector('[data-testid="workspace-panel-source"]')?.getAttribute('data-target-id'),
      ).toBe('wt-location-1')
    })
  })

  it('does not replay a consumed chat file request after switching workspace owners', async () => {
    mocks.fetchWorkspacePathResolution.mockResolvedValue({
      workspace: {},
      requestedPath: '/tmp/external/spec.md',
      path: 'spec.md',
      type: 'file',
      treePath: '',
    })

    await renderRoom()

    await vi.waitFor(() => {
      expect(mocks.openWorkspaceTarget).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      ;(document.body.querySelector('[data-testid="open-chat-file"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.requestedPath).toBe('spec.md')
    })

    await act(async () => {
      ;(document.body.querySelector('[data-testid="consume-requested-path"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.requestedPath ?? null).toBeNull()
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="select-chat"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-worker-1')
      expect(mocks.workspacePanelProps.at(-1)?.requestedPath ?? null).toBeNull()
    })
  })

  it('reopens the selected workspace owner when a panel reports a stale target', async () => {
    let openCount = 0
    mocks.openWorkspaceTarget.mockImplementation(async () => {
      openCount += 1
      return {
        targetId: openCount === 1 ? 'wt-stale' : 'wt-reopened',
        label: openCount === 1 ? 'local:/tmp/stale' : 'local:/tmp/reopened',
        host: 'local',
        rootPath: openCount === 1 ? '/tmp/stale' : '/tmp/reopened',
        isReadOnly: false,
      }
    })

    await renderRoom()

    await vi.waitFor(() => {
      expect(mocks.openWorkspaceTarget).toHaveBeenCalledTimes(1)
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="open-workspace"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-stale')
    })

    await act(async () => {
      ;(document.body.querySelector('[data-testid="recover-stale-target"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.openWorkspaceTarget).toHaveBeenCalledTimes(2)
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-reopened')
    })
  })

  it('does not let a stale recovery open overwrite a newer chat retarget', async () => {
    let resolveRecoveryOpen!: (value: {
      targetId: string
      label: string
      host: string
      rootPath: string
      isReadOnly: boolean
    }) => void
    const recoveryOpen = new Promise<{
      targetId: string
      label: string
      host: string
      rootPath: string
      isReadOnly: boolean
    }>((resolve) => {
      resolveRecoveryOpen = resolve
    })
    let openCount = 0
    mocks.openWorkspaceTarget.mockImplementation(async () => {
      openCount += 1
      if (openCount === 1) {
        return {
          targetId: 'wt-stale',
          label: 'local:/tmp/stale',
          host: 'local',
          rootPath: '/tmp/stale',
          isReadOnly: false,
        }
      }
      return recoveryOpen
    })
    mocks.fetchWorkspacePathResolution.mockResolvedValue({
      workspace: {},
      requestedPath: '/tmp/external/spec.md',
      path: 'spec.md',
      type: 'file',
      treePath: '',
      targetId: 'wt-location-1',
      targetLabel: 'local:/tmp/external',
      targetReadOnly: false,
    })

    await renderRoom()

    await vi.waitFor(() => {
      expect(mocks.openWorkspaceTarget).toHaveBeenCalledTimes(1)
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="open-workspace"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-stale')
    })

    await act(async () => {
      ;(document.body.querySelector('[data-testid="recover-stale-target"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.openWorkspaceTarget).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      ;(document.body.querySelector('[data-testid="open-chat-file"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-location-1')
    })

    await act(async () => {
      resolveRecoveryOpen({
        targetId: 'wt-reopened',
        label: 'local:/tmp/reopened',
        host: 'local',
        rootPath: '/tmp/reopened',
        isReadOnly: false,
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mocks.workspacePanelProps.at(-1)?.source?.targetId).toBe('wt-location-1')
      expect(
        document.body.querySelector('[data-testid="workspace-panel-source"]')?.getAttribute('data-target-id'),
      ).toBe('wt-location-1')
    })
  })

  it('joins automation session ownership before passing sessions to the desktop commander list', async () => {
    mocks.fetchJson.mockImplementation(async (path: string) => {
      if (path === '/api/workspace/preferences') {
        return { panelDefault: 'last-used' }
      }
      if (path.includes('/conversations')) {
        return []
      }
      if (path === '/api/automations') {
        return [
          {
            id: 'auto-1',
            name: 'Atlas Review',
            parentCommanderId: 'cmd-1',
          },
          {
            id: 'auto-global',
            name: 'Global Briefing',
            parentCommanderId: null,
          },
        ]
      }
      return {}
    })
    mocks.useAgentSessions.mockReturnValue({
      data: [
        {
          id: 'automation-auto-1',
          name: 'automation-auto-1',
          created: '2026-04-20T12:00:00.000Z',
          pid: 4243,
          status: 'running',
          agentType: 'codex',
          sessionType: 'automation',
          transportType: 'stream',
          processAlive: true,
          creator: { kind: 'automation', id: 'auto-1' },
        },
        {
          id: 'automation-global',
          name: 'automation-global',
          created: '2026-04-20T12:00:00.000Z',
          pid: 4244,
          status: 'running',
          agentType: 'codex',
          sessionType: 'automation',
          transportType: 'stream',
          processAlive: true,
          creator: { kind: 'automation', id: 'auto-global' },
        },
      ],
      refetch: vi.fn(async () => ({ data: [] })),
    })

    await renderRoom()

    await vi.waitFor(() => {
      const latestProps = mocks.sessionsColumnProps.at(-1)
      expect(latestProps?.automationSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'automation-auto-1',
            label: 'Atlas Review',
            parentCommanderId: 'cmd-1',
          }),
          expect.objectContaining({
            id: 'automation-global',
            label: 'Global Briefing',
            parentCommanderId: null,
          }),
        ]),
      )
      expect(mocks.centerColumnProps.at(-1)?.automationSessions).toEqual([
        expect.objectContaining({
          id: 'automation-auto-1',
          label: 'Atlas Review',
          parentCommanderId: 'cmd-1',
        }),
      ])
    })
  })

  it('renders right-column module buttons above a collapsible workspace panel', async () => {
    await renderRoom('/command-room?commander=cmd-1&panel=identity')

    const grid = document.body.querySelector<HTMLElement>('[data-testid="command-room-grid"]')
    expect(grid?.style.gridTemplateColumns).toBe('232px minmax(340px, 1fr) 232px')
    expect(grid?.getAttribute('data-test-id')).toBe('command-room-grid')

    const rightColumn = document.body.querySelector<HTMLElement>('[data-testid="workspace-right-column"]')
    expect(rightColumn?.style.display).toBe('flex')
    expect(rightColumn?.style.width).toBe('232px')

    const actions = document.body.querySelector<HTMLElement>('[data-testid="right-panel-actions"]')
    expect(actions?.textContent).toContain('Workspace')
    expect(actions?.textContent).toContain('Quests')
    expect(actions?.textContent).toContain('Automations')
    expect(actions?.textContent).toContain('Identity')
    expect(actions?.style.display).toBe('grid')
    expect(actions?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(actions?.style.overflowX).toBe('visible')

    const workspaceButton = document.body.querySelector<HTMLButtonElement>('[data-testid="right-panel-tab-chat"]')
    expect(workspaceButton?.getAttribute('data-test-id')).toBe('right-panel-tab-chat')
    expect(workspaceButton?.style.borderStyle).toBe('solid')
    expect(workspaceButton?.style.borderWidth).toBe('1px')
    expect(workspaceButton?.style.borderRadius).toBe('2px 12px 2px 12px')
    expect(workspaceButton?.style.width).toBe('100%')

    const identityButton = document.body.querySelector<HTMLButtonElement>('[data-testid="right-panel-tab-identity"]')
    expect(identityButton?.style.boxShadow).toBe('var(--hv-shadow-block)')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="identity-panel"]')).not.toBeNull()
    })

    flushSync(() => {
      workspaceButton?.click()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLElement>('[data-testid="workspace-right-column"]')?.style.width).toBe('520px')
    })

    await vi.waitFor(() => {
      expect(actions?.style.display).toBe('flex')
      expect(actions?.style.overflowX).toBe('auto')
    })

    await vi.waitFor(() => {
      expect(workspaceButton?.getAttribute('aria-pressed')).toBe('true')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="insert-path"]')).not.toBeNull()
    })

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector<HTMLElement>('[data-testid="workspace-right-column"]')?.style.width).toBe('232px')
    })
  })
})

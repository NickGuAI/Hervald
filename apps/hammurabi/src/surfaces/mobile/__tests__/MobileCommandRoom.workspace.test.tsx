// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-approvals', () => ({
  useApprovalDecision: () => ({ mutateAsync: vi.fn(async () => undefined) }),
}))

vi.mock('@modules/agents/page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({
    onOpenWorkspace,
    contextFilePaths = [],
  }: {
    onOpenWorkspace?: () => void
    contextFilePaths?: string[]
  }) => createElement(
    'div',
    { 'data-testid': 'mobile-session-shell' },
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
      'div',
      {
        'data-testid': 'context-paths',
        'data-context-paths': contextFilePaths.join('|'),
      },
      contextFilePaths.join('|'),
    ),
  ),
}))

vi.mock('@modules/commanders/components/CommanderStartControl', () => ({
  CommanderStartControl: () => createElement('div', null, 'CommanderStartControl'),
}))

vi.mock('@modules/agents/components/WorkspaceOverlay', () => ({
  WorkspaceOverlay: ({
    open,
    onSelectFile,
  }: {
    open: boolean
    onSelectFile: (filePath: string) => void
  }) => open
    ? createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'workspace-select-file',
        onClick: () => onSelectFile('docs/spec.md'),
      },
      'Select docs/spec.md',
    )
    : null,
}))

vi.mock('../MobileSessionsList', () => ({
  MobileSessionsList: () => createElement('div', { 'data-testid': 'mobile-sessions-list' }),
}))

vi.mock('../MobileAutomations', () => ({
  MobileAutomations: () => createElement('div', { 'data-testid': 'mobile-automations' }),
}))

vi.mock('../MobileInbox', () => ({
  MobileInbox: () => createElement('div', { 'data-testid': 'mobile-inbox' }),
}))

vi.mock('../MobileSettings', () => ({
  MobileSettings: () => createElement('div', { 'data-testid': 'mobile-settings' }),
}))

vi.mock('../MobileTeamSheet', () => ({
  MobileTeamSheet: () => null,
}))

vi.mock('../MobileApprovalSheet', () => ({
  MobileApprovalSheet: () => null,
}))

import { MobileCommandRoom } from '../MobileCommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderRoom() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  root?.render(
    <MemoryRouter initialEntries={['/command-room/sessions/cmd-1?surface=mobile']}>
      <Routes>
        <Route
          path="/command-room/*"
          element={(
            <MobileCommandRoom
              commanders={[
                {
                  id: 'cmd-1',
                  name: 'Test Commander',
                  status: 'running',
                  description: 'Primary commander',
                },
              ]}
              commanderSessions={[
                {
                  id: 'cmd-1',
                  host: 'atlas',
                  displayName: 'Test Commander',
                  pid: null,
                  state: 'running',
                  created: '2026-04-23T12:00:00.000Z',
                  agentType: 'claude',
                  effort: 'medium',
                  cwd: '/tmp/atlas',
                  persona: 'Primary commander',
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
                },
              ]}
              workers={[]}
              pendingApprovals={[]}
              selectedCommanderId="cmd-1"
              onSelectCommanderId={vi.fn()}
              selectedCommanderRunning
              selectedCommanderAgentType="claude"
              transcript={[]}
              onAnswer={vi.fn()}
              composerSessionName="commander-cmd-1"
              composerEnabled
              composerSendReady
              canQueueDraft
              theme="dark"
              onSetTheme={vi.fn()}
              queueSnapshot={{
                currentMessage: null,
                items: [],
                totalCount: 0,
                maxSize: 8,
              }}
              isQueueMutating={false}
              onClearQueue={vi.fn()}
              onMoveQueuedMessage={vi.fn()}
              onRemoveQueuedMessage={vi.fn()}
              onSend={vi.fn(async () => true)}
              onQueue={vi.fn(async () => true)}
              workspaceSource={{ kind: 'commander', commanderId: 'cmd-1', readOnly: true }}
              crons={[]}
              cronsLoading={false}
              cronsError={null}
              addCron={vi.fn(async () => undefined)}
              addCronPending={false}
              toggleCron={vi.fn(async () => undefined)}
              toggleCronPending={false}
              toggleCronId={null}
              updateCron={vi.fn(async () => undefined)}
              updateCronPending={false}
              updateCronId={null}
              triggerCron={vi.fn(async () => undefined)}
              triggerCronPending={false}
              triggerCronId={null}
              deleteCron={vi.fn(async () => undefined)}
              deleteCronPending={false}
              deleteCronId={null}
            />
          )}
        />
      </Routes>
    </MemoryRouter>,
  )
  await Promise.resolve()
}

describe('MobileCommandRoom workspace selection', () => {
  afterEach(async () => {
    if (root) {
      root?.unmount()
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('adds selected workspace files to the mobile chat composer context and closes the sheet', async () => {
    await renderRoom()

    const contextPaths = () => document.body.querySelector('[data-testid="context-paths"]')
      ?.getAttribute('data-context-paths') ?? ''

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="context-paths"]')).not.toBeNull()
    })

    expect(contextPaths()).toBe('')

    ;(document.body.querySelector('[data-testid="open-workspace"]') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-select-file"]')).not.toBeNull()
    })

    ;(document.body.querySelector('[data-testid="workspace-select-file"]') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(contextPaths()).toBe('docs/spec.md')
    })
    expect(document.body.querySelector('[data-testid="workspace-select-file"]')).toBeNull()

    ;(document.body.querySelector('[data-testid="open-workspace"]') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="workspace-select-file"]')).not.toBeNull()
    })

    ;(document.body.querySelector('[data-testid="workspace-select-file"]') as HTMLButtonElement).click()

    await vi.waitFor(() => {
      expect(contextPaths()).toBe('docs/spec.md')
    })
  })
})

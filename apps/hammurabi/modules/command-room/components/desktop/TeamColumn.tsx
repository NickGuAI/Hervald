/**
 * Hervald — TeamColumn
 *
 * 260px right panel showing workers dispatched by the selected commander.
 * Layout:
 *   ┌─────────────────────┐
 *   │ TEAM · N   X PEND   │  ← ColumnHeader
 *   │ commander's team    │  ← italic Cormorant 17px
 *   │  ·  worker-a        │  ┐
 *   │  ·  worker-b  [1]   │  │ scrollable TeamMemberRow list
 *   │  ·  worker-c        │  ┘
 *   │ ╔═══════════════╗   │
 *   │ ║ SelectedDetail ║  │  ← pinned at bottom
 *   │ ╚═══════════════╝   │
 *   └─────────────────────┘
 */
import type { ReactNode } from 'react'
import type { SessionCreator } from '@/types'
import { TeamMemberRow } from './TeamMemberRow'
import { SelectedDetailCard } from './SelectedDetailCard'

interface Commander {
  id: string
  name: string
  status: string
}

interface Worker {
  id: string
  name: string
  label?: string
  kind: string
  state: string
  creator?: SessionCreator
  processAlive?: boolean
  resumeAvailable?: boolean
}

interface Approval {
  id: string
  commanderId: string
  workerId: string
  action: string
}

interface TeamColumnProps {
  commander: Commander
  workers: Worker[]
  approvals: Approval[]
  selectedWorkerId: string | undefined
  onSelectWorker: (id: string) => void
  onOpenWorkspace: () => void
  onDismissWorker?: (worker: Worker) => void
}

// ColumnHeader is local to this surface — not a shared primitive
function ColumnHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 20px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--hv-border-hair)',
        fontSize: 10.5,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--hv-fg-subtle)',
        fontWeight: 500,
        fontFamily: 'var(--hv-font-body)',
      }}
    >
      <span>{left}</span>
      {right}
    </div>
  )
}

export function TeamColumn({
  commander,
  workers,
  approvals,
  selectedWorkerId,
  onSelectWorker,
  onOpenWorkspace,
  onDismissWorker,
}: TeamColumnProps) {
  const hasCommander = commander.id.trim().length > 0
  const teamMembers = workers.filter(
    (worker) =>
      (worker.kind === 'worker' || worker.kind === 'tool')
      && worker.creator?.kind === 'commander'
      && worker.creator.id === commander.id,
  )
  const pendCount = approvals.length

  const selectedWorker = teamMembers.find((worker) => worker.id === selectedWorkerId)
  const selectedApproval = selectedWorker
    ? approvals.find((approval) => approval.workerId === selectedWorker.id)
    : undefined

  return (
    <aside
      style={{
        width: 260,
        flexShrink: 0,
        background: 'var(--hv-bg-raised)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <ColumnHeader
        left={<>TEAM · {teamMembers.length}</>}
        right={
          pendCount > 0 ? (
            <span
              style={{
                fontSize: 10,
                color: 'var(--vermillion-seal)',
                letterSpacing: '0.14em',
                fontWeight: 500,
                fontFamily: 'var(--hv-font-body)',
              }}
            >
              {pendCount} PEND
            </span>
          ) : undefined
        }
      />

      {/* Commander name subheader */}
      <div
        style={{
          padding: '14px 20px 6px',
          fontFamily: 'var(--hv-font-primary)',
          fontStyle: 'italic',
          fontSize: 17,
          color: 'var(--hv-fg)',
          letterSpacing: '-0.01em',
        }}
      >
        {hasCommander ? `${commander.name}'s team` : commander.name}
      </div>

      {/* Scrollable worker list */}
      <div className="hv-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 0 14px' }}>
        {hasCommander ? (
          teamMembers.map((worker) => (
            <TeamMemberRow
              key={worker.id}
              worker={worker}
              approvalCount={approvals.filter((approval) => approval.workerId === worker.id).length}
              selected={selectedWorkerId === worker.id}
              onClick={() => onSelectWorker(worker.id)}
            />
          ))
        ) : (
          <div
            style={{
              padding: '18px 20px',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--hv-fg-faint)',
            }}
          >
            Standalone chats do not have delegated team members.
          </div>
        )}
      </div>

      {/* Pinned detail card for the selected worker */}
      {hasCommander && selectedWorker && (
        <SelectedDetailCard
          worker={selectedWorker}
          approval={selectedApproval}
          onOpenWorkspace={onOpenWorkspace}
          onDismiss={
            selectedWorker.state === 'exited' && onDismissWorker
              ? () => onDismissWorker(selectedWorker)
              : undefined
          }
        />
      )}
    </aside>
  )
}
